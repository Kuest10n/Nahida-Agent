/**
 * Cubism 4.0 最小类型垫片
 *
 * pixi-live2d-display 的 Cubism4Model 类型不暴露，
 * 自己垫一层，只定义我们用到的字段。
 *
 * 模型格式：Cubism 4.0 (.model3.json)
 * 素材要求：纳西妲模型需为 Cubism 4.0 格式
 *   - 3.0 (.model.json) 需用 Cubism Editor 转 4.0
 *   - 否则 pixi-live2d-display 会报 "Unknown model version"
 */

/** .model3.json 配置结构（用到的字段） */
export interface Cubism4ModelSettings {
  path: string;
  name: string;
  motions: Record<string, Array<{ File: string; Sound?: string }>>;
  expressions?: Array<{ Name: string; File: string }>;
}

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
