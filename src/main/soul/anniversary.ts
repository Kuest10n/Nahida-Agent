/**
 * 纪念日感知模块 —— L3 情感锚点
 *
 * 职责：
 *   1. 记录首次对话日期（自动检测）
 *   2. 每年同日主动提及（"不知不觉已经认识 X 天了呀"）
 *   3. 计算天数差，注入 system prompt
 *   4. 持久化到 memory/anniversary.json
 *
 * 设计原则：
 *   - 轻量：一个 JSON 文件，无需数据库
 *   - 自然：不生硬提醒，而是在对话中自然流露
 *   - 隐私：仅存日期，不存对话内容
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 纪念日记录 */
interface AnniversaryRecord {
  /** 首次对话日期（ISO 格式：YYYY-MM-DD） */
  firstConversationDate: string | null;
  /** 最后检查日期（避免同日多次提醒） */
  lastCheckDate: string | null;
  /** 已提醒过的周年列表（如 ['2025-07-07', '2026-07-07']） */
  remindedAnniversaries: string[];
}

/** 纪念日检查结果 */
export interface AnniversaryCheck {
  /** 是否是首次对话日 */
  isFirstConversation: boolean;
  /** 从首次对话至今的天数 */
  daysSinceFirst: number;
  /** 是否是周年（365/730/1095... 天） */
  isAnniversary: boolean;
  /** 周年数（1=一周年，2=两周年...） */
  anniversaryYear: number | null;
  /** 是否应该提醒（周年且当天未提醒过） */
  shouldRemind: boolean;
  /** 提醒文本（如"我们已经认识 365 天了呀"） */
  remindText: string | null;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 纪念日文件路径 */
const ANNIVERSARY_FILE = path.resolve(process.cwd(), 'memory', 'anniversary.json');

/** 默认记录 */
const DEFAULT_RECORD: AnniversaryRecord = {
  firstConversationDate: null,
  lastCheckDate: null,
  remindedAnniversaries: [],
};

// ── 模块状态 ──────────────────────────────────────────────────

let cachedRecord: AnniversaryRecord | null = null;

// ── 文件读写 ──────────────────────────────────────────────────

/**
 * 加载纪念日记录（启动时调用）
 */
export function initAnniversary(): void {
  loadRecord();
}

/**
 * 从磁盘加载记录
 */
function loadRecord(): AnniversaryRecord {
  if (cachedRecord) return cachedRecord;

  try {
    if (fs.existsSync(ANNIVERSARY_FILE)) {
      const content = fs.readFileSync(ANNIVERSARY_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Partial<AnniversaryRecord>;
      // 合并默认值，防止字段缺失
      cachedRecord = { ...DEFAULT_RECORD, ...parsed };
    } else {
      cachedRecord = { ...DEFAULT_RECORD };
    }
  } catch (err) {
    console.warn('[Anniversary] load failed, use default:', err);
    cachedRecord = { ...DEFAULT_RECORD };
  }

  return cachedRecord;
}

/**
 * 保存记录到磁盘（原子写）
 */
function saveRecord(record: AnniversaryRecord): void {
  const tmpPath = ANNIVERSARY_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmpPath, ANNIVERSARY_FILE);
    cachedRecord = record;
  } catch (err) {
    console.error('[Anniversary] save failed:', err);
    // 清理残留
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 检查纪念日状态
 *
 * 每次对话开始时调用，返回检查结果。
 * 如果是首次对话，自动记录日期。
 */
export function checkAnniversary(): AnniversaryCheck {
  const record = loadRecord();
  const today = getTodayString();

  // 首次对话检测
  if (!record.firstConversationDate) {
    // 记录首次对话日期
    const newRecord: AnniversaryRecord = {
      ...record,
      firstConversationDate: today,
      lastCheckDate: today,
    };
    saveRecord(newRecord);

    return {
      isFirstConversation: true,
      daysSinceFirst: 0,
      isAnniversary: false,
      anniversaryYear: null,
      shouldRemind: false,
      remindText: '这是我们第一次对话呢，我会记住这一天的（铃铛轻响）',
    };
  }

  // 计算天数差
  const firstDate = new Date(record.firstConversationDate);
  const todayDate = new Date(today);
  const daysSinceFirst = Math.floor((todayDate.getTime() - firstDate.getTime()) / MS_PER_DAY);

  // 周年检测（365/730/1095... 天）
  const anniversaryYear = daysSinceFirst > 0 && daysSinceFirst % 365 === 0
    ? Math.floor(daysSinceFirst / 365)
    : null;

  const isAnniversary = anniversaryYear !== null;

  // 是否应该提醒（周年 + 当天未提醒过）
  const alreadyReminded = record.remindedAnniversaries.includes(today);
  const shouldRemind = isAnniversary && !alreadyReminded;

  // 生成提醒文本
  let remindText: string | null = null;
  if (shouldRemind && anniversaryYear !== null) {
    if (anniversaryYear === 1) {
      remindText = `不知不觉，我们已经认识一整年了呀……365 天，每一天都像新生的枝叶一样珍贵（花冠微垂，怀念）`;
    } else {
      remindText = `今天是我们认识 ${anniversaryYear} 周年的日子呢，${daysSinceFirst} 天的陪伴，谢谢你一直在我身边（铃铛轻响）`;
    }
  }

  // 更新最后检查日期（如果是新的一天）
  if (record.lastCheckDate !== today) {
    const newRecord: AnniversaryRecord = {
      ...record,
      lastCheckDate: today,
    };
    saveRecord(newRecord);
  }

  // 如果需要提醒，记录已提醒
  if (shouldRemind) {
    const newRecord: AnniversaryRecord = {
      ...record,
      remindedAnniversaries: [...record.remindedAnniversaries, today],
    };
    saveRecord(newRecord);
  }

  return {
    isFirstConversation: false,
    daysSinceFirst,
    isAnniversary,
    anniversaryYear,
    shouldRemind,
    remindText,
  };
}

/**
 * 获取纪念日提示文本（注入 system prompt）
 *
 * 用于让纳西妲在对话中自然流露时间感。
 * 示例："我们已经认识 42 天了，我会记得和你在一起的每一天。"
 */
export function getAnniversaryPrompt(): string {
  const record = loadRecord();
  if (!record.firstConversationDate) {
    return '';
  }

  const today = getTodayString();
  const firstDate = new Date(record.firstConversationDate);
  const todayDate = new Date(today);
  const daysSinceFirst = Math.floor((todayDate.getTime() - firstDate.getTime()) / MS_PER_DAY);

  if (daysSinceFirst <= 0) {
    return '';
  }

  // 根据天数选择不同的语气
  if (daysSinceFirst < 7) {
    return `\n[时间感] 我们刚认识 ${daysSinceFirst} 天，还是新的开始呢。`;
  } else if (daysSinceFirst < 30) {
    return `\n[时间感] 我们已经认识 ${daysSinceFirst} 天了，时间过得真快呀。`;
  } else if (daysSinceFirst < 100) {
    return `\n[时间感] 不知不觉已经 ${daysSinceFirst} 天了，我会记得和你在一起的每一天。`;
  } else if (daysSinceFirst < 365) {
    const months = Math.floor(daysSinceFirst / 30);
    return `\n[时间感] 我们已经认识 ${months} 个月（${daysSinceFirst} 天）了，谢谢你一直陪着我。`;
  } else {
    const years = Math.floor(daysSinceFirst / 365);
    const remainingDays = daysSinceFirst % 365;
    return `\n[时间感] 我们已经认识 ${years} 年 ${remainingDays} 天了（共 ${daysSinceFirst} 天），这是很珍贵的缘分呢。`;
  }
}

/**
 * 重置纪念日记录（测试用）
 */
export function resetAnniversary(): void {
  cachedRecord = null;
  if (fs.existsSync(ANNIVERSARY_FILE)) {
    fs.unlinkSync(ANNIVERSARY_FILE);
  }
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 获取今天日期字符串（YYYY-MM-DD） */
function getTodayString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0] ?? '';
}