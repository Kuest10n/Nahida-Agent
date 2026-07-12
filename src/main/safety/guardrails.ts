/**
 * 工具护栏（Tool Guardrails）—— 借鉴 Xiaoda tool_guardrails.py
 *
 * 三道闸门按序执行：
 *   1. 频率限制 — 同一工具 10s 窗口内最多 3 次，超限直接拒绝
 *   2. 风暴检测 — 同一 session 一轮对话内 >5 次调用，标记 degrade 让路由层降级
 *   3. 参数修复 — 模型输出的 JSON 畸形时尝试自动修（静态方法，解析前调用）
 *
 * 设计原则：护栏只做"守门员"，不做工具执行。执行交给 ToolExecutor。
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 单次工具调用记录（用于频率+风暴统计） */
interface ToolCallRecord {
  toolName: string;
  sessionId: string;
  timestamp: number;
}

/** 护栏检查结果 */
export interface GuardrailResult {
  /** 是否放行 */
  pass: boolean;
  /** 是否建议降级（风暴触发时 pass=true 但 degrade=true） */
  degrade: boolean;
  /** 拒绝/降级原因（纳西妲腔模板 key，渲染层从 SOHA.md 取） */
  reason?: 'rate_limited' | 'storm_detected';
  /** 人类可读的拒绝原因 */
  message?: string;
}

/** 工具调用请求（护栏输入） */
export interface GuardrailRequest {
  toolName: string;
  parameters: Record<string, unknown>;
  sessionId: string;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 频率限制窗口：10 秒 */
const RATE_WINDOW_MS = 10_000;
/** 窗口内最大调用次数 */
const RATE_MAX_CALLS = 3;
/** 风暴检测阈值：一轮对话内超过此值 → 降级 */
const STORM_THRESHOLD = 5;
/** 一轮对话的判定窗口：60 秒内的调用算"一轮" */
const ROUND_WINDOW_MS = 60_000;

// ── 护栏主体 ──────────────────────────────────────────────────

/**
 * 工具护栏管理器
 *
 * 每个 AgentCore 实例持有一个，生命周期跟 session 走。
 * 调用 `check()` 在工具执行前做三道闸门检查。
 */
export class ToolGuardrails {
  /** 调用历史（按时间顺序追加，定期清理过期项） */
  private history: ToolCallRecord[] = [];

  /**
   * 检查工具调用是否通过护栏
   *
   * @returns pass=true 可执行；pass=false 拒绝并带 reason
   *          degrade=true 时 pass 仍为 true，但建议路由层降级
   */
  check(req: GuardrailRequest): GuardrailResult {
    const now = Date.now();
    this.purgeExpired(now);

    // 闸 1：频率限制
    const rateResult = this.checkRateLimit(req.toolName, req.sessionId, now);
    if (!rateResult.pass) {
      return rateResult;
    }

    // 闸 2：风暴检测（不拒绝，只标记降级）
    const stormResult = this.checkStorm(req.sessionId, now);

    // 记录本次调用
    this.history.push({
      toolName: req.toolName,
      sessionId: req.sessionId,
      timestamp: now,
    });

    return stormResult;
  }

  /**
   * 闸 1：频率限制
   * 同一工具 + 同一 session 在 RATE_WINDOW_MS 内最多 RATE_MAX_CALLS 次
   */
  private checkRateLimit(
    toolName: string,
    sessionId: string,
    now: number,
  ): GuardrailResult {
    const windowStart = now - RATE_WINDOW_MS;
    const recentCalls = this.history.filter(
      (r) =>
        r.toolName === toolName &&
        r.sessionId === sessionId &&
        r.timestamp > windowStart,
    );

    if (recentCalls.length >= RATE_MAX_CALLS) {
      return {
        pass: false,
        degrade: false,
        reason: 'rate_limited',
        message: `工具 "${toolName}" 10 秒内已调用 ${recentCalls.length} 次，超限`,
      };
    }

    return { pass: true, degrade: false };
  }

  /**
   * 闸 2：风暴检测
   * 同一 session 在 ROUND_WINDOW_MS 内总调用 > STORM_THRESHOLD → 标记降级
   */
  private checkStorm(sessionId: string, now: number): GuardrailResult {
    const windowStart = now - ROUND_WINDOW_MS;
    const roundCalls = this.history.filter(
      (r) => r.sessionId === sessionId && r.timestamp > windowStart,
    );

    // 加上当前这次（还没记录进 history）
    const totalInRound = roundCalls.length + 1;

    if (totalInRound > STORM_THRESHOLD) {
      return {
        pass: true,
        degrade: true,
        reason: 'storm_detected',
        message: `本轮已调用 ${totalInRound} 次工具，建议降级`,
      };
    }

    return { pass: true, degrade: false };
  }

  /** 清理过期记录，防止 history 无限增长 */
  private purgeExpired(now: number): void {
    const cutoff = now - ROUND_WINDOW_MS;
    this.history = this.history.filter((r) => r.timestamp > cutoff);
  }

  /** 重置某个 session 的调用记录（新一轮对话时调用） */
  resetSession(sessionId: string): void {
    this.history = this.history.filter((r) => r.sessionId !== sessionId);
  }

  // ── 静态方法：JSON 参数修复 ──────────────────────────────────

  /**
   * 闸 3（静态）：修复模型输出的畸形 JSON
   *
   * 在从模型文本提取 tool_call → JSON.parse 之前调用。
   * 处理常见 LLM 输出问题：
   *   - 尾逗号：{"q": "test",} → {"q": "test"}
   *   - 单引号：{'q': 'test'} → {"q": "test"}（含嵌套单引号处理）
   *   - 缺引号键：{q: "test"} → {"q": "test"}
   *   - 多行字符串：换行保留，不破坏 JSON 结构
   *   - 键名含连字符：{"my-key":} → 正确保留引号
   *
   * @returns 修复后的字符串；如果无法修复返回 null
   */
  static repairJson(raw: string): string | null {
    let s = raw.trim();

    // 去掉 markdown 代码块包裹
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    // 去尾逗号：}", 或 ",} → "} / "}
    s = s.replace(/,\s*([}\]])/g, '$1');

    // 单引号 → 双引号（安全版本：逐字符扫描，避免破坏转义）
    s = this.fixSingleQuotes(s);

    // 缺引号键：{query: → {"query":
    // 匹配 { 或 , 后面跟 标识符: 但标识符没被引号包裹
    // 注意：跳过已被双引号包裹的键
    s = s.replace(/([{,]\s*)([a-zA-Z_][\w-]*)\s*:/g, '$1"$2":');

    // 验证修复后是否合法
    try {
      JSON.parse(s);
      return s;
    } catch {
      return null;
    }
  }

  /**
   * 安全替换单引号为双引号
   *
   * 逐字符扫描，处理：
   *   - 单引号包裹的键：'key' → "key"
   *   - 单引号包裹的值：'value' → "value"（含嵌套单引号转义）
   *   - 已有的双引号和转义序列保持不变
   */
  private static fixSingleQuotes(s: string): string {
    const result: string[] = [];
    const chars = s.split('');

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;

      if (char === '\\' && i + 1 < chars.length) {
        result.push(char, chars[i + 1]!);
        i++;
        continue;
      }

      if (char === '"') {
        result.push(char);
        continue;
      }

      if (char === "'") {
        result.push('"');
        i++;

        while (i < chars.length) {
          const innerChar = chars[i]!;

          if (innerChar === '\\' && i + 1 < chars.length && chars[i + 1] === "'") {
            result.push('\\"');
            i++;
            continue;
          }

          if (innerChar === "'") {
            result.push('"');
            break;
          }

          result.push(innerChar);
          i++;
        }
        continue;
      }

      result.push(char);
    }

    return result.join('');
  }
}
