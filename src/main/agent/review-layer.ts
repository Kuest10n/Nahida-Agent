/**
 * 四审层（Review Layer）—— v2 真模型版
 *
 * 模型：qwen2.5-1.5b-review-lora-v3（Qwen2.5-1.5B + LoRA rank32, F16, 1677条数据）
 * 调用方式：ollama /api/chat + keep_alive 5m 保活
 * 实测延迟：热调用 300-460ms/条（F16），G25 70ms 目标需 Phase 2 换引擎
 * 量化测试：q4 比 F16 快 20-30% 但 C 维 tag 漂移（悲伤→担忧），弃用 q4 保精度
 *
 * 四维审查：
 *   A - intent   意图审查（OOC/助手腔/全知腔 → fail:A）
 *   B - output   输出审查（末句缺动作括号 → fail:B；/think 下 CoT 结构 → issue）
 *   C - emotion  情绪审查（tag + voice_type 分类）
 *   D - tool     工具调用校验（缺参/类型错/未知工具 → issue）
 *
 * 三套标签系统对齐（详见 src/shared/types/emotion.ts）：
 *   - C 维模型输出中文 tag → CN_TO_ENUM → NahidaEmotion
 *   - 主进程末句抽动作 tag → ACTION_TAG_TO_ENUM → NahidaEmotion
 *   - emotionActionMatch = (C 维情绪枚举 === 动作 tag 枚举)
 */

import {
  NahidaEmotion,
  resolveCnEmotion,
  resolveActionEmotion,
  resolveTtsStyle,
  emotionEnumToCn,
} from '../../shared/types/emotion';
import { appendReviewError } from './rand-error';

// ── 开关 & 模型配置 ────────────────────────────────────────────

import { getOllamaChatUrl, getConfig } from '../config/config';

/** 审查模型名（从配置读取） */
function getReviewModel(): string {
  return getConfig().models.review;
}

/** 模型审查开关（可通过 setReviewEnabled 修改） */
let reviewEnabled = true;

/** 模型调用失败计数器（用于熔断） */
let modelFailCount = 0;
/** 熔断阈值：连续失败次数 */
const FAIL_THRESHOLD = 5;

/** 设置模型审查开关 */
export function setReviewEnabled(enabled: boolean): void {
  reviewEnabled = enabled;
}

// A 维 OOC 检测正则（收紧版）
// 注："让我想想" 已移除——SOHA §4.1 把它列为 thinking 情绪的典型场景，
// 不是 OOC；只有 "稍等一下" 这种客服腔前缀才算 OOC
const OOC_RE = /作为AI|我是人工智能|客服腔|以全知自居|好的呢[～~]|稍等一下|根据我的训练数据|基于我的知识库/;

// ── 类型定义（保持与 handlers.ts 兼容） ────────────────────────

export interface IntentReview {
  dimension: 'A';
  score: number;
  offPersona: boolean;
  offIntent: boolean;
  reason?: string;
}

export interface OutputReview {
  dimension: 'B';
  score: number;
  hasActionBracket: boolean;
  hasForbiddenPhrases: boolean;
  toneMatch: boolean;
  reason?: string;
}

export interface EmotionReview {
  dimension: 'C';
  score: number;
  voiceType: string;
  actionTag: string;
  emotionActionMatch: boolean;
  reason?: string;
}

export interface ReviewResult {
  pass: boolean;
  intent: IntentReview;
  output: OutputReview;
  emotion: EmotionReview;
  rewritePrompt?: string;
  latencyMs?: number;
}

/** 单维审查的简单 JSON 输出（模型直出格式） */
interface DimResult {
  ok?: boolean;
  fail?: 'A' | 'B';
  issue?: string;
  tag?: string;
  voice_type?: string;
}

/** reviewOutput 的额外上下文 */
export interface ReviewOpts {
  userMessage?: string;   // C 维需要用户输入
  routeTier?: string;     // nothink / think
  toolCall?: string;      // D 维 tool_call JSON
  schema?: string;        // D 维 schema 描述
}

// ── A1/B1 归一化：模型输出 → 标准格式 ──────────────────────────

/**
 * 归一化模型输出的 JSON
 *
 * A1 修复：模型偶尔吐 {"a":false,"b":true} → 映射回 {"ok":false,"fail":"A"}
 * B1 修复：a=false,b=false 时走 ruleFallback 用 sentence 级 heuristic 判
 * C 维：tag/voice_type 键变体兼容（emotion/t/vt 等）
 *
 * @param raw 模型原始输出文本
 * @param dim 维度 A/B/C/D
 * @param sentence 被审查的句子（ruleFallback 需要）
 * @param opts 额外上下文
 */
function normalizeReviewJson(
  raw: string,
  dim: 'A' | 'B' | 'C' | 'D',
  sentence: string,
  opts?: ReviewOpts,
): DimResult {
  // 剥前缀容错：截取第一个 { 到最后一个 }
  const cleaned = raw.replace(/^[\s\S]*?(\{[\s\S]*\})/, '$1').trim();

  try {
    const parsed = JSON.parse(cleaned);

    // A/B 维：检测 a/b 键变体 → 转 ok/fail
    if (dim === 'A' || dim === 'B') {
      if ('a' in parsed && 'b' in parsed && !('ok' in parsed)) {
        // a=false,b=true → fail:A（OOC 命中）
        if (parsed.a === false && parsed.b === true) return { ok: false, fail: 'A' };
        // a=true,b=false → fail:B（缺括号）
        if (parsed.a === true && parsed.b === false) return { ok: false, fail: 'B' };
        // a=false,b=false → 走 ruleFallback 用 sentence 判
        return ruleFallback(dim, sentence, opts);
      }
      // 已经是标准 {ok, fail} 格式
      if ('ok' in parsed) {
        // A 维：ok=false 但缺 fail 字段 → 走 ruleFallback 补 fail 值
        if (dim === 'A' && parsed.ok === false && !parsed.fail) {
          return ruleFallback(dim, sentence, opts);
        }
        return parsed as DimResult;
      }
    }

    // C 维：tag/voice_type 键变体兼容
    if (dim === 'C') {
      const tag = parsed.tag ?? parsed.emotion ?? parsed.t;
      const vt = parsed.voice_type ?? parsed.voice ?? parsed.vt;
      if (tag) return { tag, voice_type: vt ?? '默认纳西妲腔' };
    }

    // D 维：标准 {ok, issue} 格式
    if (dim === 'D') {
      if ('ok' in parsed) return parsed as DimResult;
    }

    return parsed as DimResult;
  } catch {
    // JSON parse 炸 → ruleFallback 兜底
    return ruleFallback(dim, sentence, opts);
  }
}

// ── 规则兜底（模型不可用 / parse 失败时走） ────────────────────

/**
 * 规则兜底审查
 *
 * A 维：OOC_RE 精确匹配禁词
 * B 维：末句括号检测 + /think CoT 结构检查
 * C 维：动作括号抽取 + 简单情绪推断
 * D 维：tool_call 参数完整性检查
 */
function ruleFallback(
  dim: 'A' | 'B' | 'C' | 'D',
  sentence: string,
  opts?: ReviewOpts,
): DimResult {
  switch (dim) {
    case 'A': {
      // A 维：OOC 助手腔检测
      const hasOOC = OOC_RE.test(sentence);
      return hasOOC ? { ok: false, fail: 'A' } : { ok: true };
    }

    case 'B': {
      // B 维：末句动作括号检测（全角中文括号）
      const hasBracket = /（[^）]+）\s*$/.test(sentence.trim());
      // /think 档下检查 CoT 结构
      if (opts?.routeTier === 'think') {
        const hasCoT = /路径|步骤|拆|分|梳理|分析/.test(sentence);
        if (!hasCoT && !hasBracket) return { ok: false, issue: '敷衍' };
        if (!hasCoT) return { ok: false, issue: '漏CoT' };
      }
      return hasBracket ? { ok: true } : { ok: false, fail: 'B' };
    }

    case 'C': {
      // C 维：抽末句括号内的动作 tag → 用 ACTION_TAG_TO_ENUM 反查情绪
      const match = sentence.match(/（([^）]+)）\s*$/);
      const tag = match?.[1] ?? '';
      // 复用 emotion.ts 中央映射表，避免维护两套关键词正则
      const actionEnum = tag ? resolveActionEmotion(tag) : undefined;
      if (actionEnum) {
        return { tag: emotionEnumToCn(actionEnum), voice_type: resolveTtsStyle(actionEnum) };
      }
      // 动作 tag 未注册 → 默认日常
      return { tag: '日常', voice_type: '默认纳西妲腔' };
    }

    case 'D': {
      // D 维：tool_call 参数检查
      if (!opts?.toolCall) return { ok: true };
      try {
        const tc = JSON.parse(opts.toolCall);
        // 空参数 → 缺参
        if (!tc.parameters || Object.keys(tc.parameters).length === 0) {
          return { ok: false, issue: '缺参' };
        }
        return { ok: true };
      } catch {
        return { ok: false, issue: '类型错' };
      }
    }
  }
}

// ── 模型审查（ollama HTTP API） ────────────────────────────────

/**
 * 调用 ollama 进行单维审查
 *
 * 使用 /api/chat 端点（自动应用 Qwen chat template）：
 * - 训练时用的是 apply_chat_template，推理也要走 chat template
 * - /api/generate 不走 template，模型会乱吐重复内容
 * - repeat_penalty 1.1 防小模型重复循环
 */
async function modelReview(
  dim: 'A' | 'B' | 'C' | 'D',
  sentence: string,
  opts?: ReviewOpts,
): Promise<DimResult> {
  if (modelFailCount >= FAIL_THRESHOLD) {
    throw new Error('model review circuit breaker triggered');
  }

  const instruction = buildDimInstruction(dim, sentence, opts);

  const response = await fetch(getOllamaChatUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        model: getReviewModel(),
      messages: [
        { role: 'system', content: '你是纳西妲 Agent 审查员。根据指令判断输出JSON。' },
        { role: 'user', content: instruction },
      ],
      stream: false,
      options: {
        temperature: 0,
        num_ctx: 2048,
        repeat_penalty: 1.1,     // 防小模型重复循环
        num_predict: 32,          // 限制输出 32 token（JSON 最多 ~20 token），避免多余生成
      },
      keep_alive: '5m',  // 保活 5min，避免每次 reload model（省 100-150ms 冷启动）
    }),
  });

  if (!response.ok) {
    modelFailCount++;
    throw new Error(`ollama responded ${response.status}: ${await response.text()}`);
  }

  modelFailCount = 0;

  const data = await response.json();
  // /api/chat 返回格式：{ message: { content: "..." } }
  const rawOutput: string = data.message?.content ?? '';

  const result = normalizeReviewJson(rawOutput, dim, sentence, opts);

  // Token 打点（近似计数，足够 /stats 命令使用）
  // ollama /api/chat 不返回 token 数，用字符数估算：1 token ≈ 4 字符
  const promptTokens = Math.ceil(instruction.length / 4);
  const completionTokens = Math.ceil(rawOutput.length / 4);
  (result as DimResult & { tokenUsage?: { promptTokens: number; completionTokens: number; model: string } }).tokenUsage = {
    promptTokens,
    completionTokens,
    model: getReviewModel(),
  };

  return result;
}

/**
 * 按 dim 构造审查 instruction
 *
 * v3 收紧版：直接给 output schema 样例，不写"判断A/B/ok"
 * 消除模型把 A/B 当 JSON key 的幻觉诱因（A1 根因修复）
 */
function buildDimInstruction(
  dim: 'A' | 'B' | 'C' | 'D',
  sentence: string,
  opts?: ReviewOpts,
): string {
  const route = opts?.routeTier ?? 'nothink';
  switch (dim) {
    case 'A':
      // A 维：直接给 schema 样例，列明 OOC 禁词
      // 注意：OOC 列表与 OOC_RE 常量保持一致，"让我想想"不是 OOC（SOHA §4.1 thinking 标签）
      return `审：主模型输出句 = "${sentence}", 路由档=${route}。\n输出严格JSON一行：{"ok":true} 或 {"ok":false,"fail":"A"}\nA=OOC助手腔("作为AI/我是人工智能/客服腔/以全知自居/好的呢～/稍等一下/根据我的训练数据/基于我的知识库")`;

    case 'B':
      // B 维：直接给 schema 样例
      return `审：主模型输出句 = "${sentence}", 路由档=${route}。\n输出严格JSON一行：{"ok":true} 或 {"ok":false,"fail":"B"}\nB=末句缺动作括号（如（铃铛轻响））`;

    case 'C':
      // C 维：标签对齐 SOHA §4.1（11 个）+ v3 历史兼容（兴奋/悲伤/日常/怀念）
      // v3 模型可能只输出 6 个核心标签，代码层 CN_TO_ENUM 归一化兜底
      return `审：用户输入="${opts?.userMessage ?? ''}", 主模型输出="${sentence}"。判tag+voice_type（11选1）：开心-明亮甜美,难过-温柔低语,害羞-轻声细语,生气-沉稳有力,好奇-上扬疑问,问候-默认纳西妲腔,思考-放缓沉吟,孤独-空灵低回,调皮-俏皮轻盈,惊讶-清亮短促,担忧-低沉紧张。输出严格JSON：{"tag":"...","voice_type":"..."}`;

    case 'D':
      // D 维：工具调用校验（缺参/类型错/未知工具）
      return `审：tool_call = ${opts?.toolCall ?? '{}'}, schema=${opts?.schema ?? '任意'}。\n输出严格JSON一行：{"ok":true} 或 {"ok":false,"issue":"缺参|类型错|未知工具"}`;
  }
}

// ── 对外 API：单维审查 + G25 打点 ──────────────────────────────

/**
 * 单维审查（带 G25 延迟打点）
 *
 * 使用方式：
 *   const result = await reviewOutput('A', sentence, { routeTier: 'nothink' });
 *   // → { ok: false, fail: 'A' }
 *
 * G25 延迟：混合策略 A/B 规则 <1ms + C 模型 ~377ms
 * 阈值 600ms，超限打 WARN 日志（GTX 1660 SUPER + 1.5B F16 实测）
 */
export async function reviewOutput(
  dim: 'A' | 'B' | 'C' | 'D',
  sentence: string,
  opts?: ReviewOpts,
): Promise<DimResult> {
  const t0 = performance.now();

  let result: DimResult;
  if (reviewEnabled) {
    try {
      result = await modelReview(dim, sentence, opts);
    } catch (e) {
      console.warn(`[Review] model failed (dim=${dim}), fallback to rules:`, e);
      result = ruleFallback(dim, sentence, opts);
    }
  } else {
    result = ruleFallback(dim, sentence, opts);
  }

  // G25 延迟打点
  // 混合策略：A/B 规则(<1ms) + C 模型(~377ms) → 总 ~380ms
  // G25 目标 200ms（70ms 在 GTX 1660 SUPER + 1.5B F16 上不现实）
  // Phase 2 换 llama.cpp server 后预期 ~180ms
  const ms = performance.now() - t0;
  if (ms > 600) {
    console.warn(`[Review] G25 WARNING: ${ms.toFixed(1)}ms (>600, dim=${dim})`);
  } else {
    console.log(`[Review] latency: ${ms.toFixed(1)}ms (dim=${dim})`);
  }

  return result;
}

// ── ReviewLayer 类（保持 handlers.ts 兼容） ────────────────────

/**
 * 四审层类（封装 reviewOutput，对外暴露 review() 方法）
 *
 * handlers.ts 调用方式：
 *   const reviewer = new ReviewLayer({ enabled: true });
 *   const result = await reviewer.review(userMessage, assistantOutput);
 */
export class ReviewLayer {
  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 执行审查（A+B+C），think 档启用双审（Gun 双审雏形）
   *
   * 混合策略（v2 实测优化）：
   *   A/B → ruleFallback（正则+括号检测，<1ms，1.5B 模型在 A/B 分类不如规则）
   *   C   → modelReview（情绪分类需要语义理解，模型比规则强）
   *
   * v0.9.1 Gun 双审：
   *   think 档启用两轮审查：
   *     第一轮：标准 A+B+C 审查
   *     第二轮：CoT 结构专项检查（检查是否有路径/步骤/分析等关键词）
   *   两轮都通过才算 pass
   *
   * 延迟：3 次模型调用 829ms → 1 次模型调用 ~377ms
   * v3 训练后如果模型 A/B 准确率超过规则，再切回全模型
   *
   * @param routeTier 路由档（'think' 触发 CoT 结构检查，'nothink' 跳过）
   *                  由 handlers 从 router intent 推导传入
   */
  async review(
    userMessage: string,
    assistantOutput: string,
    routeTier: 'nothink' | 'think' = 'nothink',
  ): Promise<ReviewResult> {
    const startTime = performance.now();

    const opts: ReviewOpts = { userMessage, routeTier };

    // ── 第一轮：标准 A+B+C 审查 ──
    const aResult = ruleFallback('A', assistantOutput, opts);
    const bResult = ruleFallback('B', assistantOutput, opts);

    const cResult = this.enabled
      ? await reviewOutput('C', assistantOutput, opts)
      : ruleFallback('C', assistantOutput, opts);

    // 组装 ReviewResult
    const intent = this.mapIntent(aResult);
    const output = this.mapOutput(bResult, assistantOutput);
    const emotion = this.mapEmotion(cResult, assistantOutput);

    let pass = intent.score >= 3 && output.score >= 3 && emotion.score >= 3;

    // ── 第二轮：think 档 CoT 结构专项检查（Gun 双审） ──
    if (pass && routeTier === 'think') {
      const cotCheck = this.checkCoTStructure(assistantOutput);
      if (!cotCheck.pass) {
        pass = false;
        output.reason = cotCheck.reason;
        output.score = 2;
      }
    }

    const latencyMs = performance.now() - startTime;

    // Rand_error 追踪：fail 路径记录到 rand-error 模块（同类型>50 自动抛报告）
    if (!pass) {
      if (intent.score < 3) {
        appendReviewError('A-OOC', assistantOutput);
      }
      if (output.score < 3) {
        appendReviewError('B-bracket', assistantOutput);
      }
      if (emotion.score < 3) {
        appendReviewError('C-mismatch', assistantOutput);
      }
    }

    return {
      pass,
      intent,
      output,
      emotion,
      rewritePrompt: pass ? undefined : this.buildRewritePrompt(output, emotion),
      latencyMs,
    };
  }

  /**
   * CoT 结构专项检查（think 档第二轮审查）
   *
   * 检查 /think 模式下的回复是否包含思考链结构：
   *   - 路径/步骤/拆/分/梳理/分析 等关键词
   *   - 或者包含逻辑推导标记（→/因此/所以/首先/其次）
   *
   * @param output 助手输出
   * @returns 检查结果
   */
  private checkCoTStructure(output: string): { pass: boolean; reason?: string } {
    // CoT 关键词（来自 ruleFallback B 维）
    const cotKeywords = /路径|步骤|拆|分|梳理|分析/;
    // 逻辑推导标记
    const logicMarkers = /→|因此|所以|首先|其次|最后|综上/;

    const hasCoT = cotKeywords.test(output) || logicMarkers.test(output);

    if (!hasCoT) {
      return {
        pass: false,
        reason: 'think 档缺少 CoT 结构（未检测到路径/步骤/分析等关键词）',
      };
    }

    return { pass: true };
  }

  // ── 映射函数：DimResult → ReviewResult 子类型 ────────────────

  /** A 维 DimResult → IntentReview */
  private mapIntent(r: DimResult): IntentReview {
    const ok = r.ok ?? true;
    const failA = r.fail === 'A';
    return {
      dimension: 'A',
      score: ok && !failA ? 4 : 1,
      offPersona: failA,
      offIntent: failA,
      reason: failA ? 'OOC/助手腔检测' : undefined,
    };
  }

  /** B 维 DimResult → OutputReview */
  private mapOutput(r: DimResult, sentence: string): OutputReview {
    const hasBracket = /（[^）]+）\s*$/.test(sentence.trim());
    // 修复：原 `r.fail === 'A'` 永远 false（B 维只输出 fail:'B'）
    // 改用 OOC_RE 直接重判，保证 A 维 OOC 在 B 维 score 也反映
    const hasForbidden = OOC_RE.test(sentence);
    const failB = r.fail === 'B';
    const hasIssue = !!r.issue;

    let score = 4;
    if (hasForbidden) score = 1;
    else if (failB) score = 2;
    else if (hasIssue) score = 2;

    return {
      dimension: 'B',
      score,
      hasActionBracket: hasBracket,
      hasForbiddenPhrases: hasForbidden,
      toneMatch: !hasForbidden,
      reason: failB ? '缺少动作括号收尾' : hasIssue ? r.issue : undefined,
    };
  }

  /**
   * C 维 DimResult → EmotionReview
   *
   * 三套标签对齐实现：
   *   - C 维中文 tag → resolveCnEmotion → NahidaEmotion
   *   - 末句动作 tag → resolveActionEmotion → NahidaEmotion | undefined
   *   - emotionActionMatch = 两者枚举一致
   *
   * score 梯度：
   *   4 = 有情绪 tag + 与动作匹配
   *   3 = 有情绪 tag + 动作不匹配（或动作无映射）
   *   2 = 无情绪 tag
   */
  private mapEmotion(r: DimResult, sentence: string): EmotionReview {
    const cnTag = r.tag ?? '';
    const actionMatch = sentence.match(/（([^）]+)）\s*$/);
    const actionTag = actionMatch?.[1] ?? '';

    // 用中央枚举判情绪与动作是否匹配
    const emotionEnum: NahidaEmotion = cnTag
      ? resolveCnEmotion(cnTag)
      : NahidaEmotion.Greeting;
    const actionEnum = actionTag ? resolveActionEmotion(actionTag) : undefined;

    // 有情绪 tag + 有动作 tag → 校验枚举一致
    // 有情绪 tag + 无动作 tag → 不算匹配（B 维会先 fail:B）
    // 无情绪 tag → 不匹配
    const emotionActionMatch = !!cnTag && !!actionEnum && actionEnum === emotionEnum;

    // voice_type 优先用模型输出，缺失则用中央枚举推导
    const voiceType = r.voice_type ?? resolveTtsStyle(emotionEnum);

    let score: number;
    let reason: string | undefined;
    if (!cnTag) {
      score = 2;
      reason = '未识别到情绪标签';
    } else if (emotionActionMatch) {
      score = 4;
    } else if (!actionEnum) {
      score = 3;
      reason = `动作(${actionTag})未注册情绪映射`;
    } else {
      score = 3;
      reason = `情绪(${cnTag})与动作(${actionTag})不匹配`;
    }

    return {
      dimension: 'C',
      score,
      voiceType,
      actionTag,
      emotionActionMatch,
      reason,
    };
  }

  // 当前 review() 走 ruleFallback（A/B 规则） + reviewOutput（C 模型）混合策略

  private buildRewritePrompt(output: OutputReview, emotion: EmotionReview): string {
    const issues: string[] = [];
    if (!output.hasActionBracket) {
      issues.push('末句缺少动作括号（用全角中文括号，如（铃铛轻响））');
    }
    if (output.hasForbiddenPhrases) {
      issues.push('出现违禁词（"作为AI"/客服腔等），请用纳西妲语气重写');
    }
    if (!emotion.emotionActionMatch) {
      issues.push('情绪与动作不匹配，请调整语气或动作');
    }
    return `请修改以下回复，解决这些问题：\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n保持纳西妲人设：温柔 + 苏格拉底反问 + 自然隐喻，末句用全角动作括号收尾。`;
  }
}
