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

export async function connectMcpServer(config: McpServerConfig): Promise<void> {
  if (runningServers.has(config.name)) {
    console.warn(`[MCP Client] Server "${config.name}" already running`);
    return;
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
      console.error(`[MCP ${config.name}] stderr:`, data.toString().trim());
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

          const toolDef: ToolDefinition = {
            name: mcpTool.name,
            description: mcpTool.description,
            parameters: z.object({}),
            execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
              return await executeMcpTool(serverName, mcpTool.name, params);
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