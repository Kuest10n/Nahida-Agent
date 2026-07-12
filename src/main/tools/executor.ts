/**
 * 工具执行器（Tool Executor）—— T7
 *
 * 职责：
 *   1. 接收 LLM 输出的 tool_call（name + arguments JSON）
 *   2. 走护栏检查（频率限制 + 风暴检测）
 *   3. zod 参数校验 + 自动修复畸形 JSON
 *   4. 调用工具 execute()，返回结果
 *
 * 不负责决定"何时调用工具"——那是路由层 + LLM 的事。
 * 本模块只负责"安全地执行一次工具调用"。
 *
 * 流程：
 *   LLM tool_call → 护栏检查 → JSON 修复 → zod 校验 → execute() → ToolResult
 */

import { Router } from '../router/router';
import { ToolGuardrails } from '../safety/guardrails';
import { getTool, type ToolContext, type ToolResult } from './registry';

// ── 类型定义 ──────────────────────────────────────────────────

/** LLM 输出的 tool_call（解析后） */
export interface RawToolCall {
  /** 工具名 */
  name: string;
  /** 参数（原始 JSON 字符串，可能畸形） */
  arguments: string;
}

/** 执行结果（含护栏状态） */
export interface ExecutedToolCall {
  /** 工具名 */
  name: string;
  /** 护栏是否通过 */
  guardrailPass: boolean;
  /** 护栏拒绝原因（未通过时） */
  guardrailReason?: string;
  /** 是否触发降级建议 */
  degrade: boolean;
  /** 工具执行结果（护栏通过才有） */
  result?: ToolResult;
}

// ── 执行器主体 ────────────────────────────────────────────────

/**
 * 执行一次工具调用
 *
 * @param rawCall     LLM 输出的 tool_call
 * @param sessionId   当前 session ID
 * @param userMessage 用户消息原文（传给工具上下文）
 * @param router      路由器实例（用其 checkToolGuard 走护栏）
 * @returns 执行结果（含护栏状态 + 工具结果）
 */
export async function executeToolCall(
  rawCall: RawToolCall,
  sessionId: string,
  userMessage: string,
  router: Router,
): Promise<ExecutedToolCall> {
  // 1. 查注册表
  const tool = getTool(rawCall.name);
  if (!tool) {
    return {
      name: rawCall.name,
      guardrailPass: false,
      guardrailReason: `unknown tool: ${rawCall.name}`,
      degrade: false,
    };
  }

  // 2. 护栏检查（频率限制 + 风暴检测）
  const guardrailResult = router.checkToolGuard({
    toolName: rawCall.name,
    parameters: {}, // 参数还没解析，护栏只关心频率
    sessionId,
  });

  if (!guardrailResult.pass) {
    return {
      name: rawCall.name,
      guardrailPass: false,
      guardrailReason: guardrailResult.message ?? guardrailResult.reason,
      degrade: guardrailResult.degrade,
    };
  }

  // 3. JSON 参数修复 + 解析
  const params = parseToolArguments(rawCall.arguments);
  if (params === null) {
    return {
      name: rawCall.name,
      guardrailPass: true,
      degrade: guardrailResult.degrade,
      result: {
        ok: false,
        data: '参数 JSON 解析失败',
        latencyMs: 0,
      },
    };
  }

  // 4. zod 参数校验
  const validation = tool.parameters.safeParse(params);
  if (!validation.success) {
    return {
      name: rawCall.name,
      guardrailPass: true,
      degrade: guardrailResult.degrade,
      result: {
        ok: false,
        data: `参数校验失败: ${validation.error.message}`,
        latencyMs: 0,
      },
    };
  }

  // 5. 执行工具
  const ctx: ToolContext = { sessionId, userMessage };
  try {
    const result = await tool.execute(validation.data, ctx);
    return {
      name: rawCall.name,
      guardrailPass: true,
      degrade: guardrailResult.degrade,
      result,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      name: rawCall.name,
      guardrailPass: true,
      degrade: guardrailResult.degrade,
      result: {
        ok: false,
        data: `工具执行异常: ${errorMsg}`,
        latencyMs: 0,
      },
    };
  }
}

// ── 参数解析 ──────────────────────────────────────────────────

/**
 * 解析 LLM 输出的工具参数 JSON
 *
 * 先尝试直接 JSON.parse，失败则用 ToolGuardrails.repairJson 修复。
 * 修复后仍失败返回 null。
 */
function parseToolArguments(raw: string): Record<string, unknown> | null {
  // 空参数
  if (!raw.trim()) return {};

  // 直接解析
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    // 继续走修复
  }

  // 修复后解析
  const repaired = ToolGuardrails.repairJson(raw);
  if (!repaired) return null;

  try {
    const parsed = JSON.parse(repaired);
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
