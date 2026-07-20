/**
 * 工具注册表（Tool Registry）—— T7
 *
 * 职责：
 *   1. 定义工具的标准接口（name + description + zod schema + execute）
 *   2. 提供注册/查询/列举能力
 *   3. 生成 OpenAI function-calling 兼容的 tool schema（喂给 LLM）
 *
 * 设计原则（来自 .trae/rules/skills.md）：
 *   - 每个 tool 必须 name | description | parameters (zod schema) | execute()
 *   - description 写中文
 *   - 内置 skill 清单预留口：文件操作、网页获取、搜索、天气、翻译、记账、出行规划
 *   - 禁止：游戏代肝、模拟输入
 *
 * 后续 MCP 接入：MCP Server 注册的 tool 转成本注册表的 ToolDefinition 即可无缝接入。
 */

import { type ZodType } from 'zod';

// ── 类型定义 ──────────────────────────────────────────────────

/** 工具参数 schema（zod 定义） */
export type ToolParameters = ZodType<Record<string, unknown>>;

/** 工具执行结果 */
export interface ToolResult {
  /** 是否成功 */
  ok: boolean;
  /** 结果数据（成功时）或错误消息（失败时） */
  data: unknown;
  /** 耗时（ms） */
  latencyMs: number;
}

/** 工具定义（注册时必须提供） */
export interface ToolDefinition {
  /** 工具名（snake_case，如 'web_fetch'） */
  name: string;
  /** 中文描述（喂给 LLM，告诉它何时用这个工具） */
  description: string;
  /** 参数 schema（zod） */
  parameters: ToolParameters;
  /** 执行函数 */
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** 工具执行上下文（传给 execute 的环境信息） */
export interface ToolContext {
  /** 当前 session ID */
  sessionId: string;
  /** 用户消息原文（部分工具可能需要上下文） */
  userMessage: string;
}

// ── 注册表主体 ────────────────────────────────────────────────

/** 已注册的工具（按 name 索引） */
const registry = new Map<string, ToolDefinition>();

/**
 * 注册一个工具
 *
 * 重复注册同名工具会覆盖（方便 dev 热更新）。
 */
export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    console.warn(`[Tools] overwrite existing tool: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

/**
 * 批量注册工具
 */
export function registerTools(tools: ToolDefinition[]): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

/** 查询工具（不存在返回 undefined） */
export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/** 列举所有已注册工具名 */
export function listToolNames(): string[] {
  return Array.from(registry.keys());
}
