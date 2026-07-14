/**
 * 向量存储模块 —— v0.9.0
 *
 * 职责：
 *   1. 内存向量索引（轻量级，桌面端优先）
 *   2. 支持向量相似度检索
 *   3. 支持向量持久化（JSON 文件）
 *
 * 设计原则：
 *   - 不依赖外部向量数据库（桌面端轻量优先）
 *   - 内存索引 + JSON 持久化
 *   - 支持增量更新
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cosineSimilarity, type EmbeddingResult } from './embedding';

// ── 类型定义 ──────────────────────────────────────────────────

/** 向量条目 */
export interface VectorEntry {
  /** 唯一标识 */
  id: string;
  /** 原始文本 */
  text: string;
  /** 向量 */
  vector: number[];
  /** 元数据 */
  metadata: Record<string, unknown>;
  /** 创建时间 */
  createdAt: number;
}

/** 检索结果 */
export interface SearchResult {
  /** 条目 */
  entry: VectorEntry;
  /** 相似度分数 */
  score: number;
}

/** 持久化格式 */
interface PersistedStore {
  version: number;
  entries: VectorEntry[];
}

// ── 常量 ──────────────────────────────────────────────────────

/** 向量存储目录 */
const VECTOR_STORE_DIR = path.resolve(process.cwd(), 'data', 'vectors');

/** 持久化文件路径 */
const STORE_FILE = path.join(VECTOR_STORE_DIR, 'memory-vectors.json');

/** 持久化版本号 */
const STORE_VERSION = 1;

// ── 模块状态 ──────────────────────────────────────────────────

/** 内存向量索引 */
const vectorIndex = new Map<string, VectorEntry>();

/** 是否已初始化 */
let initialized = false;

// ── 核心功能 ──────────────────────────────────────────────────

/**
 * 初始化向量存储（从磁盘加载）
 */
export function initVectorStore(): void {
  if (initialized) return;

  try {
    if (!fs.existsSync(VECTOR_STORE_DIR)) {
      fs.mkdirSync(VECTOR_STORE_DIR, { recursive: true });
    }

    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const data = JSON.parse(raw) as PersistedStore;

      if (data.version === STORE_VERSION) {
        for (const entry of data.entries) {
          vectorIndex.set(entry.id, entry);
        }
        console.log(`[VectorStore] loaded ${data.entries.length} vectors`);
      } else {
        console.warn(`[VectorStore] version mismatch, starting fresh`);
      }
    }

    initialized = true;
  } catch (err) {
    console.error('[VectorStore] init failed:', err);
    initialized = true;
  }
}

/**
 * 添加或更新向量条目
 */
export function upsertVector(entry: VectorEntry): void {
  if (!initialized) initVectorStore();
  vectorIndex.set(entry.id, entry);
}

/**
 * 批量添加向量条目
 */
export function upsertVectors(entries: VectorEntry[]): void {
  if (!initialized) initVectorStore();
  for (const entry of entries) {
    vectorIndex.set(entry.id, entry);
  }
}

/**
 * 删除向量条目
 */
export function deleteVector(id: string): boolean {
  if (!initialized) initVectorStore();
  return vectorIndex.delete(id);
}

/**
 * 检索相似向量
 *
 * @param queryVector 查询向量
 * @param topK 返回前 K 个结果
 * @param threshold 相似度阈值（默认 0.7）
 * @returns 相似结果列表（按相似度降序）
 */
export function searchSimilar(
  queryVector: number[],
  topK: number = 5,
  threshold: number = 0.7,
): SearchResult[] {
  if (!initialized) initVectorStore();

  const results: SearchResult[] = [];

  for (const entry of vectorIndex.values()) {
    const score = cosineSimilarity(queryVector, entry.vector);
    if (score >= threshold) {
      results.push({ entry, score });
    }
  }

  // 按相似度降序排序
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
}

/**
 * 从 EmbeddingResult 创建 VectorEntry
 */
export function createVectorEntry(
  result: EmbeddingResult,
  id: string,
  metadata: Record<string, unknown> = {},
): VectorEntry {
  return {
    id,
    text: result.text,
    vector: result.vector,
    metadata,
    createdAt: Date.now(),
  };
}

/**
 * 持久化到磁盘
 */
export function persistVectors(): void {
  if (!initialized) initVectorStore();

  try {
    const data: PersistedStore = {
      version: STORE_VERSION,
      entries: Array.from(vectorIndex.values()),
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[VectorStore] persisted ${data.entries.length} vectors`);
  } catch (err) {
    console.error('[VectorStore] persist failed:', err);
  }
}

/**
 * 获取所有向量（调试用）
 */
export function listAllVectors(): VectorEntry[] {
  if (!initialized) initVectorStore();
  return Array.from(vectorIndex.values());
}

/**
 * 清空所有向量
 */
export function clearAllVectors(): void {
  vectorIndex.clear();
  if (fs.existsSync(STORE_FILE)) {
    try {
      fs.unlinkSync(STORE_FILE);
    } catch {
      // ignore
    }
  }
}

/**
 * 重置模块状态（测试用）
 */
export function resetVectorStore(): void {
  vectorIndex.clear();
  initialized = false;
}
