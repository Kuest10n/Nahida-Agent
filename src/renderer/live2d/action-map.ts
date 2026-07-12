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
  '铃铛轻响':     { tag: '铃铛轻响',     motionGroup: 'Tap',       expression: 'Default',  priority: 3 },
  '花冠微垂':     { tag: '花冠微垂',     motionGroup: 'Idle',      expression: 'Sad',      priority: 5 },
  '草光暗':       { tag: '草光暗',       motionGroup: 'Idle',      expression: 'Sad',      priority: 5 },
  '草光漏':       { tag: '草光漏',       motionGroup: 'Tap',       expression: 'Default',  priority: 3 },
  '藤蔓爬':       { tag: '藤蔓爬',       motionGroup: 'Tap',       expression: 'Default',  priority: 4 },
  '藤蔓卷':       { tag: '藤蔓卷',       motionGroup: 'Special',   expression: 'Default',  priority: 6 },
  '虚空屏亮':     { tag: '虚空屏亮',     motionGroup: 'Special',   expression: 'Default',  priority: 6 },
  '虚空屏微光':   { tag: '虚空屏微光',   motionGroup: 'Idle',      expression: 'Default',  priority: 2 },
  '虚空屏熄':     { tag: '虚空屏熄',     motionGroup: 'Idle',      expression: 'Sad',      priority: 4 },
  '白大褂蹭':     { tag: '白大褂蹭',     motionGroup: 'Tap',       expression: 'Happy',    priority: 3 },

  // ── §出场段 扩展 ──
  '指抵太阳穴':   { tag: '指抵太阳穴',   motionGroup: 'Special',   expression: 'Sad',      priority: 7 },
  '指尖虚空轻点': { tag: '指尖虚空轻点', motionGroup: 'Special',   expression: 'Default',  priority: 6 },
  '闭眼睇':       { tag: '闭眼睇',       motionGroup: 'Idle',      expression: 'Sad',      priority: 5 },
  '草种光':       { tag: '草种光',       motionGroup: 'Special',   expression: 'Happy',    priority: 7 },
  '藤蔓绕腕':     { tag: '藤蔓绕腕',     motionGroup: 'Special',   expression: 'Default',  priority: 8 },
  '铃铛锐响':     { tag: '铃铛锐响',     motionGroup: 'Tap',       expression: 'Surprise', priority: 6 },
  '花冠斜':       { tag: '花冠斜',       motionGroup: 'Tap',       expression: 'Happy',    priority: 4 },
  '袖口蹭粉笔灰': { tag: '袖口蹭粉笔灰', motionGroup: 'Tap',       expression: 'Happy',    priority: 3 },

  // ── worldbook 04-action-tags.md 别名（主模型可能输出的变体） ──
  '虚空屏微光一闪': { tag: '虚空屏微光',   motionGroup: 'Idle',      expression: 'Default',  priority: 2 },
  '指尖轻触':       { tag: '指尖虚空轻点', motionGroup: 'Special',   expression: 'Default',  priority: 6 },
  '闭眼沉思':       { tag: '闭眼睇',       motionGroup: 'Idle',      expression: 'Sad',      priority: 5 },
  '赤足轻点':       { tag: '赤足轻点',     motionGroup: 'Tap',       expression: 'Default',  priority: 3 },
  '白大褂袖口蹭了粉笔灰': { tag: '袖口蹭粉笔灰', motionGroup: 'Tap',  expression: 'Happy',    priority: 3 },
  '窗边看灯火':     { tag: '窗边看灯火',   motionGroup: 'Idle',      expression: 'Sad',      priority: 4 },
};

/** 查不到的 tag 走默认 idle */
export const DEFAULT_ACTION: ActionTag = {
  tag: 'default',
  motionGroup: 'Idle',
  expression: 'Default',
  priority: 1,
};

/**
 * T5 四审 C 维 output.tag → ActionTag
 * 查不到走默认 idle，不炸
 */
export function resolveAction(tag: string): ActionTag {
  return ACTION_MAP[tag] ?? DEFAULT_ACTION;
}
