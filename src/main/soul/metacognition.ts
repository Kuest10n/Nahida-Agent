/**
 * 元认知表达 —— v1.3.0 灵魂三维（核心差异化）
 *
 * 职责：
 *   1. 检测模型输出的"不确定性"（输出过短、大量模糊词、自相矛盾等）
 *   2. 在 System Prompt 中注入元认知模板，引导模型主动表达不确定性
 *   3. 当检测到高度不确定时，主动建议切换更强模型（deep/plan 档）
 *
 * 哲学意义：
 *   智慧之谦——承认"我不知道"比假装全知更有深度，
 *   苏格拉底式的"我唯一知道的就是我一无所知"。
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 元认知检测结果 */
export interface MetacognitionResult {
  /** 置信度 0-1 */
  confidence: number;
  /** 是否需要表达不确定性 */
  shouldExpressUncertainty: boolean;
  /** 是否需要建议切换模型 */
  shouldSuggestUpgrade: boolean;
  /** 检测原因 */
  reasons: string[];
}

/** 模糊词列表（中文 + 英文） */
const HEDGES = [
  '可能', '也许', '大概', '或许', '好像', '似乎', '应该', '大概', '不一定',
  'maybe', 'perhaps', 'probably', 'might', 'could', 'seems', 'likely',
];

/** 自相矛盾信号词 */
const CONTRADICTIONS = [
  '但是', '不过', '然而', '其实', '实际上', '反过来',
  'but', 'however', 'actually', 'on the other hand',
];

// ── 核心 API ──────────────────────────────────────────────────

/**
 * 分析输出文本的元认知状态
 *
 * @param text 模型输出文本
 * @param modelName 使用的模型名（用于判断是否需要升级）
 * @returns 元认知检测结果
 */
export function analyze(text: string, modelName: string): MetacognitionResult {
  const reasons: string[] = [];
  let confidence = 1.0;

  // 1. 输出过短 → 可能没想清楚
  if (text.length < 50) {
    confidence -= 0.3;
    reasons.push('输出过短');
  }

  // 2. 大量模糊词 → 不确定
  const hedgeCount = HEDGES.reduce((count, word) => {
    const regex = new RegExp(word, 'g');
    const matches = text.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);
  if (hedgeCount >= 3) {
    confidence -= 0.2;
    reasons.push(`含 ${hedgeCount} 个模糊词`);
  }

  // 3. 自相矛盾信号
  const contraCount = CONTRADICTIONS.reduce((count, word) => {
    const regex = new RegExp(word, 'g');
    const matches = text.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);
  if (contraCount >= 2) {
    confidence -= 0.25;
    reasons.push('含自相矛盾信号');
  }

  // 4. 含"不知道/不确定"类表达 → 诚实但 confidence 低
  if (/不知道|不清楚|不确定|不了解|没听说过|无法确认/i.test(text)) {
    confidence -= 0.35;
    reasons.push('主动表达无知');
  }

  // 5. 本地模型 + 复杂问题 → 可能需要升级
  const isLocalModel = modelName.includes('qwen') || modelName.includes('local');
  const isComplex = text.length > 200 && hedgeCount > 0;
  if (isLocalModel && isComplex) {
    confidence -= 0.15;
    reasons.push('本地模型处理复杂问题');
  }

  confidence = Math.max(0, confidence);

  return {
    confidence,
    shouldExpressUncertainty: confidence < 0.6,
    shouldSuggestUpgrade: confidence < 0.4 && isLocalModel,
    reasons,
  };
}

/**
 * 为 System Prompt 附加元认知模板
 *
 * 注入到 agent-core.ts 的 system prompt 构建阶段。
 */
export function getMetacognitionPrompt(): string {
  return `
【元认知指引】
当你对某个问题不太确定时，请诚实表达不确定性，不要假装全知。

表达方式：
- 低置信度（<50%）："这个我不太确定……" / "约三成概率是……"
- 中等置信度（50-80%）："大概有七成把握……" / "如果我没记错的话……"
- 高置信度（>80%）：正常陈述

当你发现自己在猜测时，主动说：
"（指尖轻点下巴）……这部分我的记忆有点模糊，大概是……"

记住：承认不知道，比给错误答案更智慧。
（虚空屏微光一闪）
`;
}

/**
 * 在模型输出后追加元认知提示（如果需要）
 *
 * @param originalText 原始输出
 * @param result 元认知检测结果
 * @returns 处理后的输出
 */
export function appendMetacognitionHint(originalText: string, result: MetacognitionResult): string {
  if (!result.shouldExpressUncertainty) return originalText;

  const hints = [
    '（轻轻摇头）……刚才说的这些，大概有七成把握。',
    '（托腮）……这部分记忆有点模糊，如果不准确请告诉我。',
    '（虚空屏闪烁）……我不是很确定，但大概方向应该是这样。',
    '（微微皱眉）……这个数字……可能记错了？',
  ];

  const hint = hints[Math.floor(Math.random() * hints.length)];

  if (result.shouldSuggestUpgrade) {
    return `${originalText}\n\n${hint}\n\n（小声）……如果需要更准确的答案，可以让我"深入思考"一下。`;
  }

  return `${originalText}\n\n${hint}`;
}

/**
 * 获取元认知统计（供 /stats 使用）
 */
export function getMetacognitionStats(): string {
  return `🤔 元认知统计\n\n` +
    `- 检测维度: 输出长度 / 模糊词 / 自相矛盾 / 模型匹配\n` +
    `- 低置信度阈值: < 60%\n` +
    `- 建议升级阈值: < 40%（本地模型）\n` +
    `\n（花冠轻点）……知之为知之，不知为不知。`;
}
