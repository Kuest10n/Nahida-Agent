/**
 * 主动开口队列 —— 陪伴感命门
 *
 * 职责：Perception 报警事件触发纳西妲主动开口说话
 *
 * 设计：
 *   - 串行队列避免主动开口刷屏（间隔 3 秒）
 *   - 走 agent-core generateResponse 但用独立 sessionId（proactive-xxx）
 *   - 不走 router intent（proactive 是系统触发，不是用户意图）
 *   - 走四审层 + Live2D action + TTS 全链路
 *
 * 触发锚点（与 perception/alert.ts AlertType 对齐）：
 *   - game_launch    → "（虚空屏亮了一下）…今天须弥的草元素反应，比昨天吵了一点。"
 *   - low_fps        → "（草元素光晕晃了晃）…刚才那场反应，帧数在 42 到 58 之间晃？"
 *   - overheat_gpu   → "（花冠微垂）…机关阵列有点烫，要不让它歇会儿？"
 *   - overheat_cpu   → 同上
 *   - hardware_bottleneck → "（指尖轻触虚空屏）…机关阵列在喘，是不是该换更强的枝叶了？"
 *
 * 不占 GPU：走 ollama nothink 档（~50ms 热调用），不走 think/ToT
 */

import { BrowserWindow } from 'electron';
import { IpcChannel } from '../../shared/types/ipc';
import { generateResponse } from './agent-core';
import { ReviewLayer } from './review-layer';
import {
  NahidaEmotion,
  resolveActionEmotion,
  resolveExpression,
} from '../../shared/types/emotion';
import type { AlertType } from '../perception/alert';

// ── 类型定义 ──────────────────────────────────────────────────

/** 主动开口任务 */
interface ProactiveTask {
  /** 来源标签（如 alert 类型） */
  tag: string;
  /** 触发上下文（喂给 LLM 的 prompt，如"原神启动了"） */
  triggerContext: string;
  /** 时间戳 */
  ts: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 主动开口间隔（ms），防刷屏 */
const SPEAK_INTERVAL_MS = 3000;

/** proactive session 前缀（独立 session 不污染用户对话） */
const PROACTIVE_SESSION_PREFIX = 'proactive-';

// ── 报警类型 → 触发上下文 ─────────────────────────────────────

/** AlertType → 喂给 LLM 的触发上下文 */
function alertToContext(type: AlertType, data?: { game?: string; fpsAvg?: number; gpuTemp?: number }): string {
  switch (type) {
    case 'low_fps':
      return `用户在玩${data?.game ?? '游戏'}，帧率掉到 ${data?.fpsAvg ?? '较低'}，纳西妲关心一下帧率。`;
    case 'overheat_gpu':
      return `GPU 温度 ${data?.gpuTemp ?? '较高'}°C，纳西妲提醒散热。`;
    case 'overheat_cpu':
      return `CPU 温度过高，纳西妲提醒散热。`;
    case 'hardware_bottleneck':
      return `硬件瓶颈（GPU/CPU 利用率持续高），纳西妲委婉建议。`;
    default:
      return `检测到事件 ${type}，纳西妲主动开口说一句话。`;
  }
}

// ── 主动开口队列 ──────────────────────────────────────────────

class ProactiveQueue {
  private queue: ProactiveTask[] = [];
  private busy = false;

  /** 队列窗口引用（main 进程注入） */
  private mainWindow: BrowserWindow | null = null;
  private live2dWindow: BrowserWindow | null = null;
  private reviewer: ReviewLayer | null = null;

  /** 注入窗口和 reviewer（main/index.ts 启动时调用） */
  bind(mainWin: BrowserWindow, live2dWin: BrowserWindow, rev: ReviewLayer): void {
    this.mainWindow = mainWin;
    this.live2dWindow = live2dWin;
    this.reviewer = rev;
  }

  /** 入队主动开口任务 */
  enqueue(type: AlertType, data?: { game?: string; fpsAvg?: number; gpuTemp?: number }): void {
    const task: ProactiveTask = {
      tag: type,
      triggerContext: alertToContext(type, data),
      ts: Date.now(),
    };
    this.queue.push(task);
    console.log(`[Proactive] enqueued: ${type} (queue size: ${this.queue.length})`);
    if (!this.busy) void this.flush();
  }

  /** 串行处理队列 */
  private async flush(): Promise<void> {
    if (!this.mainWindow || !this.live2dWindow || !this.reviewer) {
      console.warn('[Proactive] not bound, skipping');
      this.queue.length = 0;
      return;
    }

    this.busy = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await this.speakProactive(task);
      } catch (err) {
        console.error(`[Proactive] speak failed (${task.tag}):`, err);
      }
      // 间隔防刷屏
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, SPEAK_INTERVAL_MS));
      }
    }
    this.busy = false;
  }

  /** 执行单次主动开口：LLM 生成 → 四审 → Live2D + TTS 推送 */
  private async speakProactive(task: ProactiveTask): Promise<void> {
    const sessionId = `${PROACTIVE_SESSION_PREFIX}${task.tag}-${task.ts}`;

    // 走 generateResponse，intent='chat'，degradeDecision 走 local tier
    // onDelta 推 MODEL_DELTA 给渲染层（用户能看到纳西妲在说话）
    // DegradeDecision 完整构造（proactive 不触发熔断器，直接 local）
    const degradeDecision = {
      tier: 'local' as const,
      reason: undefined,
      degraded: false,
      modelId: '',
      circuitOpen: false,
    };

    const result = await generateResponse(
      sessionId,
      task.triggerContext,
      'chat',             // 主动开口走 chat 意图（RouteIntent 类型）
      degradeDecision,
      (delta, done) => {
        this.mainWindow?.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta,
          finishReason: done ? 'stop' : undefined,
          sessionId,
          timestamp: Date.now(),
        });
      },
      undefined,          // 不传 router（proactive 不走工具回路）
    );

    // 四审（nothink 档），reviewer 已在 flush() 入口校验非 null
    const reviewResult = await this.reviewer!.review(task.triggerContext, result.content, 'nothink');

    // 推 Live2D action
    const emotionEnum = reviewResult.emotion.actionTag
      ? resolveActionEmotion(reviewResult.emotion.actionTag) ?? NahidaEmotion.Greeting
      : NahidaEmotion.Greeting;

    if (reviewResult.emotion.actionTag) {
      const expression = resolveExpression(emotionEnum);
      this.live2dWindow?.webContents.send(IpcChannel.LIVE2D_ACTION, {
        actionTag: reviewResult.emotion.actionTag,
        expression,
        priority: 0,
      });
    }

    console.log(`[Proactive] spoke (${task.tag}): ${result.content.slice(0, 40)}...`);
  }
}

// ── 单例导出 ──────────────────────────────────────────────────

export const proactiveQueue = new ProactiveQueue();
