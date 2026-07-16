/**
 * 闹钟调度器 —— v1.1.0
 *
 * 职责：
 *   轮询闹钟列表，到时触发提醒推送
 *
 * 推送方式：
 *   - IPC 推送到渲染层（agent:state-change）
 *   - 可选：托盘通知
 *
 * 存储：
 *   data/alarm/alarms.json —— 与 alarm.ts 共享
 */

import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IpcChannel } from '../../shared/types/ipc';

// ── 类型定义 ──────────────────────────────────────────────────

interface Alarm {
  id: string;
  time: number; // Unix timestamp (ms)
  label?: string;
  repeat?: 'once' | 'daily' | 'weekdays' | 'weekends';
  createdAt: number;
}

// ── 常量 ──────────────────────────────────────────────────────

const ALARM_DIR = path.resolve(process.cwd(), 'data', 'alarm');
const ALARMS_FILE = path.join(ALARM_DIR, 'alarms.json');
const POLL_INTERVAL_MS = 10_000; // 10 秒轮询一次

// ── 状态 ──────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;
let triggeredAlarms = new Set<string>(); // 已触发的闹钟 ID（防重复）

// ── 存储层 ────────────────────────────────────────────────────

function loadAlarms(): Alarm[] {
  if (!fs.existsSync(ALARMS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(ALARMS_FILE, 'utf-8');
    return JSON.parse(raw) as Alarm[];
  } catch {
    return [];
  }
}

function saveAlarms(alarms: Alarm[]): void {
  if (!fs.existsSync(ALARM_DIR)) {
    fs.mkdirSync(ALARM_DIR, { recursive: true });
  }
  fs.writeFileSync(ALARMS_FILE, JSON.stringify(alarms, null, 2), 'utf-8');
}

// ── 调度逻辑 ──────────────────────────────────────────────────

/**
 * 检查闹钟是否在工作日
 */
function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5; // 周一到周五
}

/**
 * 检查闹钟是否在周末
 */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // 周日或周六
}

/**
 * 计算下次触发时间（用于重复闹钟）
 */
function calculateNextTrigger(alarm: Alarm, now: number): number {
  if (alarm.repeat === 'once') {
    return alarm.time; // 一次闹钟不重新计算
  }

  const baseDate = new Date(alarm.time);
  const nextDate = new Date(now);

  // 设置为同一天的同一时间
  nextDate.setHours(baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds(), 0);

  // 如果已经过了今天的时间，推到明天
  if (nextDate.getTime() <= now) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  // 根据重复模式调整
  switch (alarm.repeat) {
    case 'daily':
      return nextDate.getTime();

    case 'weekdays':
      // 找下一个工作日
      while (!isWeekday(nextDate)) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      return nextDate.getTime();

    case 'weekends':
      // 找下一个周末
      while (!isWeekend(nextDate)) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      return nextDate.getTime();

    default:
      return alarm.time;
  }
}

/**
 * 轮询检查闹钟
 */
function pollAlarms(mainWindow: BrowserWindow | null): void {
  const now = Date.now();
  const alarms = loadAlarms();

  for (const alarm of alarms) {
    // 跳过已触发的闹钟
    if (triggeredAlarms.has(alarm.id)) {
      continue;
    }

    // 检查是否到时（允许 10 秒误差）
    if (Math.abs(now - alarm.time) < POLL_INTERVAL_MS) {
      // 触发闹钟
      triggerAlarm(alarm, mainWindow);

      // 标记为已触发
      triggeredAlarms.add(alarm.id);

      // 处理重复闹钟
      if (alarm.repeat && alarm.repeat !== 'once') {
        const nextTime = calculateNextTrigger(alarm, now);
        const updatedAlarms = loadAlarms();
        const idx = updatedAlarms.findIndex(a => a.id === alarm.id);
        const targetAlarm = updatedAlarms[idx];
        if (idx !== -1 && targetAlarm) {
          targetAlarm.time = nextTime;
          saveAlarms(updatedAlarms);
        }
        // 移除已触发标记，允许下次再触发
        triggeredAlarms.delete(alarm.id);
      }
    }
  }

  // 清理过期的一次闹钟（超过 1 分钟）
  const expiredIds = new Set<string>();
  for (const alarm of alarms) {
    if (!alarm.repeat || alarm.repeat === 'once') {
      if (now - alarm.time > 60_000) {
        expiredIds.add(alarm.id);
      }
    }
  }

  if (expiredIds.size > 0) {
    const updatedAlarms = alarms.filter(a => !expiredIds.has(a.id));
    saveAlarms(updatedAlarms);
    // 清理触发记录
    for (const id of expiredIds) {
      triggeredAlarms.delete(id);
    }
  }
}

/**
 * 触发闹钟提醒
 */
function triggerAlarm(alarm: Alarm, mainWindow: BrowserWindow | null): void {
  const timeStr = new Date(alarm.time).toLocaleString('zh-CN');
  console.log(`[AlarmScheduler] ⏰ 触发闹钟: ${timeStr}${alarm.label ? ` (${alarm.label})` : ''}`);

  // IPC 推送到渲染层
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
      type: 'alarm',
      reason: alarm.label || '闹钟提醒',
      time: alarm.time,
      timeStr,
      alarmId: alarm.id,
    });
  }

  // 可选：托盘通知（TODO: 需要集成 Notification API）
  // const { Notification } = require('electron');
  // new Notification({
  //   title: '⏰ 闹钟提醒',
  //   body: alarm.label || timeStr,
  // }).show();
}

// ── 导出接口 ──────────────────────────────────────────────────

/**
 * 启动闹钟调度器
 *
 * @param mainWindow 主窗口引用，用于 IPC 推送
 */
export function startAlarmScheduler(mainWindow: BrowserWindow | null): void {
  if (pollTimer) {
    console.warn('[AlarmScheduler] 已在运行，跳过重复启动');
    return;
  }

  console.log('[AlarmScheduler] 启动闹钟调度器（10 秒轮询）');
  pollTimer = setInterval(() => pollAlarms(mainWindow), POLL_INTERVAL_MS);

  // 应用退出时清理
  app.on('before-quit', () => {
    stopAlarmScheduler();
  });
}

/**
 * 停止闹钟调度器
 */
export function stopAlarmScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[AlarmScheduler] 已停止');
  }
}

/**
 * 强制触发测试（仅用于调试）
 */
export function testTriggerAlarm(alarmId: string): void {
  const alarms = loadAlarms();
  const alarm = alarms.find(a => a.id === alarmId);
  if (alarm) {
    triggerAlarm(alarm, null);
  }
}