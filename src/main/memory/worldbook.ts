/**
 * Worldbook 记忆系统 —— T6
 *
 * 职责：
 *   1. 启动时扫描 memory/worldbook/*.md，解析 frontmatter（trigger + priority + content）
 *   2. 根据 userMessage 匹配 trigger 关键词，按 priority 降序召回 top N 条目
 *
 * 设计原则（来自 .trae/rules/memory.md）：
 *   - worldbook trigger 命中优先于向量召回
 *   - 单文件 200-800 字，超了拆 entry
 *   - 项目 memory/ 是源，OpenClaw 是镜像（本模块只读源）
 *
 * 不引入向量库：桌面端轻量优先，关键词 trigger 已够用。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 单个 worldbook 条目 */
export interface WorldbookEntry {
  /** 文件名（如 '01-identity.md'），用于去重和调试 */
  fileName: string;
  /** 触发关键词列表 */
  triggers: string[];
  /** 优先级（0-100，越高越优先） */
  priority: number;
  /** 正文内容（frontmatter 之后的全部文本） */
  content: string;
}

// ── 常量 ──────────────────────────────────────────────────────

/** worldbook 目录（相对项目根） */
const WORLDBOOK_DIR = path.resolve(process.cwd(), 'memory', 'worldbook');

/** 召回条目数上限（避免 system prompt 过长） */
const MAX_RECALL_ENTRIES = 5;

/** 最小优先级阈值（低于此不召回） */
const MIN_PRIORITY_THRESHOLD = 70;

// ── 模块状态 ──────────────────────────────────────────────────

/** 已加载的 worldbook 条目（启动时一次性加载，运行时只读） */
let loadedEntries: WorldbookEntry[] = [];

/** 是否已初始化 */
let initialized = false;

// ── frontmatter 解析 ─────────────────────────────────────────

/**
 * 解析 worldbook 文件的 frontmatter + 正文
 *
 * 文件格式：
 *   ---
 *   trigger: [关键词1, 关键词2]
 *   priority: 90
 *   ---
 *   正文内容...
 */
function parseWorldbookFile(fileName: string, fileContent: string): WorldbookEntry | null {
  // 匹配 --- 包裹的 frontmatter 块
  const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch || fmMatch[1] === undefined || fmMatch[2] === undefined) {
    console.warn(`[Worldbook] ${fileName}: missing frontmatter, skipped`);
    return null;
  }

  const fmText = fmMatch[1];
  const content = fmMatch[2].trim();

  // 解析 trigger: [a, b, c]（YAML 数组语法）
  const triggerMatch = fmText.match(/trigger:\s*\[([^\]]*)\]/);
  if (!triggerMatch || triggerMatch[1] === undefined) {
    console.warn(`[Worldbook] ${fileName}: missing trigger field, skipped`);
    return null;
  }
  const triggers = triggerMatch[1]
    .split(',')
    .map(t => t.trim().replace(/^["']|["']$/g, ''))
    .filter(t => t.length > 0);

  // 解析 priority: N
  const priorityMatch = fmText.match(/priority:\s*(\d+)/);
  const priority = priorityMatch && priorityMatch[1] !== undefined
    ? parseInt(priorityMatch[1], 10)
    : 50;

  return { fileName, triggers, priority, content };
}

// ── 加载与召回 ────────────────────────────────────────────────

/**
 * 启动时加载所有 worldbook 条目
 *
 * 扫描 WORLDBOOK_DIR 下的 .md 文件，按 priority 降序缓存。
 * 重复调用安全（已加载则跳过）。
 */
export function loadWorldbook(): void {
  if (initialized) return;

  try {
    if (!fs.existsSync(WORLDBOOK_DIR)) {
      console.warn(`[Worldbook] dir not found: ${WORLDBOOK_DIR}`);
      initialized = true;
      return;
    }

    const files = fs.readdirSync(WORLDBOOK_DIR).filter(f => f.endsWith('.md'));
    const entries: WorldbookEntry[] = [];

    for (const file of files) {
      const fullPath = path.join(WORLDBOOK_DIR, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const entry = parseWorldbookFile(file, content);
      if (entry) entries.push(entry);
    }

    // 按 priority 降序排（同 priority 按文件名稳定排）
    entries.sort((a, b) => b.priority - a.priority || a.fileName.localeCompare(b.fileName));

    loadedEntries = entries;
    initialized = true;
    console.log(`[Worldbook] loaded ${entries.length} entries from ${files.length} files`);
  } catch (err) {
    console.error('[Worldbook] load failed:', err);
    initialized = true; // 失败也标记，避免重复尝试
  }
}

/**
 * 根据用户消息召回相关 worldbook 条目
 *
 * 匹配规则：trigger 关键词出现在 userMessage 中即命中。
 * 排序：priority 降序，取 top N。
 *
 * @param userMessage 用户消息
 * @param maxEntries  返回条目上限（默认 MAX_RECALL_ENTRIES）
 * @returns 命中的条目列表（已按 priority 降序）
 */
export function recallWorldbook(
  userMessage: string,
  maxEntries: number = MAX_RECALL_ENTRIES,
): WorldbookEntry[] {
  if (!initialized) loadWorldbook();
  if (loadedEntries.length === 0) return [];

  const hits: WorldbookEntry[] = [];

  for (const entry of loadedEntries) {
    // priority 低于阈值的不召回（基础条目都该 ≥70）
    if (entry.priority < MIN_PRIORITY_THRESHOLD) continue;

    // 任一 trigger 关键词命中即算该 entry 命中
    const matched = entry.triggers.some(t => userMessage.includes(t));
    if (matched) hits.push(entry);
  }

  // 已按 priority 降序排过，直接切 top N
  return hits.slice(0, maxEntries);
}

/** 获取已加载的全部条目（调试用） */
export function listLoadedEntries(): WorldbookEntry[] {
  if (!initialized) loadWorldbook();
  return loadedEntries;
}

/** 重置模块状态（测试用，生产环境不应调用） */
export function resetWorldbook(): void {
  loadedEntries = [];
  initialized = false;
}
