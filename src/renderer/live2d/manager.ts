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

/** 音频上下文，用于口型同步 */
let audioContext: AudioContext | null = null;

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
    // @ts-expect-error pixi-live2d-display 需要 events 属性，但 PixiJS 7 类型定义未包含
    events: true,
  });

  // 兼容 pixi-live2d-display 的 deprecated interaction API
  // PixiJS 7.x 使用 renderer.events，而 pixi-live2d-display 期望一个有 .on()/.off() 方法的对象
  if (!app.renderer.plugins.interaction) {
    (app.renderer.plugins as any).interaction = {
      on: () => {},
      off: () => {},
    };
  }

  // 2. 有模型 URL → 动态加载 cubism4 模块 + Cubism 4.0 模型
  if (modelUrl) {
    try {
      // 动态 import：只在有模型时才加载 cubism4（避免 stub 模式下报 runtime 缺失）
      const { Live2DModel } = await import('pixi-live2d-display/cubism4');

      // pixi-live2d-display 的 Cubism4Model 需要 PIXI 全局注入
      (window as any).PIXI = PIXI;

      model = await Live2DModel.from(modelUrl);
      app.stage.addChild(model as unknown as PIXI.DisplayObject);

      // 禁用自动交互（避免 pixi-live2d-display 与 PixiJS 7.x 的交互兼容性问题）
      (model as any)._autoInteract = false;

      // 初始位置：让模型完全适应 canvas 高度（避免显示过大只看到局部）
      // 思路：先按用户传入的 scale，再用 model.width/height 真实画布尺寸做 fit，取较小值
      const fitScale = (() => {
        try {
          // cubism4 的 internalModel 有 originalPixelsWidth/Height，是模型原画布尺寸
          const internal: any = (model as any).internalModel;
          const modelW = internal?.originalPixelsWidth || (model as any).width || 0;
          const modelH = internal?.originalPixelsHeight || (model as any).height || 0;
          if (modelW <= 0 || modelH <= 0) return scale;

          console.log('[Live2D] model native size:', { modelW, modelH, canvasW: width, canvasH: height });

          // 取 width 和 height 两个方向都能塞下的最大 scale
          const fitW = (width * 0.9) / modelW;
          const fitH = (height * 0.9) / modelH;
          const fitted = Math.min(fitW, fitH);

          // 用户传入的 scale 作为上限（用户希望别太小）
          return Math.min(scale, fitted);
        } catch {
          return scale;
        }
      })();

      model.anchor.set(0.5, 0.5);
      model.scale.set(fitScale);

      // 居中（垂直方向也居中，让模型完全可见）
      model.x = app.screen.width / 2;
      model.y = app.screen.height / 2;

      console.log('[Live2D] final scale:', fitScale);

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

  // 4. 眼神跟随：每帧把鼠标位置映射到头部参数
  if (app) {
    app.ticker.add(tickHeadFollow);
  }
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
 *
 * 注意：每次只注册一次 motionFinish 监听（用 once + 闭包检查优先级）
 * 修复 v0.9.5 bug：之前用 on() 每次都加监听器，导致同 priority 的 motion 完成时
 *  currentPriority 被反复重置成 0，下一帧又触发同 priority 的 motion，循环播放同一组动作
 */
let motionFinishBound = false;
function playMotion(group: string, index: number, priority: number): void {
  if (!model) return;

  try {
    (model as any).motion(group, index);

    // 一次性绑定全局 motionFinish（每次都注册 on 会导致监听器堆积）
    if (!motionFinishBound) {
      motionFinishBound = true;
      (model as any).on('motionFinish', () => {
        // 全部动作结束后重置优先级
        currentPriority = 0;
      });
    }
  } catch (e) {
    // 模型没配这个 motion 组，退回 Idle（不重置优先级，避免循环）
    console.warn(`[Live2D] motion "${group}[${index}]" not found:`, e);
  }
}

// ── 鼠标跟随（眼神） ────────────────────────────────────────────

/** 鼠标 x/y 归一化值（-1..1），用于驱动 ParamAngleX/ParamAngleY */
let mouseX = 0;
let mouseY = 0;

/** 头部角度最大幅度（弧度） */
const HEAD_ANGLE_MAX = 0.3;

/** 眼神平滑系数（0=不跟随，1=瞬移） */
const HEAD_SMOOTH = 0.18;

/** 当前头部参数（用于平滑过渡） */
let headX = 0;
let headY = 0;

/**
 * 更新鼠标位置（由外部 mousemove 事件调用）
 */
export function updateMousePosition(domX: number, domY: number, canvasW: number, canvasH: number): void {
  // 中心为 (0, 0)，归一化到 [-1, 1]
  mouseX = ((domX / canvasW) * 2 - 1);
  mouseY = ((domY / canvasH) * 2 - 1);
}

/**
 * 每帧更新头部参数（PIXI ticker 调用）
 *
 * 把鼠标位置映射到 Cubism 头部参数 ParamAngleX / ParamAngleY
 * 注意：模型如果没有头部骨骼，会抛错被 try-catch 吞掉
 */
export function tickHeadFollow(): void {
  if (!model) return;

  // 目标值：限制幅度
  const targetX = mouseX * HEAD_ANGLE_MAX;
  const targetY = mouseY * HEAD_ANGLE_MAX;

  // 平滑过渡（低通滤波）
  headX += (targetX - headX) * HEAD_SMOOTH;
  headY += (targetY - headY) * HEAD_SMOOTH;

  try {
    (model as any).parameter('ParamAngleX', headX);
    (model as any).parameter('ParamAngleY', -headY); // Y 轴反向（屏幕坐标系向下）
  } catch {
    // 模型没配这些参数，静默忽略
  }
}

// ── 窗口 resize ───────────────────────────────────────────────

function handleResize(): void {
  if (!app || !model) return;

  // 重新居中
  model.x = app.screen.width / 2;
  model.y = app.screen.height / 2;
}

export function hitTestModel(domX: number, domY: number): boolean {
  if (!model || !modelReady || !app) return false;

  try {
    // DOM 坐标 → PIXI 内部坐标（适配 devicePixelRatio）
    const canvas = app.view as HTMLCanvasElement;
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const x = domX * scaleX;
    const y = domY * scaleY;

    const hitAreas = (model as any).hitTest(x, y);
    return Array.isArray(hitAreas) && hitAreas.length > 0;
  } catch {
    // hitTest 不可用或坐标异常时，回退到几何区域判断
    try {
      const bounds = model.getLocalBounds();
      const canvas = app.view as HTMLCanvasElement;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      const x = domX * scaleX;
      const y = domY * scaleY;
      return bounds.contains(x, y);
    } catch {
      return false;
    }
  }
}

export async function playAudioForViseme(audioBase64Str: string): Promise<void> {
  if (!model || !modelReady) return;

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const binaryStr = atob(audioBase64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const localDataArray = dataArray;

    source.start(0);

    const animateViseme = () => {
      if (!model || !analyser) return;

      analyser.getByteFrequencyData(localDataArray);

      let sum = 0;
      const len = localDataArray.length;
      for (let i = 0; i < len; i++) {
        sum += localDataArray[i] ?? 0;
      }
      const avg = sum / localDataArray.length;
      const mouthOpen = Math.min(avg / 128, 1);

      try {
        (model as any).parameter('ParamMouthOpenY', mouthOpen);
      } catch {
        // model doesn't support parameter API
      }

      requestAnimationFrame(animateViseme);
    };

    animateViseme();

    source.onended = () => {
      try {
        (model as any).parameter('ParamMouthOpenY', 0);
      } catch {
        // model doesn't support parameter API
      }
    };
  } catch (e) {
    console.warn('[Live2D] viseme sync failed:', e);
  }
}

(window as any).playNahidaAction = (tag: string) => playAction({ tag });
(window as any).playNahidaAudio = (audioBase64: string) => playAudioForViseme(audioBase64);
(window as any).nahidaLive2D = {
  getModel: () => model,
  getApp: () => app,
  isReady: () => modelReady,
  playAudio: (audioBase64: string) => playAudioForViseme(audioBase64),
};
