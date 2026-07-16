/**
 * RAG 三阶段检索 —— Reranker
 *
 * 阶段 2：重排序
 *   - 对召回的候选条目进行精细打分
 *   - 结合查询意图、实体匹配、语义相似度
 *   - 输出按相关性降序排列的结果
 *
 * 设计原则（借鉴 xiaoda-agent）：
 *   - 多维度评分：关键词匹配 + 实体覆盖 + 意图对齐
 *   - 可解释：每个条目附带评分理由
 *   - 轻量：不依赖外部模型，纯规则 + 简单计算
 */

import type { WorldbookEntry } from '../memory/worldbook';
import type { TransformedQuery, EntityExtraction } from './query-transform';

// ── 类型定义 ──────────────────────────────────────────────────

/** 重排序结果 */
export interface RerankedResult {
  /** 原始条目 */
  entry: WorldbookEntry;
  /** 总分 (0-100) */
  score: number;
  /** 各维度得分 */
  breakdown: ScoreBreakdown;
  /** 是否命中实体 */
  hitEntities: string[];
}

/** 评分分解 */
export interface ScoreBreakdown {
  /** 关键词匹配分 (0-40) */
  keywordScore: number;
  /** 实体覆盖分 (0-30) */
  entityScore: number;
  /** 意图对齐分 (0-20) */
  intentScore: number;
  /** 优先级加权分 (0-10) */
  priorityScore: number;
}

/** 评分权重配置 */
export interface RerankerConfig {
  /** 关键词匹配权重 */
  keywordWeight: number;
  /** 实体覆盖权重 */
  entityWeight: number;
  /** 意图对齐权重 */
  intentWeight: number;
  /** 优先级加权 */
  priorityWeight: number;
}

// ── 默认配置 ───────────────────────────────────────────────────

const DEFAULT_CONFIG: RerankerConfig = {
  keywordWeight: 40,
  entityWeight: 30,
  intentWeight: 20,
  priorityWeight: 10,
};

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 重排序主入口
 *
 * @param entries 原始召回条目
 * @param query 变换后的查询
 * @param config 评分权重配置
 * @returns 按相关性降序排列的结果
 */
export function rerank(
  entries: WorldbookEntry[],
  query: TransformedQuery,
  config: RerankerConfig = DEFAULT_CONFIG,
): RerankedResult[] {
  const results: RerankedResult[] = [];

  for (const entry of entries) {
    const result = scoreEntry(entry, query, config);
    results.push(result);
  }

  // 按总分降序排列
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * 对单个条目打分
 */
function scoreEntry(
  entry: WorldbookEntry,
  query: TransformedQuery,
  config: RerankerConfig,
): RerankedResult {
  // 1. 关键词匹配分
  const keywordScore = calcKeywordScore(entry, query.keywords);

  // 2. 实体覆盖分
  const { entityScore, hitEntities } = calcEntityScore(entry, query.entities);

  // 3. 意图对齐分
  const intentScore = calcIntentScore(entry, query.intent);

  // 4. 优先级加权分（entry.priority 0-100 → 映射到 0-10）
  const priorityScore = Math.round(entry.priority / 10);

  // 计算加权总分
  const score = Math.round(
    keywordScore * config.keywordWeight / 40 +
    entityScore * config.entityWeight / 30 +
    intentScore * config.intentWeight / 20 +
    priorityScore * config.priorityWeight / 10,
  );

  return {
    entry,
    score: Math.min(100, Math.max(0, score)),
    breakdown: {
      keywordScore,
      entityScore,
      intentScore,
      priorityScore,
    },
    hitEntities,
  };
}

// ── 评分函数 ──────────────────────────────────────────────────

/**
 * 计算关键词匹配分
 *
 * 逻辑：查询关键词在条目内容中出现比例
 * 分值：0-40 分
 */
function calcKeywordScore(entry: WorldbookEntry, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const content = entry.content.toLowerCase();
  const triggerText = entry.triggers.join(' ').toLowerCase();
  const combinedText = `${content} ${triggerText}`;

  let matchCount = 0;
  for (const keyword of keywords) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchCount++;
    }
  }

  // 匹配率 × 40
  return Math.round((matchCount / keywords.length) * 40);
}

/**
 * 计算实体覆盖分
 *
 * 逻辑：查询实体在条目中出现比例
 * 分值：0-30 分
 */
function calcEntityScore(
  entry: WorldbookEntry,
  entities: EntityExtraction[],
): { entityScore: number; hitEntities: string[] } {
  if (entities.length === 0) {
    return { entityScore: 0, hitEntities: [] };
  }

  const content = `${entry.content} ${entry.triggers.join(' ')}`;
  const hitEntities: string[] = [];

  for (const entity of entities) {
    if (content.includes(entity.text)) {
      hitEntities.push(entity.text);
    }
  }

  // 命中率 × 30
  const entityScore = Math.round((hitEntities.length / entities.length) * 30);

  return { entityScore, hitEntities };
}

/**
 * 计算意图对齐分
 *
 * 逻辑：根据条目内容判断其意图，与查询意图是否匹配
 * 分值：0-20 分
 */
function calcIntentScore(entry: WorldbookEntry, queryIntent: TransformedQuery['intent']): number {
  const content = entry.content.toLowerCase();

  // 从条目内容推断其意图
  let entryIntent: TransformedQuery['intent'] = 'unknown';

  if (/步骤|流程|方法|怎么做/.test(content)) {
    entryIntent = 'procedural';
  } else if (/是谁|是什么|定义|概念/.test(content)) {
    entryIntent = 'factual';
  } else if (/你好|嗨|问候/.test(content)) {
    entryIntent = 'conversational';
  } else if (/可能有多种|指的是|分别是/.test(content)) {
    entryIntent = 'ambiguous';
  }

  // 意图匹配得满分，否则得 0 分
  return entryIntent === queryIntent ? 20 : 0;
}

/**
 * 过滤低分结果
 *
 * @param results 重排序结果
 * @param threshold 分数阈值（默认 30）
 * @returns 过滤后的结果
 */
export function filterLowScore(
  results: RerankedResult[],
  threshold: number = 30,
): RerankedResult[] {
  return results.filter(r => r.score >= threshold);
}

/**
 * 获取 Top N 结果
 *
 * @param results 重排序结果
 * @param n 返回数量（默认 5）
 * @returns Top N 结果
 */
export function getTopN(results: RerankedResult[], n: number = 5): RerankedResult[] {
  return results.slice(0, n);
}