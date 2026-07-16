/**
 * RAG 三阶段检索 —— KG 增强（知识图谱落地版 v1.6）
 *
 * 阶段 3：知识图谱增强
 *   - 从 worldbook 条目自动提取实体和关系
 *   - 持久化到 memory/kg.json
 *   - 支持多跳推理（"纳西妲的朋友的朋友"）
 *   - 与 worldbook 条目关联
 *
 * 设计原则：
 *   - 自动构建：从 worldbook 内容提取，无需手动维护
 *   - 轻量持久化：JSON 文件，无需数据库
 *   - 可扩展：后续可接入 Neo4j / SQLite+vec
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorldbookEntry } from '../memory/worldbook';

// ── 类型定义 ──────────────────────────────────────────────────

/** 实体节点 */
export interface KGNode {
  id: string;
  name: string;
  type: 'person' | 'place' | 'term' | 'event' | 'other';
  worldbookRef?: string;
  attributes: Record<string, string | number | boolean>;
}

/** 关系边 */
export interface KGEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  sourceRef?: string;
}

/** 三元组（简化表示） */
export interface Triple {
  subject: string;
  relation: string;
  object: string;
}

/** 图谱统计 */
export interface KGStats {
  nodeCount: number;
  edgeCount: number;
  personCount: number;
  placeCount: number;
  termCount: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** KG 持久化文件路径 */
const KG_FILE = path.resolve(process.cwd(), 'memory', 'kg.json');

/** 实体识别规则 */
const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: KGNode['type']; attr?: Record<string, string> }> = [
  // 人名
  { pattern: /纳西妲|小草神|布耶尔/g, type: 'person', attr: { title: '草神', element: '草' } },
  { pattern: /旅行者|空|荧/g, type: 'person', attr: { title: '深渊旅行者' } },
  { pattern: /派蒙/g, type: 'person', attr: { title: '应急食品' } },
  { pattern: /温迪|巴巴托斯/g, type: 'person', attr: { title: '风神', element: '风' } },
  { pattern: /钟离|摩拉克斯/g, type: 'person', attr: { title: '岩神', element: '岩' } },
  { pattern: /雷电将军|雷电影|巴尔泽布/g, type: 'person', attr: { title: '雷神', element: '雷' } },
  { pattern: /八重神子/g, type: 'person', attr: { title: '宫司', element: '雷' } },
  { pattern: /芙宁娜|芙卡洛斯/g, type: 'person', attr: { title: '水神', element: '水' } },
  { pattern: /那维莱特/g, type: 'person', attr: { title: '龙', element: '水' } },
  { pattern: /玛薇卡/g, type: 'person', attr: { title: '火神', element: '火' } },
  { pattern: /阿蕾奇诺|仆人/g, type: 'person', attr: { title: '执行官', element: '火' } },
  // 地名
  { pattern: /提瓦特/g, type: 'place', attr: { region: '大陆' } },
  { pattern: /蒙德/g, type: 'place', attr: { region: '风之国' } },
  { pattern: /璃月/g, type: 'place', attr: { region: '岩之国' } },
  { pattern: /稻妻/g, type: 'place', attr: { region: '雷之国' } },
  { pattern: /须弥/g, type: 'place', attr: { region: '草之国' } },
  { pattern: /枫丹/g, type: 'place', attr: { region: '水之国' } },
  { pattern: /纳塔/g, type: 'place', attr: { region: '火之国' } },
  { pattern: /至冬/g, type: 'place', attr: { region: '冰之国' } },
  { pattern: /天空岛/g, type: 'place', attr: { region: '神域' } },
  { pattern: /深渊/g, type: 'place', attr: { region: '异界' } },
  { pattern: /教令院/g, type: 'place', attr: { region: '须弥' } },
  { pattern: /净善宫/g, type: 'place', attr: { region: '须弥' } },
  // 术语
  { pattern: /神之眼/g, type: 'term', attr: { category: '道具' } },
  { pattern: /神之心/g, type: 'term', attr: { category: '道具' } },
  { pattern: /元素力|元素/g, type: 'term', attr: { category: '力量' } },
  { pattern: /坎瑞亚/g, type: 'term', attr: { category: '古国' } },
  { pattern: /天理/g, type: 'term', attr: { category: '存在' } },
  { pattern: /魔神|尘世七执政|七神/g, type: 'term', attr: { category: '神位' } },
  { pattern: /虚空|Akasha/g, type: 'term', attr: { category: '系统' } },
];

/** 关系提取规则 */
const RELATION_PATTERNS: Array<{ pattern: RegExp; relation: string; direction: 'forward' | 'reverse' }> = [
  // X 是 Y 的 Z → (X, Z, Y)
  { pattern: /(\S+)(?:是|为)(\S+)的(?:朋友|同伴|伙伴)/, relation: '朋友', direction: 'forward' },
  { pattern: /(\S+)(?:是|为)(\S+)的(?:敌人|对手)/, relation: '敌人', direction: 'forward' },
  { pattern: /(\S+)(?:是|为)(\S+)的(?:主人|上司)/, relation: '从属', direction: 'reverse' },
  // X 居住在 Y → (X, 居住于, Y)
  { pattern: /(\S+)(?:居住|生活|定居)(?:在|于)(\S+)/, relation: '居住于', direction: 'forward' },
  // X 管理 Y → (X, 管理, Y)
  { pattern: /(\S+)(?:管理|统治|治理)(?:着|了)?(\S+)/, relation: '管理', direction: 'forward' },
  // X 属于 Y → (X, 属于, Y)
  { pattern: /(\S+)(?:属于|归于|隶属于)(\S+)/, relation: '属于', direction: 'forward' },
  // X 来自 Y → (X, 来自, Y)
  { pattern: /(\S+)(?:来自|出身于)(\S+)/, relation: '来自', direction: 'forward' },
  // X 和 Y 一起
  { pattern: /(\S+)(?:和|与)(\S+)(?:一起|同行|结伴)/, relation: '同伴', direction: 'forward' },
];

// ── 模块状态 ──────────────────────────────────────────────────

const nodes = new Map<string, KGNode>();
const edges = new Map<string, KGEdge>();
let initialized = false;

// ── 初始化 ────────────────────────────────────────────────────

/**
 * 初始化知识图谱
 *
 * 优先从持久化文件加载，如果不存在则从 worldbook 自动构建。
 */
export function initKnowledgeGraph(entries: WorldbookEntry[]): void {
  if (initialized) return;

  // 尝试从文件加载
  if (loadFromDisk()) {
    console.log(`[KG] loaded from disk: ${nodes.size} nodes, ${edges.size} edges`);
  } else {
    // 从 worldbook 自动构建
    buildFromWorldbook(entries);
    console.log(`[KG] built from worldbook: ${nodes.size} nodes, ${edges.size} edges`);
    saveToDisk();
  }

  initialized = true;
}

// ── 自动构建 ──────────────────────────────────────────────────

/**
 * 从 worldbook 条目自动构建知识图谱
 */
function buildFromWorldbook(entries: WorldbookEntry[]): void {
  nodes.clear();
  edges.clear();

  for (const entry of entries) {
    // 提取实体
    const extractedNodes = extractEntitiesFromText(entry.content, entry.fileName);
    for (const node of extractedNodes) {
      if (!nodes.has(node.id)) {
        nodes.set(node.id, node);
      }
    }

    // 提取关系
    const extractedEdges = extractRelationsFromText(entry.content, entry.fileName, nodes);
    for (const edge of extractedEdges) {
      if (!edges.has(edge.id)) {
        edges.set(edge.id, edge);
      }
    }
  }

  // 如果没有提取到任何实体，添加示例节点（首次运行保底）
  if (nodes.size === 0) {
    addSampleNodes();
  }
}

/**
 * 从文本中提取实体
 */
function extractEntitiesFromText(text: string, worldbookRef: string): KGNode[] {
  const extracted: KGNode[] = [];
  const seen = new Set<string>();

  for (const { pattern, type, attr } of ENTITY_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const name = match[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const id = nameToId(name);
      extracted.push({
        id,
        name,
        type,
        worldbookRef,
        attributes: { ...(attr ?? {}) },
      });
    }
  }

  return extracted;
}

/**
 * 从文本中提取关系
 */
function extractRelationsFromText(
  text: string,
  worldbookRef: string,
  knownNodes: Map<string, KGNode>,
): KGEdge[] {
  const extracted: KGEdge[] = [];
  const seen = new Set<string>();

  for (const { pattern, relation, direction } of RELATION_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const group1 = match[1];
      const group2 = match[2];
      if (!group1 || !group2) continue;

      const subjectName = direction === 'forward' ? group1 : group2;
      const objectName = direction === 'forward' ? group2 : group1;

      const subjectId = nameToId(subjectName);
      const objectId = nameToId(objectName);

      // 只添加已知节点之间的关系
      if (!knownNodes.has(subjectId) || !knownNodes.has(objectId)) continue;

      const edgeId = `${subjectId}-${relation}-${objectId}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      extracted.push({
        id: edgeId,
        source: subjectId,
        target: objectId,
        relation,
        weight: 0.8,
        sourceRef: worldbookRef,
      });
    }
  }

  return extracted;
}

/**
 * 将名称转换为 ID（去重 + 标准化）
 */
function nameToId(name: string): string {
  return name
    .replace(/[|\\/]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

// ── 持久化 ────────────────────────────────────────────────────

/**
 * 从磁盘加载图谱
 */
function loadFromDisk(): boolean {
  try {
    if (!fs.existsSync(KG_FILE)) return false;

    const content = fs.readFileSync(KG_FILE, 'utf-8');
    const data = JSON.parse(content) as { nodes: KGNode[]; edges: KGEdge[] };

    nodes.clear();
    edges.clear();

    for (const node of data.nodes) {
      nodes.set(node.id, node);
    }
    for (const edge of data.edges) {
      edges.set(edge.id, edge);
    }

    return true;
  } catch (err) {
    console.warn('[KG] load from disk failed:', err);
    return false;
  }
}

/**
 * 保存图谱到磁盘
 */
export function saveToDisk(): void {
  try {
    const data = {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      savedAt: new Date().toISOString(),
    };

    const tmpPath = KG_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, KG_FILE);

    console.log(`[KG] saved to disk: ${nodes.size} nodes, ${edges.size} edges`);
  } catch (err) {
    console.error('[KG] save to disk failed:', err);
  }
}

// ── 示例节点（保底） ──────────────────────────────────────────

function addSampleNodes(): void {
  addNode({ id: 'nahida', name: '纳西妲', type: 'person', attributes: { title: '草神', element: '草' } });
  addNode({ id: 'traveler', name: '旅行者', type: 'person', attributes: { title: '深渊旅行者' } });
  addNode({ id: 'paimon', name: '派蒙', type: 'person', attributes: { title: '应急食品' } });
  addNode({ id: 'sumeru', name: '须弥', type: 'place', attributes: { region: '草之国' } });

  addEdge({ id: 'nahida-friend-traveler', source: 'nahida', target: 'traveler', relation: '朋友', weight: 0.95 });
  addEdge({ id: 'nahida-location-sumeru', source: 'nahida', target: 'sumeru', relation: '居住于', weight: 1.0 });
}

// ── 节点操作 ──────────────────────────────────────────────────

export function addNode(node: KGNode): void {
  nodes.set(node.id, node);
}

export function getNode(id: string): KGNode | undefined {
  return nodes.get(id);
}

export function findNodeByName(name: string): KGNode | undefined {
  const id = nameToId(name);
  return nodes.get(id);
}

export function getAllNodes(): KGNode[] {
  return Array.from(nodes.values());
}

// ── 边操作 ────────────────────────────────────────────────────

export function addEdge(edge: KGEdge): void {
  edges.set(edge.id, edge);
}

export function getEdge(id: string): KGEdge | undefined {
  return edges.get(id);
}

export function getNodeRelations(nodeId: string): KGEdge[] {
  const result: KGEdge[] = [];
  for (const edge of edges.values()) {
    if (edge.source === nodeId || edge.target === nodeId) {
      result.push(edge);
    }
  }
  return result;
}

export function getRelationBetween(sourceId: string, targetId: string): KGEdge[] {
  const result: KGEdge[] = [];
  for (const edge of edges.values()) {
    if (
      (edge.source === sourceId && edge.target === targetId) ||
      (edge.source === targetId && edge.target === sourceId)
    ) {
      result.push(edge);
    }
  }
  return result;
}

// ── 推理接口 ──────────────────────────────────────────────────

export function multiHopInference(
  startNodeId: string,
  relationPath: string[],
  maxDepth: number = 3,
): KGNode[] {
  if (relationPath.length === 0 || relationPath.length > maxDepth) {
    return [];
  }

  if (relationPath.length === 1) {
    const targetRelation = relationPath[0];
    const result: KGNode[] = [];

    for (const edge of edges.values()) {
      if (edge.source === startNodeId && edge.relation === targetRelation) {
        const targetNode = nodes.get(edge.target);
        if (targetNode) result.push(targetNode);
      }
    }

    return result;
  }

  const firstHop = multiHopInference(startNodeId, [relationPath[0] ?? ''], maxDepth);
  if (firstHop.length === 0) return [];

  const remainingPath = relationPath.slice(1);
  const result: KGNode[] = [];

  for (const node of firstHop) {
    const nextHop = multiHopInference(node.id, remainingPath, maxDepth - 1);
    result.push(...nextHop);
  }

  return result;
}

// ── 统计与工具 ────────────────────────────────────────────────

/**
 * 获取图谱统计信息
 */
export function getKGStats(): KGStats {
  let personCount = 0;
  let placeCount = 0;
  let termCount = 0;

  for (const node of nodes.values()) {
    switch (node.type) {
      case 'person': personCount++; break;
      case 'place': placeCount++; break;
      case 'term': termCount++; break;
    }
  }

  return {
    nodeCount: nodes.size,
    edgeCount: edges.size,
    personCount,
    placeCount,
    termCount,
  };
}

/**
 * 导出为三元组列表
 */
export function exportTriples(): Triple[] {
  const triples: Triple[] = [];

  for (const edge of edges.values()) {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);

    if (sourceNode && targetNode) {
      triples.push({
        subject: sourceNode.name,
        relation: edge.relation,
        object: targetNode.name,
      });
    }
  }

  return triples;
}

/**
 * 重置图谱
 */
export function resetKnowledgeGraph(): void {
  nodes.clear();
  edges.clear();
  initialized = false;

  if (fs.existsSync(KG_FILE)) {
    fs.unlinkSync(KG_FILE);
  }
}