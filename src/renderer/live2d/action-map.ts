import type { ActionTag } from './types';

/**
 * 动作映射表 —— SOHA §5 行为习惯 + §出场段 → Cubism Motion/Expression
 *
 * 来源：
 *   - §5 行为习惯（10 条常态）：铃铛/花冠/草光/藤蔓/虚空屏/白大褂
 *   - §出场段（扩展）：指抵太阳穴/指尖虚空轻点/闭眼睇/草种光 等
 *
 * T5 四审 C 维 actionTag → 这里查 motion → Pixi 播
 * Expression 由主进程从 emotion.ts 中央映射表推导后传入，覆盖此表默认值
 */
export const ACTION_MAP: Record<string, ActionTag> = {
  // ── §5 行为习惯 常态 ──
  '铃铛轻响':     { tag: '铃铛轻响',     motionGroup: 'Tap',       expression: 'lh',       priority: 3 },
  '花冠微垂':     { tag: '花冠微垂',     motionGroup: 'Idle',      expression: 'hei',      priority: 5 },
  '草光暗':       { tag: '草光暗',       motionGroup: 'Idle',      expression: 'hei',      priority: 5 },
  '草光漏':       { tag: '草光漏',       motionGroup: 'Tap',       expression: 'guang',    priority: 3 },
  '藤蔓爬':       { tag: '藤蔓爬',       motionGroup: 'Tap',       expression: 'yz',       priority: 4 },
  '藤蔓卷':       { tag: '藤蔓卷',       motionGroup: 'Special',   expression: 'yz',       priority: 6 },
  '虚空屏亮':     { tag: '虚空屏亮',     motionGroup: 'Special',   expression: 'guang',    priority: 6 },
  '虚空屏微光':   { tag: '虚空屏微光',   motionGroup: 'Idle',      expression: 'guang',    priority: 2 },
  '虚空屏熄':     { tag: '虚空屏熄',     motionGroup: 'Idle',      expression: 'hei',      priority: 4 },
  '白大褂蹭':     { tag: '白大褂蹭',     motionGroup: 'Tap',       expression: 'lh',       priority: 3 },

  // ── §出场段 扩展 ──
  '指抵太阳穴':   { tag: '指抵太阳穴',   motionGroup: 'Special',   expression: 'hei',      priority: 7 },
  '指尖虚空轻点': { tag: '指尖虚空轻点', motionGroup: 'Special',   expression: 'xx',       priority: 6 },
  '闭眼睇':       { tag: '闭眼睇',       motionGroup: 'Idle',      expression: 'hei',      priority: 5 },
  '草种光':       { tag: '草种光',       motionGroup: 'Special',   expression: 'guang',    priority: 7 },
  '藤蔓绕腕':     { tag: '藤蔓绕腕',     motionGroup: 'Special',   expression: 'yz',       priority: 8 },
  '铃铛锐响':     { tag: '铃铛锐响',     motionGroup: 'Tap',       expression: 'xx',       priority: 6 },
  '花冠斜':       { tag: '花冠斜',       motionGroup: 'Tap',       expression: 'lh',       priority: 4 },
  '袖口蹭粉笔灰': { tag: '袖口蹭粉笔灰', motionGroup: 'Tap',       expression: 'lh',       priority: 3 },

  // ── worldbook 04-action-tags.md 别名（主模型可能输出的变体） ──
  '虚空屏微光一闪': { tag: '虚空屏微光',   motionGroup: 'Idle',      expression: 'guang',    priority: 2 },
  '指尖轻触':       { tag: '指尖虚空轻点', motionGroup: 'Special',   expression: 'xx',       priority: 6 },
  '闭眼沉思':       { tag: '闭眼睇',       motionGroup: 'Idle',      expression: 'hei',      priority: 5 },
  '赤足轻点':       { tag: '赤足轻点',     motionGroup: 'Tap',       expression: 'zs1',      priority: 3 },
  '白大褂袖口蹭了粉笔灰': { tag: '袖口蹭粉笔灰', motionGroup: 'Tap',  expression: 'lh',       priority: 3 },
  '窗边看灯火':     { tag: '窗边看灯火',   motionGroup: 'Idle',      expression: 'lei',      priority: 4 },
};

/** 查不到的 tag 走默认 idle */
export const DEFAULT_ACTION: ActionTag = {
  tag: 'default',
  motionGroup: 'Idle',
  expression: '',
  priority: 1,
};

/**
 * voice_type → Live2D Expression 预映射
 *
 * TTS voice_type（来自四审 C 维）→ Cubism Expression
 * 与 emotion.ts ENUM_TO_EXPRESSION 对齐，提前绑定声音与表情
 *
 * 模型表情映射：guang(发光), hei(黑), lei(泪), lh(脸红), sq(生气), xx(星星), yz(叶子), zs1/zs2/zs3(姿势)
 */
export const VOICE_TO_EXPRESSION: Record<string, string> = {
  '温柔低语': 'hei',
  '明亮甜美': 'lh',
  '明亮': 'lh',
  '轻声细语': '',
  '沉稳有力': '',
  '上扬疑问': 'xx',
  '默认纳西妲腔': '',
  '放缓沉吟': 'hei',
  '空灵低回': 'hei',
  '俏皮轻盈': 'lh',
  '清亮短促': 'xx',
  '低沉紧张': 'sq',
  '低沉': 'hei',
  '轻盈': '',
};

/**
 * T5 四审 C 维 output.tag → ActionTag
 * 查不到走默认 idle，不炸
 */
export function resolveAction(tag: string): ActionTag {
  return ACTION_MAP[tag] ?? DEFAULT_ACTION;
}
