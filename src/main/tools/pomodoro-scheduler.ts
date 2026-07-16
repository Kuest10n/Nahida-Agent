/**
 * 番茄钟调度器 —— v1.9.0
 *
 * 职责：
 *   每秒轮询番茄钟状态机，到期自动切换工作/休息段，
 *   并通过 IPC 推送状态变更到渲染层。
 *
 * 推送方式：
 *   - agent:state-change（复用现有通道，附 pomodoro 上下文）
 *
 * 与 alarm-scheduler 的差异：
 *   - alarm 是一次性触发；pomodoro 是循环状态机
 *   - pomodoro scheduler 每 1 秒 tick 一次（短计时器）
 *   - 状态切换时推送，非切换时不打扰
 */

import { app, BrowserWindow } from 'electron';
import { IpcChannel } from '../../shared/types/ipc';
import { tickPomodoro, onStateChange, getPomodoroState, type PomodoroState, type PomodoroPhase } from './pomodoro';

// ── 常量 ──────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 1_000; // 每秒检查一次

// ── 状态 ──────────────────────────────────────────────────────

let tickTimer: NodeJS.Timeout | null = null;
let boundWindow: BrowserWindow | null = null;
let lastNotifiedPhase: PomodoroPhase | null = null;

// ── 推送 ──────────────────────────────────────────────────────

function pushStateChange(state: PomodoroState, transitioned: boolean): void {
  if (!boundWindow || boundWindow.isDestroyed()) return;

  // 计算剩余时间
  const remainingMs = Math.max(0, state.phaseEndsAt - Date.now());
  const remainingMin = Math.floor(remainingMs / 60_000);
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000);

  boundWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
    state: state.phase === 'idle' ? 'idle' : 'speaking',
    reason: formatPhaseReason(state, transitioned),
    pomodoro: {
      phase: state.phase,
      running: state.running,
      label: state.label,
      phaseStartedAt: state.phaseStartedAt,
      phaseEndsAt: state.phaseEndsAt,
      remainingMs,
      remainingStr: `${remainingMin}:${remainingSec.toString().padStart(2, '0')}`,
      completedToday: state.completedWorkSessions,
      streakSinceLongBreak: state.streakSinceLongBreak,
      transitioned,
    },
    timestamp: Date.now(),
  });
}

function formatPhaseReason(state: PomodoroState, transitioned: boolean): string {
  if (!state.running) {
    return '番茄钟已停止';
  }

  if (!transitioned) {
    return undefined as unknown as string; // 不打扰
  }

  switch (state.phase) {
    case 'work':
      return state.label
        ? `🍅 工作段开始：${state.label}`
        : '🍅 工作段开始，专注 25 分钟';
    case 'break':
      return '☕ 短休息开始，放松 5 分钟';
    case 'long_break':
      return '🌙 长休息开始，好好放松 15 分钟';
    default:
      return undefined as unknown as string;
  }
}

// ── 调度逻辑 ──────────────────────────────────────────────────

function tick(): void {
  const result = tickPomodoro();

  // 阶段切换时才推送（避免每秒打扰）
  if (result.transitioned) {
    const state = getPomodoroState();
    pushStateChange(state, true);
    lastNotifiedPhase = state.phase;
    console.log(`[PomodoroScheduler] phase transitioned: ${result.fromPhase} → ${result.toPhase}`);
  }
}

// ── 状态变更监听 ──────────────────────────────────────────────

// 工具内部状态变更（start/stop 调用）也推送给渲染层
const unsubscribeStateChange = onStateChange((state) => {
  // 阶段未变但 running 状态变了（如手动 stop）也要推
  if (state.phase !== lastNotifiedPhase || !state.running) {
    pushStateChange(state, false);
    lastNotifiedPhase = state.phase;
  }
});

// ── 导出接口 ──────────────────────────────────────────────────

/**
 * 启动番茄钟调度器
 *
 * @param mainWindow 主窗口引用，用于 IPC 推送
 */
export function startPomodoroScheduler(mainWindow: BrowserWindow | null): void {
  if (tickTimer) {
    console.warn('[PomodoroScheduler] 已在运行，跳过重复启动');
    return;
  }

  boundWindow = mainWindow;
  console.log('[PomodoroScheduler] 启动番茄钟调度器（1 秒轮询）');

  tickTimer = setInterval(tick, TICK_INTERVAL_MS);

  app.on('before-quit', () => {
    stopPomodoroScheduler();
  });
}

/**
 * 停止番茄钟调度器
 */
export function stopPomodoroScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log('[PomodoroScheduler] 已停止');
  }
  unsubscribeStateChange();
}

/**
 * 更新绑定的窗口引用（窗口重建时用）
 */
export function bindPomodoroWindow(mainWindow: BrowserWindow | null): void {
  boundWindow = mainWindow;
}
