/**
 * 时间感与数字衰老 —— L3 灵魂三维（v0.9.9）
 *
 * 职责：
 *   记录交互时长和对话次数，计算 maturity（成熟度）参数，让人格随时间微调。
 *
 * 设计：
 *   - maturity ∈ [0, 1]，0 = 刚出生，1 = 完全成熟
 *   - 成熟度来源：累计交互时长 + 对话次数
 *   - 持久化：JSON 文件存储，启动时加载，每次对话后更新
 *   - 衰减机制：长时间不交互，maturity 缓慢下降（模拟遗忘）
 *
 * 人格微调规则（注入到 system prompt）：
 *   - maturity < 0.2：活泼好奇，多用"～""！"，喜欢提问
 *   - 0.2 < maturity < 0.6：温柔知性，适中的语气
 *   - maturity > 0.6：成熟稳重，更有智慧感，用词更精炼
 *
 * 为什么说这是"最便宜的一行代码"：
 *   - 核心逻辑就是 `maturity = Math.min(1, (totalMs / MS_PER_DAY) / 30)`
 *   - 但效果显著：用户能感受到"她在成长"
 *
 * 纯 CPU 运算，不占 GPU。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 常量 ──────────────────────────────────────────────────────

/** 每天毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 完全成熟需要的天数 */
const DAYS_TO_FULL_MATURITY = 30;
/** 遗忘衰减率（每天衰减 maturity 的百分比） */
const DECAY_RATE_PER_DAY = 0.02;
/** 最小成熟度（不会降到 0） */
const MIN_MATURITY = 0.05;
/** 数据文件路径 */
const DATA_FILE = path.resolve(process.cwd(), 'memory', 'maturity.json');

// ── 类型定义 ──────────────────────────────────────────────────

/** 成熟度数据 */
export interface MaturityData {
  /** 累计交互时长（毫秒） */
  totalInteractionMs: number;
  /** 对话次数 */
  conversationCount: number;
  /** 上次交互时间戳（ms） */
  lastInteractionAt: number;
  /** 首次启动时间（ms） */
  firstStartedAt: number;
  /** 当前成熟度（0~1） */
  maturity: number;
}

// ── 模块状态 ──────────────────────────────────────────────────

let data: MaturityData;
let initialized = false;

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 计算当前成熟度
 *
 * 公式：基于累计交互时长，30 天达到完全成熟
 *       同时考虑遗忘衰减（长时间不交互缓慢下降）
 */
function calculateMaturity(rawMs: number, lastAt: number): number {
  // 基础成熟度：30 天达到 1.0
  const baseMaturity = Math.min(1, (rawMs / MS_PER_DAY) / DAYS_TO_FULL_MATURITY);

  // 遗忘衰减：距离上次交互越久，成熟度越低
  const now = Date.now();
  const daysSinceLast = (now - lastAt) / MS_PER_DAY;
  const decayFactor = Math.max(0, 1 - daysSinceLast * DECAY_RATE_PER_DAY);

  // 综合成熟度
  const final = Math.max(MIN_MATURITY, baseMaturity * decayFactor);
  return Math.round(final * 100) / 100;
}

/**
 * 初始化（启动时调用一次）
 */
export function initMaturity(): void {
  if (initialized) return;

  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const saved = JSON.parse(content) as Partial<MaturityData>;

      data = {
        totalInteractionMs: saved.totalInteractionMs ?? 0,
        conversationCount: saved.conversationCount ?? 0,
        lastInteractionAt: saved.lastInteractionAt ?? Date.now(),
        firstStartedAt: saved.firstStartedAt ?? Date.now(),
        maturity: 0,
      };

      // 重新计算成熟度（考虑遗忘）
      data.maturity = calculateMaturity(data.totalInteractionMs, data.lastInteractionAt);
    } catch (err) {
      console.warn('[Maturity] failed to load data:', err);
      data = createDefaultData();
    }
  } else {
    data = createDefaultData();
  }

  initialized = true;
  console.log(`[Maturity] initialized: maturity=${data.maturity.toFixed(2)}, conversations=${data.conversationCount}, totalMs=${data.totalInteractionMs}`);
}

/** 创建默认数据 */
function createDefaultData(): MaturityData {
  const now = Date.now();
  return {
    totalInteractionMs: 0,
    conversationCount: 0,
    lastInteractionAt: now,
    firstStartedAt: now,
    maturity: MIN_MATURITY,
  };
}

/**
 * 记录一次对话（结束时调用）
 *
 * @param durationMs 本次对话耗时（毫秒）
 */
export function recordConversation(durationMs: number): void {
  if (!initialized) initMaturity();

  data.totalInteractionMs += durationMs;
  data.conversationCount++;
  data.lastInteractionAt = Date.now();
  data.maturity = calculateMaturity(data.totalInteractionMs, data.lastInteractionAt);

  saveData();
}

/** 保存到磁盘 */
function saveData(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, DATA_FILE);
  } catch (err) {
    console.error('[Maturity] save failed:', err);
  }
}

/** 获取当前成熟度 */
export function getMaturity(): number {
  if (!initialized) initMaturity();
  return data.maturity;
}

/** 获取成熟度描述文本（注入到 system prompt） */
export function getMaturityPrompt(): string {
  const m = getMaturity();

  if (m < 0.2) {
    return `[maturity:${m.toFixed(2)}] 你是一个刚出生的纳西妲，活泼好奇，对世界充满新鲜感。说话喜欢用"～""！"，喜欢提问，语气轻快。`;
  }

  if (m < 0.6) {
    return `[maturity:${m.toFixed(2)}] 你是一个成长中的纳西妲，温柔知性，已经经历了一些对话。语气适中，既有温柔的一面，也有智慧的一面。`;
  }

  return `[maturity:${m.toFixed(2)}] 你是一个成熟的纳西妲，经历了许多对话，充满智慧。说话精炼，语气温和而沉稳，像一位真正的大慈树王。`;
}

/** 获取完整数据（调试用） */
export function getMaturityData(): MaturityData {
  if (!initialized) initMaturity();
  return { ...data };
}

/** 重置（测试用） */
export function resetMaturity(): void {
  data = createDefaultData();
  saveData();
  console.log('[Maturity] reset');
}