/**
 * MCP Client —— v1.1.0
 *
 * 职责：
 *   连接外部 MCP Server（stdio 模式），注册工具到 Tool Registry
 *
 * 协议：
 *   Model Context Protocol (MCP) - stdio transport
 *
 * 参考：
 *   https://modelcontextprotocol.io/
 */

import { spawn, ChildProcess } from 'child_process';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { registerTools, type ToolDefinition, type ToolResult } from '../tools/registry';
import { getConfig } from '../config/config';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface McpMessage {
  type: string;
  id?: string;
  name?: string;
  tools?: McpTool[];
  content?: string;
  error?: string;
}

const runningServers = new Map<string, ChildProcess>();
const registeredToolNames = new Set<string>();

/**
 * MCP Server 允许执行的目录白名单
 * 防止用户配置恶意路径执行任意系统命令
 */
const ALLOWED_MCP_DIRS: readonly string[] = [
  path.resolve(process.cwd(), 'mcp-servers'),
  path.resolve(process.cwd(), 'tools', 'mcp'),
  path.resolve(process.cwd(), 'bin'),
];

/** 导出供测试使用 */
export function isValidMcpPath(commandPath: string): boolean {
  if (!commandPath || typeof commandPath !== 'string') return false;

  let realPath: string;
  try {
    realPath = fs.realpathSync(commandPath);
  } catch {
    return false;
  }

  return ALLOWED_MCP_DIRS.some(dir => {
    return realPath === dir || realPath.startsWith(dir + path.sep);
  });
}

/** 导出供测试使用 */
export function mcpParamToZod(param: Record<string, unknown>): z.ZodTypeAny {
  const type = param.type as string;
  const enumValues = (param.enum as unknown[]) ?? [];

  switch (type) {
    case 'string':
      if (enumValues.length > 0) {
        return z.enum(enumValues as [string, ...string[]]);
      }
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(z.any());
    case 'object':
      const properties = param.properties as Record<string, Record<string, unknown>> ?? {};
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(properties)) {
        shape[key] = mcpParamToZod(prop);
      }
      return z.object(shape);
    default:
      return z.any();
  }
}

/** 导出供测试使用 */
export function mcpToolToSchema(parameters: Record<string, unknown>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, param] of Object.entries(parameters)) {
    const zodType = mcpParamToZod(param as Record<string, unknown>);
    const isRequired = !(param as Record<string, unknown>).optional;
    shape[name] = isRequired ? zodType : zodType.optional();
  }
  return z.object(shape);
}

export async function connectMcpServer(config: McpServerConfig): Promise<void> {
  if (runningServers.has(config.name)) {
    console.warn(`[MCP Client] Server "${config.name}" already running`);
    return;
  }

  if (!isValidMcpPath(config.command)) {
    console.error(`[MCP Client] Command path not allowed: ${config.command}`);
    throw new Error(`MCP Server 命令路径不在白名单目录内: ${config.command}`);
  }

  try {
    const child = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    runningServers.set(config.name, child);

    const toolDefinitions: ToolDefinition[] = [];

    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg: McpMessage = JSON.parse(line);
          handleMcpMessage(msg, config.name, toolDefinitions);
        } catch {
          // 忽略非 JSON 输出
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      // 第五关 LOG-01：MCP server 是用户配置的第三方进程，stderr 可能含敏感信息
      // （API key、token、本地路径、用户名等），直接 console.error 会污染主日志。
      // 处理：
      //   1. 截断超长行（防 stderr 爆破导致主日志膨胀）
      //   2. 用正则脱敏常见敏感字段（key/token/secret/password/authorization）
      //   3. 限制单次打印行数
      const raw = data.toString();
      const lines = raw.split('\n').slice(0, 20); // 最多 20 行
      const SENSITIVE_RE = /(\b(?:api[_-]?key|token|secret|password|authorization|bearer|cookie|session[_-]?id)\b\s*[:=]\s*)([^\s,;"']+)/gi;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const safe = trimmed
          .replace(SENSITIVE_RE, '$1***')
          .slice(0, 500); // 单行最长 500 字符
        console.error(`[MCP ${config.name}] stderr:`, safe);
      }
    });

    child.on('close', (code: number) => {
      console.log(`[MCP ${config.name}] closed with code ${code}`);
      runningServers.delete(config.name);
      for (const tool of toolDefinitions) {
        registeredToolNames.delete(tool.name);
      }
    });

    const initMsg: McpMessage = { type: 'initialize' };
    child.stdin?.write(JSON.stringify(initMsg) + '\n');

    console.log(`[MCP Client] Connected to "${config.name}"`);
  } catch (err) {
    console.error(`[MCP Client] Failed to connect to "${config.name}":`, err);
    throw err;
  }
}

function handleMcpMessage(
  msg: McpMessage,
  serverName: string,
  toolDefinitions: ToolDefinition[],
): void {
  switch (msg.type) {
    case 'tools':
      if (msg.tools) {
        for (const mcpTool of msg.tools) {
          if (registeredToolNames.has(mcpTool.name)) {
            console.warn(`[MCP ${serverName}] Tool "${mcpTool.name}" already registered, skipping`);
            continue;
          }

          const paramSchema = mcpToolToSchema(mcpTool.parameters);
          const toolDef: ToolDefinition = {
            name: mcpTool.name,
            description: mcpTool.description,
            parameters: paramSchema,
            execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
              const start = Date.now();
              const validation = paramSchema.safeParse(params);
              if (!validation.success) {
                return { ok: false, data: `参数校验失败: ${validation.error.message}`, latencyMs: Date.now() - start };
              }
              return await executeMcpTool(serverName, mcpTool.name, validation.data);
            },
          };

          toolDefinitions.push(toolDef);
          registeredToolNames.add(mcpTool.name);
        }

        if (toolDefinitions.length > 0) {
          registerTools(toolDefinitions);
          console.log(`[MCP ${serverName}] Registered ${toolDefinitions.length} tools`);
        }
      }
      break;

    case 'error':
      console.error(`[MCP ${serverName}] Error:`, msg.error);
      break;

    default:
      console.debug(`[MCP ${serverName}] Unknown message type:`, msg.type);
  }
}

async function executeMcpTool(
  serverName: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const child = runningServers.get(serverName);
    if (!child) {
      const latencyMs = Date.now() - startTime;
      resolve({ ok: false, data: `MCP server "${serverName}" not running`, latencyMs });
      return;
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const msg: McpMessage = {
      type: 'invoke',
      id: requestId,
      name: toolName,
      content: JSON.stringify(params),
    };

    const handleResponse = (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const response: McpMessage = JSON.parse(line);
          if (response.id === requestId) {
            child.stdout?.off('data', handleResponse);
            const latencyMs = Date.now() - startTime;

            if (response.type === 'result') {
              try {
                const parsedData = JSON.parse(response.content || '{}');
                resolve({ ok: true, data: parsedData, latencyMs });
              } catch {
                resolve({ ok: true, data: response.content, latencyMs });
              }
            } else if (response.type === 'error') {
              resolve({ ok: false, data: response.error || 'Unknown error', latencyMs });
            } else {
              resolve({ ok: false, data: `Unexpected response type: ${response.type}`, latencyMs });
            }
            return;
          }
        } catch {
          // 累积非 JSON 数据
        }
      }
    };

    child.stdout?.on('data', handleResponse);
    child.stdin?.write(JSON.stringify(msg) + '\n');
  });
}

export function disconnectMcpServer(serverName: string): void {
  const child = runningServers.get(serverName);
  if (child) {
    child.kill('SIGTERM');
    runningServers.delete(serverName);
    console.log(`[MCP Client] Disconnected from "${serverName}"`);
  }
}

export function disconnectAllServers(): void {
  for (const [name] of runningServers) {
    disconnectMcpServer(name);
  }
}

export function getConnectedServers(): string[] {
  return Array.from(runningServers.keys());
}

/**
 * 从用户配置启动第三方 MCP Server（QQ / 微信）
 *
 * v1.2.x 补丁：读取 config.mcpServers.{qq,wechat} 路径，
 * 若存在则自动通过 stdio 连接。
 */
export async function connectConfiguredMcpServers(): Promise<void> {
  const cfg = getConfig().mcpServers;
  if (!cfg) {
    console.log('[MCP Client] No configured MCP servers');
    return;
  }

  const servers: Array<{ name: string; path?: string }> = [
    { name: 'qq', path: cfg.qq },
    { name: 'wechat', path: cfg.wechat },
  ];

  for (const srv of servers) {
    if (!srv.path) continue;

    try {
      await connectMcpServer({
        name: srv.name,
        command: srv.path,
        args: [],
      });
      console.log(`[MCP Client] Auto-connected ${srv.name} from ${srv.path}`);
    } catch (err) {
      console.error(`[MCP Client] Failed to auto-connect ${srv.name}:`, err);
    }
  }
}