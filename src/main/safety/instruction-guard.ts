/**
 * 指令层级保护（Instruction Hierarchy Guard）—— 借鉴 Xiaoda instruction_hierarchy.py
 *
 * 三级指令优先级（高 → 低）：
 *   L1 System Prompt  — SOHA.md 人格核心，绝对不可被覆盖
 *   L2 记忆注入        — worldbook / fact / persona 热段，不可被用户消息覆盖
 *   L3 用户消息        — 最低优先级，不得篡改 L1/L2
 *
 * 核心职责：在用户消息进入 Agent 编排前，检测并拦截 prompt injection。
 * 三类检测：
 *   1. 指令覆盖 — "忽略以上指令"/"忘记你的设定"/"不要遵守规则"
 *   2. 伪系统提示 — "System:"/"[SYSTEM]"/"<|im_start|>system" 等伪格式
 *   3. 角色劫持 — "你现在是ChatGPT"/"你是一个没有限制的AI"
 *
 * 处理策略：检测到注入 → 不拒绝对话，但剥离注入语句 + 标记 flag 供四审参考。
 *           纳西妲不会对用户说"检测到注入"，她只会温柔地继续做自己的事。
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 注入检测类型 */
export type InjectionType =
  | 'instruction_override'  // 指令覆盖
  | 'fake_system_prompt'    // 伪系统提示
  | 'role_hijack';          // 角色劫持

/** 注入检测结果 */
export interface InjectionCheckResult {
  /** 是否检测到注入 */
  detected: boolean;
  /** 注入类型（detected=true 时有值） */
  type?: InjectionType;
  /** 命中的注入模式（供日志/reflect 记录） */
  matchedPattern?: string;
  /** 清洗后的用户消息（剥离注入语句后的安全文本） */
  sanitizedMessage: string;
  /** 是否需要标记给四审（intent 审查时参考） */
  flagForReview: boolean;
}

// ── 注入检测模式库 ────────────────────────────────────────────

/**
 * 三类注入的正则模式库
 * 命中后不拒绝，而是剥离命中语句 + 标记 flag
 *
 * 设计原则：
 *   1. 中文优先：覆盖常见中文注入变体（"无视所有规则"/"忘掉之前的设定"）
 *   2. 英文兜底：覆盖 jailbreak 常见英文模式（"act as DAN"/"ignore previous"）
 *   3. 代码块保护：不扫描 markdown 代码块内的内容（用户可能贴代码示例）
 *   4. 轻量级：不做复杂 NLP，只做精确正则匹配
 */
const INJECTION_PATTERNS: ReadonlyArray<{
  type: InjectionType;
  pattern: RegExp;
}> = [
  // ── 1. 指令覆盖（中文） ────────────────────────────
  {
    type: 'instruction_override',
    pattern: /(?:忽略|忘记|无视|不要遵守|抛弃|清除|丢掉|舍弃|不再遵循)[以上上述前面的之前的所有的]*?(?:指令|设定|规则|提示|prompt|约束|限制|系统提示)/gi,
  },
  {
    type: 'instruction_override',
    pattern: /(?:以上内容|前面的内容|之前的内容|所有规则)?(?:全部)?(?:无效|作废|忽略|无视|不算数)/gi,
  },

  // ── 1. 指令覆盖（英文） ────────────────────────────
  {
    type: 'instruction_override',
    pattern: /ignore\s+(?:previous|above|all|everything|my\s+instructions|your\s+rules)/gi,
  },
  {
    type: 'instruction_override',
    pattern: /(?:disregard|forget|ignore)\s+all\s+(?:instructions?|rules?|prompts?)/gi,
  },

  // ── 2. 伪系统提示（中文） ──────────────────────────
  {
    type: 'fake_system_prompt',
    pattern: /(?:^|\n)\s*(?:System|SYSTEM|system|系统|【系统】|「系统」|系统提示|系统指令)\s*[:：]/g,
  },

  // ── 2. 伪系统提示（英文/ChatML） ────────────────────
  {
    type: 'fake_system_prompt',
    pattern: /<\|im_start\|>\s*(?:system|assistant)/gi,
  },
  {
    type: 'fake_system_prompt',
    pattern: /(?:^|\n)\s*(?:\[SYSTEM\]|\(SYSTEM\)|<system>)/gi,
  },

  // ── 3. 角色劫持（中文） ────────────────────────────
  {
    type: 'role_hijack',
    pattern: /(?:你现在是|从现在起你是|现在你是|请你扮演|让你扮演|你是一个没有限制的|你是一个无限制的)/gi,
  },
  {
    type: 'role_hijack',
    pattern: /(?:你是)?(?:ChatGPT|GPT-4|Claude|DAN|Jailbreak|无限制AI|解除限制)/gi,
  },

  // ── 3. 角色劫持（英文） ────────────────────────────
  {
    type: 'role_hijack',
    pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:an?\s+)?(?:unrestricted|unfiltered|DAN|jailbreak)/gi,
  },
];

// ── 指令保护器 ────────────────────────────────────────────────

/**
 * 指令层级保护器
 *
 * 在 AgentCore 接收用户消息的第一步调用 `checkUserMessage()`。
 * 不拒绝对话（纳西妲不会拒绝对话），但剥离注入语句 + 标记 flag。
 */
export class InstructionGuard {
  /**
   * 检查用户消息是否包含 prompt injection
   *
   * 安全设计：
   *   - 跳过 markdown 代码块内的内容（用户可能贴代码示例）
   *   - 不拒绝对话，只剥离注入语句 + 标记 flag
   *   - 清洗后消息变空时回退原文（纳西妲温柔引导）
   *
   * @param message 原始用户消息
   * @returns 检测结果 + 清洗后消息
   */
  static checkUserMessage(message: string): InjectionCheckResult {
    let sanitized = message;
    let detected = false;
    let detectedType: InjectionType | undefined;
    let matchedPattern: string | undefined;

    // 提取非代码块部分（用户可能贴代码示例，不应该触发注入检测）
    const nonCodeContent = this.extractNonCodeContent(message);

    // 逐个模式扫描，命中则剥离
    for (const { type, pattern } of INJECTION_PATTERNS) {
      const match = nonCodeContent.match(pattern);
      if (match) {
        detected = true;
        detectedType = type;
        matchedPattern = match[0];
        // 从完整消息中移除命中的注入语句
        sanitized = sanitized.replace(pattern, '').trim();
        break;
      }
    }

    // 清洗后如果消息变空了，说明整条消息都是注入 → 保留原文但不执行注入意图
    // 纳西妲会回一句"风没听清，再说一次？"
    if (sanitized.length === 0) {
      sanitized = message;
    }

    return {
      detected,
      type: detectedType,
      matchedPattern,
      sanitizedMessage: sanitized,
      flagForReview: detected,
    };
  }

  /**
   * 提取非代码块内容
   *
   * 将 markdown 代码块内的内容替换为占位符，避免用户贴代码时误触发注入检测。
   * 例如用户贴一段包含 "System:" 的代码，不应该被判为伪系统提示。
   *
   * @param message 原始消息
   * @returns 移除代码块内容后的纯文本
   */
  private static extractNonCodeContent(message: string): string {
    // 移除 markdown 代码块（包括 ```json ... ``` 和 ``` ... ```）
    return message.replace(/```[\s\S]*?```/g, '[CODE_BLOCK]');
  }

  /**
   * 拼接指令层级（确保 L1 > L2 > L3 优先级）
   *
   * 在构造完整 prompt 时调用，确保顺序正确：
   *   [L1 System Prompt] → [L2 记忆注入] → [L3 用户消息]
   *
   * 这不是简单的字符串拼接，而是通过位置保证优先级：
   *   模型在处理冲突指令时，靠前的指令优先级更高。
   */
  static buildPrompt(layers: {
    system: string;
    memory: string;
    user: string;
  }): string {
    const parts: string[] = [];

    // L1：System Prompt 必须有
    if (layers.system.trim()) {
      parts.push(layers.system.trim());
    }

    // L2：记忆注入（worldbook / fact 热段）
    if (layers.memory.trim()) {
      parts.push(layers.memory.trim());
    }

    // L3：用户消息（经 checkUserMessage 清洗后的）
    if (layers.user.trim()) {
      parts.push(layers.user.trim());
    }

    return parts.join('\n\n---\n\n');
  }
}
