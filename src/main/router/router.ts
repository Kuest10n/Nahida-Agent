/**
 * 主进程路由层（Router）—— T5 编排核心挂载点
 *
 * 路由流程：
 *   用户消息 → [instruction-guard] 清洗注入 → 三重路由判断 → 模型调用
 *                                                    ↓
 *                                      [degrade-strategy] 降级决策
 *                                                    ↓
 *                              工具调用 → [guardrails] 护栏检查 → 执行工具
 *                                                    ↓
 *                                          四审层审查 → 输出
 *
 * 三重路由判断：
 *   1. 命令 override  — 精确匹配预设命令（/clear /help /switch-model）
 *   2. 关键词粗判    — 根据关键词判断意图（闲聊/思考/工具调用）
 *   3. token 阈值修正 — 根据消息长度修正路由（短消息→local，长消息→cloud）
 */

import { InstructionGuard } from '../safety/instruction-guard';
import { ToolGuardrails, type GuardrailResult, type GuardrailRequest } from '../safety/guardrails';
import { DegradeStrategy, type ModelTier, type DegradeReason, type DegradeDecision } from './degrade-strategy';

// ── 类型定义 ──────────────────────────────────────────────────

/** 路由意图分类 */
export type RouteIntent = 'chat' | 'think' | 'tool' | 'command' | 'unknown';

/** 命令类型（预设命令） */
export type CommandType = '/clear' | '/help' | '/switch-model' | '/stats' | '/switch-persona' | '/balance' | '/hat' | '/reset' | '/ab' | '/plugin' | '/pomodoro' | '/package' | '/wakeup' | '/group';

/** 路由结果 */
export interface RouteResult {
  intent: RouteIntent;
  command?: CommandType;
  degradeDecision: DegradeDecision;
  injectionFlagged: boolean;
  sanitizedMessage: string;
}

/** 路由上下文 */
export interface RouteContext {
  message: string;
  sessionId: string;
  userId?: string;
  timestamp: number;
}

// ── 预设命令列表 ──────────────────────────────────────────────

const COMMAND_PATTERNS: Record<string, CommandType> = {
  '/clear': '/clear',
  '/help': '/help',
  '/switch-model': '/switch-model',
  '/stats': '/stats',
  '/switch-persona': '/switch-persona',
  '/balance': '/balance',
  '/hat': '/hat',
  '/reset': '/reset',
  '/ab': '/ab',
  '/plugin': '/plugin',
  '/pomodoro': '/pomodoro',
  '/package': '/package',
  '/wakeup': '/wakeup',
  '/group': '/group',
};

// ── 关键词意图映射 ────────────────────────────────────────────

/** 工具调用关键词（命中则路由到工具意图） */
const TOOL_KEYWORDS = ['搜索', '查询', '获取', '打开', '创建', '删除', '修改', 'web_fetch'];

/** 深入思考关键词（命中则路由到 think 意图） */
const THINK_KEYWORDS = ['为什么', '分析', '思考', '推理', '规划', '方案', '策略'];

// ── 路由层主体 ────────────────────────────────────────────────

/** 短消息阈值（字符数），低于此强制 local */
const SHORT_MESSAGE_THRESHOLD = 20;
/** 长消息阈值（字符数），超过此强制 standard */
const LONG_MESSAGE_THRESHOLD = 200;
/** Session 超时时间（ms），超过此自动清理 guardrails */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟

/**
 * 主进程路由管理器
 *
 * 整合三道闸门：
 *   1. instruction-guard — 用户消息清洗（挂点1）
 *   2. degrade-strategy  — 降级决策（挂点4）
 *   3. guardrails        — 工具护栏（挂点2）
 */
export class Router {
  /** 指令保护器（全局单例，无状态） */
  private instructionGuard = InstructionGuard;

  /** 工具护栏（每个 session 独立，有状态） */
  private guardrailsMap = new Map<string, ToolGuardrails>();

  /** Session 最后活动时间（用于超时清理） */
  private sessionActivity = new Map<string, number>();

  /** 降级策略（全局单例，有状态） */
  private degradeStrategy = new DegradeStrategy();

  /**
   * 路由用户消息
   *
   * @param ctx 路由上下文
   * @returns 路由结果（意图 + 降级决策 + 清洗后消息）
   */
  route(ctx: RouteContext): RouteResult {
    const { message } = ctx;

    // ── 挂点1：instruction-guard — 用户消息清洗 ──
    const injectionResult = this.instructionGuard.checkUserMessage(message);

    // ── 命令 override ──
    const command = this.matchCommand(injectionResult.sanitizedMessage);
    if (command) {
      return {
        intent: 'command',
        command,
        degradeDecision: {
          tier: 'local',
          modelId: 'local-command',
          degraded: false,
          circuitOpen: false,
        },
        injectionFlagged: injectionResult.flagForReview,
        sanitizedMessage: injectionResult.sanitizedMessage,
      };
    }

    // ── 关键词粗判 ──
    const keywordIntent = this.matchKeywordIntent(injectionResult.sanitizedMessage);

    // ── 挂点4：degrade-strategy — 降级决策 ──
    const degradeDecision = this.degradeStrategy.getDecision();

    // ── token 阈值修正（短消息优先用 local，节省云端开销） ──
    const finalTier = this.adjustTierByLength(injectionResult.sanitizedMessage, degradeDecision.tier);

    return {
      intent: keywordIntent,
      degradeDecision: { ...degradeDecision, tier: finalTier },
      injectionFlagged: injectionResult.flagForReview,
      sanitizedMessage: injectionResult.sanitizedMessage,
    };
  }

  /**
   * 工具调用护栏检查（挂点2）
   *
   * 在工具执行前调用，做频率限制 + 风暴检测。
   */
  checkToolGuard(req: GuardrailRequest): GuardrailResult {
    const now = Date.now();
    this.sessionActivity.set(req.sessionId, now);
    this.cleanupExpiredSessions(now);

    let guardrails = this.guardrailsMap.get(req.sessionId);
    if (!guardrails) {
      guardrails = new ToolGuardrails();
      this.guardrailsMap.set(req.sessionId, guardrails);
    }
    return guardrails.check(req);
  }

  /**
   * 重置 session 的护栏状态（新一轮对话时调用）
   */
  resetSessionGuardrails(sessionId: string): void {
    const guardrails = this.guardrailsMap.get(sessionId);
    guardrails?.resetSession(sessionId);
  }

  /** 清理过期 session（超过 SESSION_TIMEOUT_MS 无活动） */
  private cleanupExpiredSessions(now: number): void {
    for (const [sessionId, lastActivity] of this.sessionActivity) {
      if (now - lastActivity > SESSION_TIMEOUT_MS) {
        this.guardrailsMap.delete(sessionId);
        this.sessionActivity.delete(sessionId);
        console.log(`[Router] cleaned up expired session: ${sessionId}`);
      }
    }
  }

  /**
   * 报告模型调用成功（更新降级策略熔断器）
   */
  reportModelSuccess(tier: ModelTier): void {
    this.degradeStrategy.reportSuccess(tier);
  }

  /**
   * 报告模型调用失败（更新降级策略熔断器）
   */
  reportModelFailure(tier: ModelTier, reason: DegradeReason): void {
    this.degradeStrategy.reportFailure(tier, reason);
  }

  /** 设置模型 ID（从配置注入） */
  setModelId(tier: ModelTier, modelId: string): void {
    this.degradeStrategy.setModelId(tier, modelId);
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 匹配预设命令 */
  private matchCommand(message: string): CommandType | undefined {
    const trimmed = message.trim();
    for (const [pattern, command] of Object.entries(COMMAND_PATTERNS)) {
      if (trimmed.startsWith(pattern)) {
        return command;
      }
    }
    return undefined;
  }

  /** 根据关键词判断意图 */
  private matchKeywordIntent(message: string): RouteIntent {
    // 工具调用关键词（中文 + 英文）
    if (TOOL_KEYWORDS.some(kw => message.includes(kw))) {
      return 'tool';
    }

    // 深入思考关键词（中文）
    if (THINK_KEYWORDS.some(kw => message.includes(kw))) {
      return 'think';
    }

    return 'chat';
  }

  /** 根据消息长度调整 Tier（短消息用 local，长消息用 cloud） */
  private adjustTierByLength(message: string, currentTier: ModelTier): ModelTier {
    const length = message.length;

    // 短消息 → 强制 local（节省云端开销）
    if (length <= SHORT_MESSAGE_THRESHOLD && currentTier !== 'local') {
      return 'local';
    }

    // 长消息 → 强制 standard（需要深度思考）
    if (length > LONG_MESSAGE_THRESHOLD && currentTier === 'local') {
      return 'standard';
    }

    return currentTier;
  }
}
