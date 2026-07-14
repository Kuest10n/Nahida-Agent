/**
 * 向量召回模块 —— v0.9.0
 *
 * 职责：
 *   1. 将 worldbook 条目和分片内容向量化并索引
 *   2. 根据用户消息进行向量相似度召回
 *   3. 与关键词召回混合（关键词优先，向量补充）
 *
 * 设计原则：
 *   - worldbook trigger 命中优先于向量召回（来自 .trae/rules/memory.md）
 *   - 向量召回作为补充，捕获关键词无法覆盖的语义相似场景
 *   - 向量化在首次使用时惰性执行，不阻塞启动
 */

import { generateEmbedding, cosineSimilarity, checkEmbeddingAvailable } from './embedding';
import { listLoadedEntries, type WorldbookEntry } from './worldbook';
import { listLoadedShards, type LoadedShard } from './shards';

// ── 类型定义 ──────────────────────────────────────────────────

/** 向量化的记忆条目 */
interface VectorizedEntry {
  /** 原始条目 */
  source: WorldbookEntry | LoadedShard;
  /** 来源类型 */
  sourceType: 'worldbook' | 'shard';
  /** 文本内容（用于生成向量） */
  text: string;
  /** 向量 */
  vector: number[];
}

/** 向量召回结果 */
export interface VectorRecallResult {
  /** 召回的条目 */
  entry: VectorizedEntry;
  /** 相似度分数 */
  score: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 向量召回数量上限 */
const MAX_VECTOR_RECALL = 3;

/** 最低相似度阈值 */
const MIN_SIMILARITY = 0.75;

// ── 模块状态 ──────────────────────────────────────────────────

/** 已向量化的条目 */
let vectorizedEntries: VectorizedEntry[] = [];

/** 是否已向量化 */
let vectorized = false;

/** embedding 模型是否可用 */
let embeddingAvailable = false;

// ── 核心功能 ──────────────────────────────────────────────────

/**
 * 初始化向量索引（惰性执行）
 *
 * 将所有 worldbook 条目和分片内容向量化。
 * 首次调用时执行，后续调用直接返回。
 */
export async function initVectorIndex(): Promise<void> {
  if (vectorized) return;

  // 检查 embedding 模型是否可用
  embeddingAvailable = await checkEmbeddingAvailable();
  if (!embeddingAvailable) {
    console.warn('[VectorRecall] embedding model not available, falling back to keyword-only');
    vectorized = true;
    return;
  }

  try {
    // 向量化 worldbook 条目
    const worldbookEntries = listLoadedEntries();
    for (const entry of worldbookEntries) {
      const text = `${entry.triggers.join(' ')} ${entry.content}`;
      const result = await generateEmbedding(text);
      vectorizedEntries.push({
        source: entry,
        sourceType: 'worldbook',
        text,
        vector: result.vector,
      });
    }

    // 向量化分片
    const shards = listLoadedShards();
    for (const shard of shards) {
      const result = await generateEmbedding(shard.content);
      vectorizedEntries.push({
        source: shard,
        sourceType: 'shard',
        text: shard.content,
        vector: result.vector,
      });
    }

    vectorized = true;
    console.log(`[VectorRecall] indexed ${vectorizedEntries.length} entries`);
  } catch (err) {
    console.error('[VectorRecall] init failed:', err);
    vectorized = true; // 失败也标记，避免重复尝试
  }
}

/**
 * 向量召回
 *
 * 根据用户消息的向量相似度召回相关记忆。
 * 与关键词召回混合使用：关键词命中优先，向量补充。
 *
 * @param userMessage 用户消息
 * @param maxResults 返回结果上限
 * @returns 召回结果列表（按相似度降序）
 */
export async function recallByVector(
  userMessage: string,
  maxResults: number = MAX_VECTOR_RECALL,
): Promise<VectorRecallResult[]> {
  if (!vectorized) await initVectorIndex();

  if (!embeddingAvailable || vectorizedEntries.length === 0) {
    return [];
  }

  try {
    // 生成用户消息的向量
    const queryResult = await generateEmbedding(userMessage);
    const queryVector = queryResult.vector;

    // 计算相似度
    const results: VectorRecallResult[] = [];
    for (const entry of vectorizedEntries) {
      const score = cosineSimilarity(queryVector, entry.vector);
      if (score >= MIN_SIMILARITY) {
        results.push({ entry, score });
      }
    }

    // 按相似度降序排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  } catch (err) {
    console.error('[VectorRecall] recall failed:', err);
    return [];
  }
}

/**
 * 混合召回（关键词 + 向量）
 *
 * 关键词命中的条目优先，向量召回补充。
 * 去重：同一条目不重复返回。
 *
 * @param userMessage 用户消息
 * @param keywordHits 关键词命中的条目
 * @param maxResults 返回结果上限
 * @returns 混合召回结果
 */
export async function recallHybrid(
  userMessage: string,
  keywordHits: WorldbookEntry[],
  maxResults: number = 5,
): Promise<Array<{ entry: WorldbookEntry | LoadedShard; source: string; score?: number }>> {
  const results: Array<{ entry: WorldbookEntry | LoadedShard; source: string; score?: number }> = [];

  // 1. 关键词命中优先
  const keywordIds = new Set<string>();
  for (const hit of keywordHits) {
    results.push({ entry: hit, source: 'keyword' });
    keywordIds.add(hit.fileName);
  }

  // 2. 向量召回补充
  const vectorResults = await recallByVector(userMessage, maxResults - results.length);
  for (const vr of vectorResults) {
    // 去重：关键词已命中的不再添加
    if (vr.entry.sourceType === 'worldbook') {
      const wb = vr.entry.source as WorldbookEntry;
      if (keywordIds.has(wb.fileName)) continue;
    }
    results.push({ entry: vr.entry.source, source: 'vector', score: vr.score });
  }

  return results.slice(0, maxResults);
}

/**
 * 检查向量召回是否可用
 */
export function isVectorRecallAvailable(): boolean {
  return embeddingAvailable;
}

/**
 * 重置模块状态（测试用）
 */
export function resetVectorRecall(): void {
  vectorizedEntries = [];
  vectorized = false;
  embeddingAvailable = false;
}
