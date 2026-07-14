/**
 * 动作标签 —— SOHA §5 行为习惯动作名 → Cubism Motion/Expression 映射
 *
 * 来源：T5 四审 C 维 actionTag
 * Expression 由主进程从 emotion.ts 中央映射表推导后传入
 */
export interface ActionTag {
  /** SOHA 动作名，如 '铃铛轻响' / '花冠微垂' / '草光暗' */
  tag: string;
  /** Cubism Motions 分组键，如 'Tap' / 'Idle' / 'Special' */
  motionGroup: string;
  /** Motions[motionGroup][motionIndex]，缺省 0 */
  motionIndex?: number;
  /** Cubism Expressions 键，如 'Happy' / 'Sad' / 'Surprise' */
  expression?: string;
  /** 优先级 0-10，高优先级打断低优先级 */
  priority: number;
}
