/**
 * 遗忘机制 —— v1.3.0 灵魂三维（核心差异化）
 *
 * 职责：
 *   1. 给每条记忆附加 "strength"（0-100），新记忆=100
 *   2.  strength 随时间自然衰减（每天 -5，最低 0）
 *   3.  strength < 40 的记忆有概率被"记错"（细节模糊化）
 *   4.  被用户纠正后 strength 回升（+20，上限 100）
 *
 * 哲学意义：
 *   瑕疵之美——偶尔记错不重要的细节，被纠正后困惑/羞愧，
 *   让纳西妲更像真实生命，而非全知 AI。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 记忆强度记录 */
export interface MemoryStrength {
  /** 记忆唯一标识（worldbook: 文件名; shard: 分片名; fact: 事实摘要hash） */
  id: string;
  /** 当前强度 0-100 */
  strength: number;
  /** 最后访问时间戳 */
  lastAccessed: number;
  /** 被纠正次数 */
  correctionCount: number;
  /** 被记错次数 */
  mistakeCount: number;
}

/** 遗忘配置 */
interface ForgettingConfig {
  /** 每日自然衰减量 */
  dailyDecay: number;
  /** 记错概率阈值（strength < 此值时可能记错） */
  mistakeThreshold: number;
  /** 基础记错概率（0-1） */
  baseMistakeRate: number;
  /** 纠正后回升量 */
  correctionBoost: number;
}

const DEFAULT_CONFIG: ForgettingConfig = {
  dailyDecay: 5,
  mistakeThreshold: 40,
  baseMistakeRate: 0.3,
  correctionBoost: 20,
};

// ── 持久化 ────────────────────────────────────────────────────

const STRENGTH_FILE = path.resolve(process.cwd(), 'memory', 'strength.json');

/** 内存中的强度表 */
let strengthMap: Map<string, MemoryStrength> = new Map();
let initialized = false;

/** 初始化：从磁盘加载 */
function init(): void {
  if (initialized) return;
  try {
    if (fs.existsSync(STRENGTH_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STRENGTH_FILE, 'utf-8')) as MemoryStrength[];
      for (const item of raw) {
        strengthMap.set(item.id, item);
      }
    }
  } catch {
    // 文件损坏时静默重置
  }
  initialized = true;
}

/** 保存到磁盘（原子写：.tmp → rename，避免崩溃时文件截断损坏） */
function save(): void {
  try {
    const dir = path.dirname(STRENGTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Array.from(strengthMap.values());
    const json = JSON.stringify(data, null, 2);
    // 先写 .tmp 再 rename，保证文件要么是旧内容要么是新内容，不会半截
    const tmpPath = `${STRENGTH_FILE}.tmp`;
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, STRENGTH_FILE);
  } catch (err) {
    console.error('[Forgetting] save failed:', err);
  }
}

// ── 核心 API ──────────────────────────────────────────────────

/**
 * 获取或创建记忆的强度记录
 */
export function getStrength(id: string): MemoryStrength {
  init();
  const existing = strengthMap.get(id);
  if (existing) {
    // 应用自然衰减
    const daysSinceAccess = (Date.now() - existing.lastAccessed) / (1000 * 60 * 60 * 24);
    const decay = Math.floor(daysSinceAccess * DEFAULT_CONFIG.dailyDecay);
    const newStrength = Math.max(0, existing.strength - decay);
    if (newStrength !== existing.strength) {
      existing.strength = newStrength;
      save();
    }
    existing.lastAccessed = Date.now();
    return existing;
  }

  // 新记忆，初始强度 100
  const record: MemoryStrength = {
    id,
    strength: 100,
    lastAccessed: Date.now(),
    correctionCount: 0,
    mistakeCount: 0,
  };
  strengthMap.set(id, record);
  save();
  return record;
}

/**
 * 判断某条记忆是否会被"记错"
 *
 * @param id 记忆标识
 * @returns true=记错, false=正常
 */
export function willMistake(id: string): boolean {
  const record = getStrength(id);
  if (record.strength >= DEFAULT_CONFIG.mistakeThreshold) return false;

  // 强度越低，记错概率越高
  const rate = DEFAULT_CONFIG.baseMistakeRate * (1 - record.strength / DEFAULT_CONFIG.mistakeThreshold);
  const roll = Math.random();
  const result = roll < rate;

  if (result) {
    record.mistakeCount++;
    save();
  }

  return result;
}

// 预编译正则：记忆模糊化
const BLUR_YEAR_RE = /\b(\d{4})\b/g;
const BLUR_TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
const BLUR_DATE_RE = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g;

/**
 * 对记忆内容施加"模糊化"（记错效果）
 *
 * - 数字 → 附近随机数字
 * - 具体时间 → "大概..."
 * - 人名 → 保留首字 + "..."
 */
export function blurContent(content: string): string {
  let blurred = content;

  // 数字模糊化（年份、年龄等）
  blurred = blurred.replace(BLUR_YEAR_RE, (_m, year) => {
    const offset = Math.floor(Math.random() * 5) - 2; // -2 ~ +2
    return String(Number(year) + offset);
  });

  // 具体时间模糊化
  blurred = blurred.replace(BLUR_TIME_RE, () => {
    return '大概那个时间';
  });

  // 日期模糊化
  blurred = blurred.replace(BLUR_DATE_RE, () => {
    return '很久以前';
  });

  return blurred;
}

/**
 * 用户纠正——提升记忆强度
 *
 * @param id 记忆标识
 * @returns 纠正后的 strength
 */
export function correct(id: string): number {
  const record = getStrength(id);
  record.strength = Math.min(100, record.strength + DEFAULT_CONFIG.correctionBoost);
  record.correctionCount++;
  record.lastAccessed = Date.now();
  save();
  return record.strength;
}

/**
 * 获取所有低强度记忆（用于梦境素材）
 */
export function getWeakMemories(threshold = 40): Array<{ id: string; strength: number }> {
  init();
  const weak: Array<{ id: string; strength: number }> = [];
  for (const [id, record] of strengthMap) {
    if (record.strength < threshold) {
      weak.push({ id, strength: record.strength });
    }
  }
  return weak.sort((a, b) => a.strength - b.strength);
}

/**
 * 获取遗忘统计（供 /stats 使用）
 */
export function getForgettingStats(): string {
  init();
  const all = Array.from(strengthMap.values());
  const weak = all.filter(r => r.strength < 40);
  const avg = all.length > 0 ? Math.round(all.reduce((s, r) => s + r.strength, 0) / all.length) : 0;

  return `🧠 记忆强度统计\n\n` +
    `- 记忆总数: ${all.length}\n` +
    `- 平均强度: ${avg}/100\n` +
    `- 模糊记忆: ${weak.length} 条\n` +
    `- 被纠正次数: ${all.reduce((s, r) => s + r.correctionCount, 0)}\n` +
    `- 记错次数: ${all.reduce((s, r) => s + r.mistakeCount, 0)}\n` +
    `\n（花冠微垂）……有些细节确实记不太清了。`;
}
