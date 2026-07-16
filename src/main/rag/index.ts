/**
 * RAG 三阶段检索 —— 统一入口
 *
 * 流程：
 *   1. Query Transform: 查询变换（关键词提取 + 实体识别 + 同义词扩展）
 *   2. Recall: 召回候选（worldbook trigger 匹配）
 *   3. Rerank: 重排序（多维度评分 + 过滤）
 *   4. KG Enhance: 知识图谱增强（预留）
 *
 * 使用方式：
 *   const result = await ragRetrieve(userMessage);
 *   // result.entries 为最终召回的条目
 */

import { transformQuery, toSearchableQuery, type TransformedQuery } from './query-transform';
import { recallWorldbook, listLoadedEntries, type WorldbookEntry } from '../memory/worldbook';
import { rerank, filterLowScore, getTopN, type RerankedResult } from './reranker';
import { initKnowledgeGraph, findNodeByName, getNodeRelations, type KGNode, type KGEdge } from './knowledge-graph';

// ── 类型定义 ──────────────────────────────────────────────────

/** RAG 检索结果 */
export interface RAGResult {
  /** 变换后的查询 */
  transformedQuery: TransformedQuery;
  /** 原始召回条目 */
  rawEntries: WorldbookEntry[];
  /** 重排序后的结果 */
  rerankedEntries: RerankedResult[];
  /** 最终返回的条目（Top N） */
  topEntries: RerankedResult[];
  /** KG 增强信息（预留） */
  kgEnhancement?: KGEnhancementInfo;
  /** 检索耗时（ms） */
  latencyMs: number;
}

/** KG 增强信息 */
export interface KGEnhancementInfo {
  /** 命中的实体节点 */
  hitNodes: KGNode[];
  /** 相关关系 */
  relations: KGEdge[];
}

// ── 配置 ──────────────────────────────────────────────────────

/** RAG 配置 */
export interface RAGConfig {
  /** 是否启用 RAG（默认 true） */
  enabled: boolean;
  /** 是否启用 KG 增强（默认 false，预留） */
  enableKG: boolean;
  /** 重排序分数阈值（默认 30） */
  scoreThreshold: number;
  /** 返回条目数上限（默认 5） */
  topN: number;
}

const DEFAULT_CONFIG: RAGConfig = {
  enabled: true,
  enableKG: false,
  scoreThreshold: 30,
  topN: 5,
};

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * RAG 检索主入口
 *
 * @param userMessage 用户消息
 * @param config 配置
 * @returns 检索结果
 */
export function ragRetrieve(
  userMessage: string,
  config: Partial<RAGConfig> = {},
): RAGResult {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 阶段 1：Query Transform
  const transformedQuery = transformQuery(userMessage);

  if (!cfg.enabled) {
    return {
      transformedQuery,
      rawEntries: [],
      rerankedEntries: [],
      topEntries: [],
      latencyMs: Date.now() - startTime,
    };
  }

  // 阶段 2：Recall（使用变换后的查询召回）
  const searchableQuery = toSearchableQuery(transformedQuery);
  const rawEntries = recallWorldbook(searchableQuery, 10); // 召回更多，交给 rerank 筛选

  // 阶段 3：Rerank
  const rerankedEntries = rerank(rawEntries, transformedQuery);
  const filteredEntries = filterLowScore(rerankedEntries, cfg.scoreThreshold);
  const topEntries = getTopN(filteredEntries, cfg.topN);

  // 阶段 4：KG 增强（预留）
  let kgEnhancement: KGEnhancementInfo | undefined;
  if (cfg.enableKG) {
    kgEnhancement = enhanceWithKG(transformedQuery);
  }

  const latencyMs = Date.now() - startTime;

  if (topEntries.length > 0) {
    console.log(`[RAG] retrieved ${topEntries.length} entries in ${latencyMs}ms (raw=${rawEntries.length}, reranked=${rerankedEntries.length})`);
  }

  return {
    transformedQuery,
    rawEntries,
    rerankedEntries,
    topEntries,
    kgEnhancement,
    latencyMs,
  };
}

/**
 * KG 增强（预留）
 */
function enhanceWithKG(query: TransformedQuery): KGEnhancementInfo {
  const hitNodes: KGNode[] = [];
  const relations: KGEdge[] = [];

  // 从实体中查找 KG 节点
  for (const entity of query.entities) {
    const node = findNodeByName(entity.text);
    if (node) {
      hitNodes.push(node);
      // 获取该节点的关系
      const nodeRelations = getNodeRelations(node.id);
      relations.push(...nodeRelations);
    }
  }

  return { hitNodes, relations };
}

/**
 * 初始化 RAG 系统
 *
 * 在应用启动时调用
 */
export function initRAG(): void {
  // v1.6: 初始化知识图谱（从 worldbook 自动构建）
  const entries = listLoadedEntries();
  if (entries.length > 0) {
    initKnowledgeGraph(entries);
  }
  console.log('[RAG] initialized');
}

// ── 导出子模块 ────────────────────────────────────────────────

export { transformQuery, toSearchableQuery } from './query-transform';
export { rerank, filterLowScore, getTopN } from './reranker';
export { initKnowledgeGraph, findNodeByName, getNodeRelations } from './knowledge-graph';
export type { TransformedQuery } from './query-transform';
export type { RerankedResult, ScoreBreakdown } from './reranker';
export type { KGNode, KGEdge, Triple } from './knowledge-graph';