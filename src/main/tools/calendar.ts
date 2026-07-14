/**
 * 日历工具集 —— v0.8.5
 *
 * 职责：
 *   管理用户日程事件，支持创建、查询、列出功能。
 *
 * 存储：
 *   data/calendar/events.json —— JSON 文件持久化
 *
 * 工具清单：
 *   - calendar_create : 创建日历事件
 *   - calendar_query  : 查询指定日期范围内的事件
 *   - calendar_list   : 列出所有事件
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 日历事件 */
interface CalendarEvent {
  id: string;
  title: string;
  startTime: number; // Unix timestamp (ms)
  endTime: number; // Unix timestamp (ms)
  description?: string;
  location?: string;
  createdAt: number;
}

// ── 常量 ──────────────────────────────────────────────────────

const CALENDAR_DIR = path.resolve(process.cwd(), 'data', 'calendar');
const EVENTS_FILE = path.join(CALENDAR_DIR, 'events.json');

// ── 存储层 ────────────────────────────────────────────────────

/** 内存缓存 */
let eventsCache: CalendarEvent[] | undefined;

/** 加载事件列表 */
function loadEvents(): CalendarEvent[] {
  if (eventsCache) return eventsCache;

  if (!fs.existsSync(EVENTS_FILE)) {
    eventsCache = [];
    return eventsCache;
  }

  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf-8');
    eventsCache = JSON.parse(raw) as CalendarEvent[];
    return eventsCache;
  } catch {
    eventsCache = [];
    return eventsCache;
  }
}

/** 保存事件列表 */
function saveEvents(events: CalendarEvent[]): void {
  if (!fs.existsSync(CALENDAR_DIR)) {
    fs.mkdirSync(CALENDAR_DIR, { recursive: true });
  }
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');
  eventsCache = events;
}

// ── 工具 1：calendar_create ───────────────────────────────────

const calendarCreateTool: ToolDefinition = {
  name: 'calendar_create',
  description: '创建日历事件。当用户要求"添加日程""创建会议""安排活动"时调用。',
  parameters: z.object({
    title: z.string().describe('事件标题'),
    startTime: z.number().describe('开始时间（Unix 时间戳，毫秒）'),
    endTime: z.number().describe('结束时间（Unix 时间戳，毫秒）'),
    description: z.string().optional().describe('事件描述'),
    location: z.string().optional().describe('事件地点'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const events = loadEvents();

    const newEvent: CalendarEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: params.title as string,
      startTime: params.startTime as number,
      endTime: params.endTime as number,
      description: params.description as string | undefined,
      location: params.location as string | undefined,
      createdAt: Date.now(),
    };

    events.push(newEvent);
    saveEvents(events);

    return {
      ok: true,
      data: {
        id: newEvent.id,
        title: newEvent.title,
        startTime: newEvent.startTime,
        endTime: newEvent.endTime,
        message: `已创建事件：${newEvent.title}`,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 2：calendar_query ────────────────────────────────────

const calendarQueryTool: ToolDefinition = {
  name: 'calendar_query',
  description: '查询指定日期范围内的日历事件。当用户问"今天有什么安排""这周有什么事"时调用。',
  parameters: z.object({
    from: z.number().describe('查询起始时间（Unix 时间戳，毫秒）'),
    to: z.number().describe('查询结束时间（Unix 时间戳，毫秒）'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const events = loadEvents();
    const from = params.from as number;
    const to = params.to as number;

    const matched = events.filter(evt => {
      // 事件与查询区间有交集
      return evt.startTime < to && evt.endTime > from;
    });

    // 按开始时间排序
    matched.sort((a, b) => a.startTime - b.startTime);

    return {
      ok: true,
      data: {
        count: matched.length,
        events: matched.map(evt => ({
          id: evt.id,
          title: evt.title,
          startTime: evt.startTime,
          endTime: evt.endTime,
          description: evt.description,
          location: evt.location,
        })),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 3：calendar_list ─────────────────────────────────────

const calendarListTool: ToolDefinition = {
  name: 'calendar_list',
  description: '列出所有日历事件（按开始时间排序）。当用户要求"查看所有日程""列出所有事件"时调用。',
  parameters: z.object({}).strict(),
  async execute(): Promise<ToolResult> {
    const startTime = Date.now();
    const events = loadEvents();

    // 按开始时间排序
    const sorted = [...events].sort((a, b) => a.startTime - b.startTime);

    return {
      ok: true,
      data: {
        count: sorted.length,
        events: sorted.map(evt => ({
          id: evt.id,
          title: evt.title,
          startTime: evt.startTime,
          endTime: evt.endTime,
          description: evt.description,
          location: evt.location,
        })),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

/**
 * 注册日历工具
 *
 * 在主进程启动时调用。
 */
export function registerCalendarTools(): void {
  registerTools([calendarCreateTool, calendarQueryTool, calendarListTool]);
  console.log('[Tools] calendar tools registered: calendar_create, calendar_query, calendar_list');
}
