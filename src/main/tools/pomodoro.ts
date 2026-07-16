/**
 * 番茄钟工具集 —— v1.9.0
 *
 * 职责：
 *   管理 25min 工作 + 5min 休息的专注周期，帮助用户进入心流。
 *   完整闭环：start → scheduler 计时 → 状态变更 IPC → 渲染层提醒。
 *
 * 工具清单：
 *   - pomodoro_start : 启动一个番茄钟（默认 25min 工作 + 5min 休息）
 *   - pomodoro_stop  : 停止当前番茄钟
 *   - pomodoro_stats : 查看今日番茄钟统计
 *
 * 存储：
 *   data/pomodoro/sessions.json —— 完成的番茄钟记录
 *
 * 与 alarm-scheduler 的差异：
 *   - 番茄钟是状态机（work/break/idle），不是一次性触发
 *   - 自动衔接工作段 → 休息段 → 工作段
 *   - 完成的工作段会累计到统计
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

export type PomodoroPhase = 'work' | 'break' | 'long_break' | 'idle';

export interface PomodoroConfig {
  /** 工作段时长（分钟），默认 25 */
  workMinutes: number;
  /** 短休息时长（分钟），默认 5 */
  breakMinutes: number;
  /** 长休息时长（分钟），默认 15 */
  longBreakMinutes: number;
  /** 每多少个工作段后进入长休息，默认 4 */
  longBreakEvery: number;
  /** 目标番茄钟数（一个番茄钟 = 一个工作段），0 = 不限 */
  targetCount: number;
}

export interface PomodoroState {
  /** 当前阶段 */
  phase: PomodoroPhase;
  /** 当前阶段开始时间（ms 时间戳） */
  phaseStartedAt: number;
  /** 当前阶段预计结束时间（ms 时间戳） */
  phaseEndsAt: number;
  /** 今日已完成的工作段数 */
  completedWorkSessions: number;
  /** 总累计工作段数 */
  totalWorkSessions: number;
  /** 当前周期内连续工作段数（达到 longBreakEvery 重置） */
  streakSinceLongBreak: number;
  /** 当前会话标签（可选，如"写作业""编程"） */
  label?: string;
  /** 是否正在运行 */
  running: boolean;
}

interface PomodoroSessionRecord {
  /** 完成时间戳 */
  completedAt: number;
  /** 工作时长（分钟） */
  durationMinutes: number;
  /** 标签 */
  label?: string;
}

// ── 常量 ──────────────────────────────────────────────────────

const POMODORO_DIR = path.resolve(process.cwd(), 'data', 'pomodoro');
const SESSIONS_FILE = path.join(POMODORO_DIR, 'sessions.json');

const DEFAULT_CONFIG: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  targetCount: 0,
};

// ── 状态机 ────────────────────────────────────────────────────

let currentState: PomodoroState = {
  phase: 'idle',
  phaseStartedAt: 0,
  phaseEndsAt: 0,
  completedWorkSessions: 0,
  totalWorkSessions: 0,
  streakSinceLongBreak: 0,
  running: false,
};

let currentConfig: PomodoroConfig = { ...DEFAULT_CONFIG };

/** 状态变更监听器（供 scheduler 订阅） */
type StateChangeListener = (state: PomodoroState) => void;
const listeners = new Set<StateChangeListener>();

export function onStateChange(listener: StateChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(currentState);
    } catch (err) {
      console.error('[Pomodoro] listener error:', err);
    }
  }
}

// ── 存储层 ────────────────────────────────────────────────────

let sessionsCache: PomodoroSessionRecord[] | undefined;

function loadSessions(): PomodoroSessionRecord[] {
  if (sessionsCache) return sessionsCache;
  if (!fs.existsSync(SESSIONS_FILE)) {
    sessionsCache = [];
    return sessionsCache;
  }
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    sessionsCache = JSON.parse(raw) as PomodoroSessionRecord[];
    return sessionsCache;
  } catch {
    sessionsCache = [];
    return sessionsCache;
  }
}

function saveSessions(sessions: PomodoroSessionRecord[]): void {
  if (!fs.existsSync(POMODORO_DIR)) {
    fs.mkdirSync(POMODORO_DIR, { recursive: true });
  }
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  sessionsCache = sessions;
}

/** 记录一个完成的工作段 */
function recordWorkSession(durationMinutes: number, label?: string): void {
  const sessions = loadSessions();
  sessions.push({
    completedAt: Date.now(),
    durationMinutes,
    label,
  });
  // 保留最近 1000 条，防无限增长
  if (sessions.length > 1000) {
    sessions.splice(0, sessions.length - 1000);
  }
  saveSessions(sessions);
}

// ── 状态控制 ──────────────────────────────────────────────────

/** 启动工作段 */
function startWorkPhase(label?: string): void {
  const now = Date.now();
  const durationMs = currentConfig.workMinutes * 60 * 1000;
  currentState = {
    ...currentState,
    phase: 'work',
    phaseStartedAt: now,
    phaseEndsAt: now + durationMs,
    running: true,
    label,
  };
  notifyListeners();
}

/** 进入短休息 */
function startBreakPhase(): void {
  const now = Date.now();
  const durationMs = currentConfig.breakMinutes * 60 * 1000;
  currentState = {
    ...currentState,
    phase: 'break',
    phaseStartedAt: now,
    phaseEndsAt: now + durationMs,
    running: true,
  };
  notifyListeners();
}

/** 进入长休息 */
function startLongBreakPhase(): void {
  const now = Date.now();
  const durationMs = currentConfig.longBreakMinutes * 60 * 1000;
  currentState = {
    ...currentState,
    phase: 'long_break',
    phaseStartedAt: now,
    phaseEndsAt: now + durationMs,
    running: true,
    streakSinceLongBreak: 0,
  };
  notifyListeners();
}

/** 停止当前番茄钟（不记录未完成的工作段） */
function stopPomodoro(): void {
  currentState = {
    ...currentState,
    phase: 'idle',
    phaseStartedAt: 0,
    phaseEndsAt: 0,
    running: false,
  };
  notifyListeners();
}

/**
 * 内部 API：推进状态机
 *
 * 由 scheduler 每秒调用，检查当前阶段是否到期。
 * 到期则自动衔接下一段：
 *   work → break / long_break → work → ...
 */
export function tickPomodoro(): { transitioned: boolean; fromPhase: PomodoroPhase; toPhase: PomodoroPhase } {
  if (!currentState.running) {
    return { transitioned: false, fromPhase: currentState.phase, toPhase: currentState.phase };
  }

  const now = Date.now();
  if (now < currentState.phaseEndsAt) {
    return { transitioned: false, fromPhase: currentState.phase, toPhase: currentState.phase };
  }

  // 当前阶段到期，切换
  const fromPhase = currentState.phase;

  if (fromPhase === 'work') {
    // 工作段完成：记录 + 累计 + 进入休息
    recordWorkSession(currentConfig.workMinutes, currentState.label);
    currentState.completedWorkSessions += 1;
    currentState.totalWorkSessions += 1;
    currentState.streakSinceLongBreak += 1;

    // 达到目标番茄钟数则停止
    if (currentConfig.targetCount > 0 && currentState.completedWorkSessions >= currentConfig.targetCount) {
      stopPomodoro();
      return { transitioned: true, fromPhase, toPhase: 'idle' };
    }

    // 每 longBreakEvery 个工作段进入长休息
    if (currentState.streakSinceLongBreak >= currentConfig.longBreakEvery) {
      startLongBreakPhase();
      return { transitioned: true, fromPhase, toPhase: 'long_break' };
    }

    startBreakPhase();
    return { transitioned: true, fromPhase, toPhase: 'break' };
  }

  if (fromPhase === 'break' || fromPhase === 'long_break') {
    // 休息完成 → 自动进入下一段工作
    startWorkPhase(currentState.label);
    return { transitioned: true, fromPhase, toPhase: 'work' };
  }

  return { transitioned: false, fromPhase, toPhase: currentState.phase };
}

/** 获取当前状态（外部只读） */
export function getPomodoroState(): Readonly<PomodoroState> {
  return { ...currentState };
}

// ── 工具 1：pomodoro_start ────────────────────────────────────

const pomodoroStartTool: ToolDefinition = {
  name: 'pomodoro_start',
  description: '启动番茄钟（默认 25min 工作 + 5min 休息，每 4 段长休息 15min）。当用户要求"开始番茄钟""专注 25 分钟""开始工作"时调用。',
  parameters: z.object({
    work_minutes: z.number().int().positive().max(120).optional().describe('工作段时长（分钟），默认 25'),
    break_minutes: z.number().int().positive().max(60).optional().describe('短休息时长（分钟），默认 5'),
    long_break_minutes: z.number().int().positive().max(60).optional().describe('长休息时长（分钟），默认 15'),
    long_break_every: z.number().int().positive().max(10).optional().describe('每多少个工作段进入长休息，默认 4'),
    target_count: z.number().int().positive().max(20).optional().describe('目标番茄钟数，达到后自动停止。0 或不填 = 不限'),
    label: z.string().max(50).optional().describe('当前任务标签，如"写作业""编程"'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();

    if (currentState.running) {
      return {
        ok: false,
        data: {
          message: '已有番茄钟在运行，请先停止再启动新番茄钟',
          currentState: getPomodoroState(),
        },
        latencyMs: Date.now() - startTime,
      };
    }

    // 更新配置
    currentConfig = {
      workMinutes: (params.work_minutes as number) ?? DEFAULT_CONFIG.workMinutes,
      breakMinutes: (params.break_minutes as number) ?? DEFAULT_CONFIG.breakMinutes,
      longBreakMinutes: (params.long_break_minutes as number) ?? DEFAULT_CONFIG.longBreakMinutes,
      longBreakEvery: (params.long_break_every as number) ?? DEFAULT_CONFIG.longBreakEvery,
      targetCount: (params.target_count as number) ?? DEFAULT_CONFIG.targetCount,
    };

    // 启动工作段
    startWorkPhase(params.label as string | undefined);

    return {
      ok: true,
      data: {
        message: `番茄钟已启动：工作 ${currentConfig.workMinutes} 分钟，休息 ${currentConfig.breakMinutes} 分钟`,
        config: currentConfig,
        state: getPomodoroState(),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 2：pomodoro_stop ─────────────────────────────────────

const pomodoroStopTool: ToolDefinition = {
  name: 'pomodoro_stop',
  description: '停止当前番茄钟。当用户要求"停止番茄钟""结束专注"时调用。未完成的工作段不记录到统计。',
  parameters: z.object({}).strict(),
  async execute(): Promise<ToolResult> {
    const startTime = Date.now();
    const wasRunning = currentState.running;
    const previousState = { ...currentState };
    stopPomodoro();

    return {
      ok: true,
      data: {
        message: wasRunning ? '番茄钟已停止' : '当前没有运行中的番茄钟',
        previousState,
        completedToday: loadSessions().filter(s => isSameDay(s.completedAt, Date.now())).length,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 3：pomodoro_stats ────────────────────────────────────

const pomodoroStatsTool: ToolDefinition = {
  name: 'pomodoro_stats',
  description: '查看今日番茄钟统计。当用户问"今天专注了多久""番茄钟统计"时调用。',
  parameters: z.object({}).strict(),
  async execute(): Promise<ToolResult> {
    const startTime = Date.now();
    const sessions = loadSessions();
    const now = Date.now();

    const todaySessions = sessions.filter(s => isSameDay(s.completedAt, now));
    const todayMinutes = todaySessions.reduce((s, r) => s + r.durationMinutes, 0);
    const totalMinutes = sessions.reduce((s, r) => s + r.durationMinutes, 0);

    // 按标签聚合今日
    const byLabelToday: Record<string, number> = {};
    for (const s of todaySessions) {
      const label = s.label ?? '未标注';
      byLabelToday[label] = (byLabelToday[label] ?? 0) + 1;
    }

    return {
      ok: true,
      data: {
        today: {
          count: todaySessions.length,
          totalMinutes: todayMinutes,
          totalHours: parseFloat((todayMinutes / 60).toFixed(2)),
          byLabel: byLabelToday,
          lastSessionAt: todaySessions.length > 0 ? todaySessions[todaySessions.length - 1]?.completedAt : null,
        },
        allTime: {
          count: sessions.length,
          totalMinutes,
          totalHours: parseFloat((totalMinutes / 60).toFixed(2)),
          firstSessionAt: sessions.length > 0 ? sessions[0]?.completedAt : null,
        },
        current: getPomodoroState(),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具函数 ──────────────────────────────────────────────────

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate();
}

// ── 注册入口 ──────────────────────────────────────────────────

/**
 * 注册番茄钟工具
 *
 * 在主进程启动时调用。
 */
export function registerPomodoroTools(): void {
  registerTools([pomodoroStartTool, pomodoroStopTool, pomodoroStatsTool]);
  console.log('[Tools] pomodoro tools registered: pomodoro_start, pomodoro_stop, pomodoro_stats');
}
