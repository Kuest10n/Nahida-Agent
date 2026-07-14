/**
 * Embedding 向量化模块 —— v0.9.0
 *
 * 职责：
 *   1. 调用 Qwen3-Embed-0.6B 模型生成文本向量
 *   2. 提供 cosine 相似度计算
 *   3. 支持批量向量化
 *
 * 设计原则：
 *   - 使用 ollama 调用本地 embedding 模型
 *   - 向量维度：1024（Qwen3-Embed-0.6B 默认）
 *   - 支持批量处理，减少网络开销
 */

import { getOllamaBaseUrl } from '../config/config';

// ── 类型定义 ──────────────────────────────────────────────────

/** 单个文本的向量结果 */
export interface EmbeddingResult {
  /** 原始文本 */
  text: string;
  /** 向量（1024 维） */
  vector: number[];
  /** 维度数 */
  dimensions: number;
}

/** ollama embedding API 响应 */
interface OllamaEmbedResponse {
  embedding: number[];
}

// ── 常量 ──────────────────────────────────────────────────────

/** embedding 模型名 */
const EMBEDDING_MODEL = 'qwen3-embed-0.6b';

/** 向量维度 */
const VECTOR_DIMENSIONS = 1024;

/** ollama embedding API 路径 */
const EMBEDDING_API_PATH = '/api/embed';

// ── 核心功能 ──────────────────────────────────────────────────

/**
 * 生成单个文本的向量
 *
 * @param text 输入文本
 * @returns 向量结果
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const url = `${getOllamaBaseUrl()}${EMBEDDING_API_PATH}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`ollama embedding failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as OllamaEmbedResponse;

    return {
      text,
      vector: data.embedding,
      dimensions: data.embedding.length,
    };
  } catch (err) {
    console.error('[Embedding] generate failed:', err);
    throw err;
  }
}

/**
 * 批量生成文本向量
 *
 * @param texts 文本数组
 * @returns 向量结果数组
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const url = `${getOllamaBaseUrl()}${EMBEDDING_API_PATH}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`ollama batch embedding failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { embeddings: number[][] };

    return texts.map((text, i) => ({
      text,
      vector: data.embeddings[i] ?? [],
      dimensions: data.embeddings[i]?.length ?? 0,
    }));
  } catch (err) {
    console.error('[Embedding] batch generate failed:', err);
    throw err;
  }
}

/**
 * 计算两个向量的 cosine 相似度
 *
 * @param vec1 向量 1
 * @param vec2 向量 2
 * @returns cosine 相似度（-1 到 1）
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vector dimensions mismatch: ${vec1.length} vs ${vec2.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vec1.length; i++) {
    const a = vec1[i] ?? 0;
    const b = vec2[i] ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * 检查 embedding 模型是否可用
 *
 * @returns 是否可用
 */
export async function checkEmbeddingAvailable(): Promise<boolean> {
  try {
    const url = `${getOllamaBaseUrl()}/api/tags`;
    const response = await fetch(url);
    if (!response.ok) return false;

    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models.some(m => m.name.includes(EMBEDDING_MODEL));
  } catch {
    return false;
  }
}

/** 获取 embedding 模型名 */
export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/** 获取向量维度 */
export function getVectorDimensions(): number {
  return VECTOR_DIMENSIONS;
}
