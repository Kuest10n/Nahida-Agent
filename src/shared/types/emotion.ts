/**
 * 纳西妲情绪中央枚举 + 三套标签系统映射表
 *
 * 解决三套标签不对齐的长期隐患：
 *   A: SOHA.md §4.1 英文情绪标签（11 个）→ 主模型输出 [emotion:xxx] → TTS 风格
 *   B: review-layer C 维中文情绪（6 个历史 + 11 个目标）→ 审查员 {tag,voice_type} → expression
 *   C: action-map.ts 中文动作 tag（24+ 别名）→ 主进程抽末句括号 → Cubism motion
 *
 * 数据流：
 *   主模型输出 "...（铃铛轻响）[emotion:happy]"
 *      ↓ 主进程抽
 *   末句 (铃铛轻响) → ACTION_TAG_TO_ENUM → Happy
 *   [emotion:happy] → 直接是中央枚举
 *      ↓ C 维审查员判
 *   {tag:"兴奋"} → CN_TO_ENUM → Happy
 *      ↓ emotionActionMatch 校验
 *   三者一致 → 通过；不一致 → emotion.score 降级
 */

// ── 中央枚举（对齐 SOHA.md §4.1，11 个） ─────────────────────

export enum NahidaEmotion {
  Happy = 'happy',          // 开心 / 兴奋 / 欣慰
  Sad = 'sad',              // 难过 / 悲伤 / 忧伤
  Shy = 'shy',              // 害羞 / 不好意思
  Angry = 'angry',          // 生气 / 不满
  Curious = 'curious',      // 好奇 / 疑惑
  Greeting = 'greeting',    // 问候 / 道别 / 默认日常
  Thinking = 'thinking',    // 思考 / 琢磨
  Lonely = 'lonely',        // 孤独 / 思念 / 怀念
  Playful = 'playful',      // 俏皮 / 调皮
  Surprised = 'surprised',  // 惊讶 / 出乎意料
  Fear = 'fear',            // 担忧 / 紧张
}

/** 默认情绪（C 维模型未识别 / "日常" 兜底） */
export const DEFAULT_EMOTION = NahidaEmotion.Greeting;

// ── 映射表 1: 中文情绪 → 中央枚举 ────────────────────────────

/**
 * review-layer C 维输出的中文 tag → 中央枚举
 *
 * 兼容 v3 训练数据的 6 个标签（悲伤/兴奋/日常/担忧/调皮/怀念）
 * + v4 目标的 11 个完整标签
 */
export const CN_TO_ENUM: Record<string, NahidaEmotion> = {
  // ── v4 完整 11 个 ──
  '开心': NahidaEmotion.Happy,
  '难过': NahidaEmotion.Sad,
  '害羞': NahidaEmotion.Shy,
  '生气': NahidaEmotion.Angry,
  '好奇': NahidaEmotion.Curious,
  '问候': NahidaEmotion.Greeting,
  '思考': NahidaEmotion.Thinking,
  '孤独': NahidaEmotion.Lonely,
  '调皮': NahidaEmotion.Playful,
  '惊讶': NahidaEmotion.Surprised,
  '担忧': NahidaEmotion.Fear,
  '紧张': NahidaEmotion.Fear,

  // ── v3 历史标签兼容 ──
  '兴奋': NahidaEmotion.Happy,        // 兴奋 → Happy
  '悲伤': NahidaEmotion.Sad,          // 悲伤 → Sad
  '日常': NahidaEmotion.Greeting,     // 日常 → Greeting（默认）
  '怀念': NahidaEmotion.Lonely,       // 怀念 → Lonely（最接近）
};

// ── 映射表 2: 中央枚举 → TTS 风格 ────────────────────────────

/**
 * 中央枚举 → TTS 风格描述
 *
 * TTS 模块（待实现）用此选择语音风格；
 * 与 SOHA.md §4.2 "语音根据情绪标签自动调整风格" 对齐
 */
export const ENUM_TO_TTS: Record<NahidaEmotion, string> = {
  [NahidaEmotion.Happy]: '明亮甜美',
  [NahidaEmotion.Sad]: '温柔低语',
  [NahidaEmotion.Shy]: '轻声细语',
  [NahidaEmotion.Angry]: '沉稳有力',
  [NahidaEmotion.Curious]: '上扬疑问',
  [NahidaEmotion.Greeting]: '默认纳西妲腔',
  [NahidaEmotion.Thinking]: '放缓沉吟',
  [NahidaEmotion.Lonely]: '空灵低回',
  [NahidaEmotion.Playful]: '俏皮轻盈',
  [NahidaEmotion.Surprised]: '清亮短促',
  [NahidaEmotion.Fear]: '低沉紧张',
};

// ── 映射表 3: 中央枚举 → Live2D Expression ───────────────────

/**
 * 中央枚举 → Cubism Expression 名
 *
 * 注意：纳西妲 Cubism 模型当前只暴露 4 个 expression
 * (Default/Happy/Sad/Surprise)，多余情绪归并到最接近的
 *
 * 映射依据 action-map.ts 现有 expression 分配：
 *   - Happy: 白大褂蹭/草种光/花冠斜/袖口蹭粉笔灰
 *   - Sad: 花冠微垂/草光暗/虚空屏熄/指抵太阳穴/闭眼睇/窗边看灯火
 *   - Surprise: 铃铛锐响
 *   - Default: 其余
 */
export const ENUM_TO_EXPRESSION: Record<NahidaEmotion, string> = {
  [NahidaEmotion.Happy]: 'Happy',
  [NahidaEmotion.Sad]: 'Sad',
  [NahidaEmotion.Shy]: 'Default',           // 害羞 → Default（无 Shy expression）
  [NahidaEmotion.Angry]: 'Sad',             // 生气 → Sad（无 Angry expression，用 Sad 兜底）
  [NahidaEmotion.Curious]: 'Default',
  [NahidaEmotion.Greeting]: 'Default',
  [NahidaEmotion.Thinking]: 'Default',
  [NahidaEmotion.Lonely]: 'Sad',
  [NahidaEmotion.Playful]: 'Happy',
  [NahidaEmotion.Surprised]: 'Surprise',
  [NahidaEmotion.Fear]: 'Sad',
};

// ── 映射表 4: 动作 tag → 中央枚举 ────────────────────────────

/**
 * 主进程末句括号动作 tag → 中央枚举
 *
 * 来源：action-map.ts 的 24 个动作 + 6 个别名
 * 用于 emotionActionMatch 反查：动作 tag 对应的情绪
 *
 * 依据 SOHA.md §5 行为习惯的情绪语境分配：
 *   - 铃铛轻响/草光漏/藤蔓爬 → 默认/开心
 *   - 花冠微垂/草光暗/虚空屏熄 → 悲伤
 *   - 虚空屏亮/虚空屏微光 → 思考
 *   - 指抵太阳穴/闭眼睇 → 思考/悲伤
 *   - 草种光/花冠斜/袖口蹭粉笔灰 → 开心
 *   - 铃铛锐响 → 惊讶
 *   - 窗边看灯火 → 孤独/怀念
 */
export const ACTION_TAG_TO_ENUM: Record<string, NahidaEmotion> = {
  // ── 开心类 ──
  '铃铛轻响': NahidaEmotion.Happy,
  '草光漏': NahidaEmotion.Happy,
  '藤蔓爬': NahidaEmotion.Happy,
  '草种光': NahidaEmotion.Happy,
  '花冠斜': NahidaEmotion.Happy,
  '袖口蹭粉笔灰': NahidaEmotion.Happy,
  '白大褂蹭': NahidaEmotion.Happy,
  '白大褂袖口蹭了粉笔灰': NahidaEmotion.Happy, // 别名

  // ── 悲伤类 ──
  '花冠微垂': NahidaEmotion.Sad,
  '草光暗': NahidaEmotion.Sad,
  '虚空屏熄': NahidaEmotion.Sad,
  '闭眼睇': NahidaEmotion.Sad,
  '闭眼沉思': NahidaEmotion.Sad,                // 别名

  // ── 思考类 ──
  '虚空屏亮': NahidaEmotion.Thinking,
  '虚空屏微光': NahidaEmotion.Thinking,
  '虚空屏微光一闪': NahidaEmotion.Thinking,     // 别名
  '指尖虚空轻点': NahidaEmotion.Thinking,
  '指尖轻触': NahidaEmotion.Thinking,           // 别名
  '指抵太阳穴': NahidaEmotion.Thinking,

  // ── 惊讶类 ──
  '铃铛锐响': NahidaEmotion.Surprised,

  // ── 孤独/怀念类 ──
  '窗边看灯火': NahidaEmotion.Lonely,

  // ── 默认类（无明显情绪倾向） ──
  '藤蔓卷': NahidaEmotion.Greeting,
  '藤蔓绕腕': NahidaEmotion.Greeting,
  '赤足轻点': NahidaEmotion.Playful,
};

// ── 映射表 5: 中央枚举 → 主中文标签（ruleFallback C 维用） ────

/**
 * 中央枚举 → 主中文标签
 *
 * ruleFallback C 维输出 { tag: "开心", voice_type: "..." }
 * tag 字段需要中文，用此表反查
 *
 * 注意：这是"主"标签，CN_TO_ENUM 里的多个变体（开心/兴奋 → Happy）
 * 反向只返回主标签（Happy → "开心"）
 */
export const ENUM_TO_PRIMARY_CN: Record<NahidaEmotion, string> = {
  [NahidaEmotion.Happy]: '开心',
  [NahidaEmotion.Sad]: '难过',
  [NahidaEmotion.Shy]: '害羞',
  [NahidaEmotion.Angry]: '生气',
  [NahidaEmotion.Curious]: '好奇',
  [NahidaEmotion.Greeting]: '日常',
  [NahidaEmotion.Thinking]: '思考',
  [NahidaEmotion.Lonely]: '孤独',
  [NahidaEmotion.Playful]: '调皮',
  [NahidaEmotion.Surprised]: '惊讶',
  [NahidaEmotion.Fear]: '担忧',
};

// ── 辅助函数 ─────────────────────────────────────────────────

/** 中文情绪 tag → 中央枚举（未命中走默认） */
export function resolveCnEmotion(cn: string): NahidaEmotion {
  return CN_TO_ENUM[cn] ?? DEFAULT_EMOTION;
}

/** 动作 tag → 中央枚举（未命中返回 undefined，调用方判 emotionActionMatch 用） */
export function resolveActionEmotion(actionTag: string): NahidaEmotion | undefined {
  return ACTION_TAG_TO_ENUM[actionTag];
}

/** 中央枚举 → TTS 风格 */
export function resolveTtsStyle(emotion: NahidaEmotion): string {
  return ENUM_TO_TTS[emotion] ?? ENUM_TO_TTS[DEFAULT_EMOTION];
}

/** 中央枚举 → Cubism Expression 名 */
export function resolveExpression(emotion: NahidaEmotion): string {
  return ENUM_TO_EXPRESSION[emotion] ?? ENUM_TO_EXPRESSION[DEFAULT_EMOTION];
}

/** 中央枚举 → 主中文标签（ruleFallback C 维输出 tag 用） */
export function emotionEnumToCn(emotion: NahidaEmotion): string {
  return ENUM_TO_PRIMARY_CN[emotion] ?? ENUM_TO_PRIMARY_CN[DEFAULT_EMOTION];
}
