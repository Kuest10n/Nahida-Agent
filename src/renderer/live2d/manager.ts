/**
 * Live2D 管理器 —— PixiJS 7 + pixi-live2d-display (Cubism 4.0)
 *
 * 职责：
 *   1. Pixi Application 初始化（透明背景，适配 Electron 透明窗）
 *   2. Cubism 4.0 模型加载（.model3.json）
 *   3. 动作播放：从 action-map 查表 → motion + expression
 *   4. IPC 监听：主进程 push 的 live2d:action → 这里播
 *
 * 素材要求：
 *   - 模型格式：Cubism 4.0 (.model3.json)
 *   - 3.0 模型 (.model.json) 需用 Cubism Editor 转 4.0
 *   - 素材没到位时走 stub，不炸渲染
 */

import * as PIXI from 'pixi.js';
// 注意：pixi-live2d-display/cubism4 不用静态 import
// 静态 import 会在模块加载时检查 live2dcubismcore.js，没加载就报错
// 改成动态 import，只在有模型 URL 时才加载 cubism4 模块
import { resolveAction } from './action-map';

// ── 全局状态 ──────────────────────────────────────────────────

/** Pixi Application 实例 */
let app: PIXI.Application | null = null;

/** Live2D 模型实例（类型用 any，因为 cubism4 模块是动态加载的） */
let model: any = null;

/** 当前播放动作的优先级，用于高优先级打断低优先级 */
let currentPriority = 0;

/** 模型是否加载完成 */
let modelReady = false;

// ── 初始化 ────────────────────────────────────────────────────

export interface Live2DInitOptions {
  /** canvas 元素 */
  canvas: HTMLCanvasElement;
  /** .model3.json 路径，传空则走 stub 模式 */
  modelUrl?: string;
  /** 画布宽度，默认 400 */
  width?: number;
  /** 画布高度，默认 600 */
  height?: number;
  /** 模型缩放，默认 0.35 */
  scale?: number;
}

/**
 * 初始化 Pixi + Live2D
 *
 * 素材没到位时 modelUrl 传空，走 stub 模式（只渲染 Pixi 空画布）
 */
export async function initLive2D(options: Live2DInitOptions): Promise<void> {
  const { canvas, modelUrl, width = 400, height = 600, scale = 0.35 } = options;

  // 1. Pixi Application —— 透明背景，适配透明窗
  app = new PIXI.Application({
    view: canvas,
    width,
    height,
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // 2. 有模型 URL → 动态加载 cubism4 模块 + Cubism 4.0 模型
  if (modelUrl) {
    try {
      // 动态 import：只在有模型时才加载 cubism4（避免 stub 模式下报 runtime 缺失）
      const { Live2DModel } = await import('pixi-live2d-display/cubism4');

      // pixi-live2d-display 的 Cubism4Model 需要 PIXI 全局注入
      (window as any).PIXI = PIXI;

      model = await Live2DModel.from(modelUrl);
      app.stage.addChild(model as unknown as PIXI.DisplayObject);

      // 初始位置：居中
      model.anchor.set(0.5, 0.5);
      model.scale.set(scale);
      model.x = app.screen.width / 2;
      model.y = app.screen.height / 2;

      // 初始 Idle 动作
      playMotion('Idle', 0, 1);
      modelReady = true;

      console.log('[Live2D] model loaded:', modelUrl);
    } catch (e) {
      console.warn('[Live2D] model load failed, running stub mode:', e);
      runStubFallback();
    }
  } else {
    // 没有模型 URL → stub 模式
    console.info('[Live2D] no modelUrl provided, running stub mode');
    runStubFallback();
  }

  // 3. 窗口 resize 适配
  // 注：IPC 监听由 live2d.tsx 的 useEffect 负责，避免双重监听导致动作播放两次
  window.addEventListener('resize', handleResize);
}

/** stub 模式：画个草元素光晕占位，不炸 */
function runStubFallback(): void {
  if (!app) return;

  const glow = new PIXI.Graphics();
  glow.beginFill(0x81c784, 0.3);
  glow.drawCircle(app.screen.width / 2, app.screen.height / 2, 80);
  glow.endFill();
  app.stage.addChild(glow);

  // 简单呼吸动画
  let t = 0;
  app.ticker.add(() => {
    t += 0.02;
    const s = 1 + Math.sin(t) * 0.1;
    glow.scale.set(s);
  });

  modelReady = true;
}

// ── 动作播放 ──────────────────────────────────────────────────

export interface PlayActionOptions {
  /** 动作标签，来自 T5 四审 C 维 output.tag */
  tag: string;
  /** 主进程推导的 Cubism Expression 名（可选，覆盖 action-map 默认值） */
  expression?: string;
}

/**
 * 播放动作 —— 主入口
 *
 * 流程：tag → resolveAction → 高打断低 → expression + motion
 * expression 优先用主进程传入的，兜底用 action-map 的默认值
 */
export function playAction(options: PlayActionOptions): void {
  if (!modelReady) return;

  const action = resolveAction(options.tag);
  const expression = options.expression ?? action.expression;

  // 高优先级打断低优先级，同级不打断
  if (action.priority < currentPriority) {
    return;
  }
  currentPriority = action.priority;

  // 先切表情
  if (expression && model) {
    try {
      (model as any).expression(expression);
    } catch {
      // 模型没配这个 expression，忽略
    }
  }

  // 再播动作
  playMotion(action.motionGroup, action.motionIndex ?? 0, action.priority);
}

/**
 * 底层：调用 pixi-live2d-display 的 motion()
 * 播完后重置优先级
 */
function playMotion(group: string, index: number, priority: number): void {
  if (!model) return;

  try {
    (model as any).motion(group, index);

    // 动作结束后重置优先级（pixi-live2d-display 有 motionFinish 事件）
    (model as any).on('motionFinish', () => {
      if (currentPriority === priority) {
        currentPriority = 0;
      }
    });
  } catch (e) {
    // 模型没配这个 motion 组，退回 Idle
    console.warn(`[Live2D] motion "${group}[${index}]" not found:`, e);
    currentPriority = 0;
  }
}

// ── 窗口 resize ───────────────────────────────────────────────

function handleResize(): void {
  if (!app || !model) return;

  // 重新居中
  model.x = app.screen.width / 2;
  model.y = app.screen.height / 2;
}

// ── 手动调试接口（挂 window 上方便控制台测试） ────────────────

(window as any).playNahidaAction = (tag: string) => playAction({ tag });
(window as any).nahidaLive2D = {
  getModel: () => model,
  getApp: () => app,
  isReady: () => modelReady,
};
