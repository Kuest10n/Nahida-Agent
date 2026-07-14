/**
 * 闹钟工具集 —— v0.8.5
 *
 * 职责：
 *   管理用户闹钟提醒，支持设置、列出、取消功能。
 *
 * 存储：
 *   data/alarm/alarms.json —— JSON 文件持久化
 *
 * 工具清单：
 *   - alarm_set    : 设置闹钟
 *   - alarm_list   : 列出所有闹钟
 *   - alarm_cancel : 取消闹钟
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 闹钟 */
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

// ── 存储层 ────────────────────────────────────────────────────

/** 内存缓存 */
let alarmsCache: Alarm[] | undefined;

/** 加载闹钟列表 */
function loadAlarms(): Alarm[] {
  if (alarmsCache) return alarmsCache;

  if (!fs.existsSync(ALARMS_FILE)) {
    alarmsCache = [];
    return alarmsCache;
  }

  try {
    const raw = fs.readFileSync(ALARMS_FILE, 'utf-8');
    alarmsCache = JSON.parse(raw) as Alarm[];
    return alarmsCache;
  } catch {
    alarmsCache = [];
    return alarmsCache;
  }
}

/** 保存闹钟列表 */
function saveAlarms(alarms: Alarm[]): void {
  if (!fs.existsSync(ALARM_DIR)) {
    fs.mkdirSync(ALARM_DIR, { recursive: true });
  }
  fs.writeFileSync(ALARMS_FILE, JSON.stringify(alarms, null, 2), 'utf-8');
  alarmsCache = alarms;
}

// ── 工具 1：alarm_set ─────────────────────────────────────────

const alarmSetTool: ToolDefinition = {
  name: 'alarm_set',
  description: '设置闹钟。当用户要求"设个闹钟""提醒我""定时提醒"时调用。',
  parameters: z.object({
    time: z.number().describe('闹钟时间（Unix 时间戳，毫秒）'),
    label: z.string().optional().describe('闹钟标签/备注'),
    repeat: z.enum(['once', 'daily', 'weekdays', 'weekends']).optional()
      .describe('重复模式：once=一次, daily=每天, weekdays=工作日, weekends=周末'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const alarms = loadAlarms();

    const newAlarm: Alarm = {
      id: `alm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      time: params.time as number,
      label: params.label as string | undefined,
      repeat: params.repeat as Alarm['repeat'],
      createdAt: Date.now(),
    };

    alarms.push(newAlarm);
    saveAlarms(alarms);

    const timeStr = new Date(newAlarm.time).toLocaleString('zh-CN');
    return {
      ok: true,
      data: {
        id: newAlarm.id,
        time: newAlarm.time,
        timeStr,
        label: newAlarm.label,
        repeat: newAlarm.repeat,
        message: `已设置闹钟：${timeStr}${newAlarm.label ? ` (${newAlarm.label})` : ''}`,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 2：alarm_list ────────────────────────────────────────

const alarmListTool: ToolDefinition = {
  name: 'alarm_list',
  description: '列出所有闹钟（按时间排序）。当用户要求"查看闹钟""列出所有提醒"时调用。',
  parameters: z.object({}).strict(),
  async execute(): Promise<ToolResult> {
    const startTime = Date.now();
    const alarms = loadAlarms();

    // 按时间排序
    const sorted = [...alarms].sort((a, b) => a.time - b.time);

    return {
      ok: true,
      data: {
        count: sorted.length,
        alarms: sorted.map(alm => ({
          id: alm.id,
          time: alm.time,
          timeStr: new Date(alm.time).toLocaleString('zh-CN'),
          label: alm.label,
          repeat: alm.repeat,
        })),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 3：alarm_cancel ──────────────────────────────────────

const alarmCancelTool: ToolDefinition = {
  name: 'alarm_cancel',
  description: '取消指定闹钟。当用户要求"取消闹钟""删除提醒"时调用。',
  parameters: z.object({
    id: z.string().describe('要取消的闹钟 ID'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const alarms = loadAlarms();
    const id = params.id as string;

    const index = alarms.findIndex(a => a.id === id);
    if (index === -1) {
      return {
        ok: false,
        data: { message: `未找到闹钟：${id}` },
        latencyMs: Date.now() - startTime,
      };
    }

    const [cancelled] = alarms.splice(index, 1);
    if (!cancelled) {
      return {
        ok: false,
        data: { message: `取消闹钟失败：${id}` },
        latencyMs: Date.now() - startTime,
      };
    }
    saveAlarms(alarms);

    return {
      ok: true,
      data: {
        id: cancelled.id,
        message: `已取消闹钟：${new Date(cancelled.time).toLocaleString('zh-CN')}`,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

/**
 * 注册闹钟工具
 *
 * 在主进程启动时调用。
 */
export function registerAlarmTools(): void {
  registerTools([alarmSetTool, alarmListTool, alarmCancelTool]);
  console.log('[Tools] alarm tools registered: alarm_set, alarm_list, alarm_cancel');
}
