/**
 * RAG 三阶段检索 —— Query Transform
 *
 * 阶段 1：查询变换
 *   - 将用户查询转换为更易检索的形式
 *   - 提取关键词、扩展同义词、消除歧义
 *   - 生成多个检索变体，提高召回率
 *
 * 设计原则（借鉴 xiaoda-agent）：
 *   - 轻量：本地规则 + 简单模型，不依赖云端 API
 *   - 中文友好：针对中文用户查询优化
 *   - 可扩展：预留 LLM 增强接口
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 查询变换结果 */
export interface TransformedQuery {
  /** 原始查询 */
  original: string;
  /** 提取的关键词列表 */
  keywords: string[];
  /** 扩展的查询变体 */
  variations: string[];
  /** 实体识别结果（人名/地名/术语） */
  entities: EntityExtraction[];
  /** 查询意图分类 */
  intent: QueryIntent;
}

/** 实体识别结果 */
export interface EntityExtraction {
  /** 实体文本 */
  text: string;
  /** 实体类型 */
  type: 'person' | 'place' | 'term' | 'time' | 'other';
  /** 置信度 (0-1) */
  confidence: number;
}

/** 查询意图分类 */
export type QueryIntent =
  | 'factual'     // 事实查询（"纳西妲是谁"）
  | 'procedural'  // 过程查询（"怎么做X"）
  | 'conversational' // 对话型（"你好"）
  | 'ambiguous'   // 歧义查询（需要澄清）
  | 'unknown';    // 未知类型

// ── 常量 ──────────────────────────────────────────────────────

/** 停用词（中文常见无意义词） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '什么', '怎么', '这个', '那个', '可以', '吗', '呢', '呀',
  '吧', '啊', '哦', '嗯', '哈', '嘿', '喂', '诶', '唉', '哎',
]);

/** 实体识别规则（简单模式匹配） */
const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: EntityExtraction['type'] }> = [
  // 人名（纳西妲/旅行者/空/荧/派蒙等）
  { pattern: /纳西妲|旅行者|空|荧|派蒙|温迪|钟离|雷电将军|八重神子|阿贝多|可莉|宵宫|胡桃|甘雨|神里绫华|神里绫人|夜兰|艾尔海森|卡维|妮露|赛诺/g, type: 'person' },
  // 地名（提瓦特/蒙德/璃月/稻妻/须弥/枫丹/纳塔/至冬）
  { pattern: /提瓦特|蒙德|璃月|稻妻|须弥|枫丹|纳塔|至冬|天空岛|深渊|教令院|净善宫|虚空/g, type: 'place' },
  // 术语（神之眼/神之心/元素/深渊/坎瑞亚）
  { pattern: /神之眼|神之心|元素|深渊|坎瑞亚|天理|魔神|尘世七执政|七神|执政官/g, type: 'term' },
  // 时间
  { pattern: /\d+年|\d+月|\d+日|\d+天|\d+小时|\d+分钟|今天|明天|昨天|下周|上周/g, type: 'time' },
];

/** 同义词扩展表 */
const SYNONYMS: Record<string, string[]> = {
  '纳西妲': ['小草神', '布耶尔', '草神', '布耶尔大人'],
  '旅行者': ['空', '荧', '深渊旅行者'],
  '派蒙': ['应急食品', '小派蒙'],
  '教令院': ['学院', '阿扎尔'],
  '虚空': ['虚空终端', 'Akasha'],
  '元素': ['元素力', '元素能量'],
};

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 查询变换主入口
 *
 * @param query 用户原始查询
 * @returns 变换后的查询对象
 */
export function transformQuery(query: string): TransformedQuery {
  // 1. 清洗查询（去除多余空格、标点）
  const cleaned = cleanQuery(query);

  // 2. 提取关键词（去除停用词）
  const keywords = extractKeywords(cleaned);

  // 3. 实体识别
  const entities = extractEntities(cleaned);

  // 4. 同义词扩展
  const expandedKeywords = expandSynonyms(keywords);

  // 5. 生成查询变体
  const variations = generateVariations(cleaned, keywords, expandedKeywords);

  // 6. 意图分类
  const intent = classifyIntent(cleaned);

  return {
    original: query,
    keywords,
    variations,
    entities,
    intent,
  };
}

// ── 内部函数 ──────────────────────────────────────────────────

// 预编译正则：查询清洗
const CLEAN_QUERY_RE = /[^\u4e00-\u9fa5a-zA-Z0-9\s]/g;
const CLEAN_WHITESPACE_RE = /\s+/g;

/**
 * 清洗查询文本
 */
function cleanQuery(query: string): string {
  return query
    .replace(CLEAN_QUERY_RE, ' ') // 保留中文、英文、数字
    .replace(CLEAN_WHITESPACE_RE, ' ')
    .trim();
}

// 预编译正则：分词 + 纯数字过滤
const TOKENIZE_RE = /\s+|(?<=[\u4e00-\u9fa5])(?=[a-zA-Z])|(?<=[a-zA-Z])(?=[\u4e00-\u9fa5])/;
const PURE_DIGITS_RE = /^\d+$/;

/**
 * 提取关键词（去除停用词）
 */
function extractKeywords(text: string): string[] {
  // 简单分词：按空格 + 字符边界
  const words = text.split(TOKENIZE_RE);

  return words
    .filter(w => w.length >= 2) // 至少 2 字
    .filter(w => !STOP_WORDS.has(w))
    .filter(w => !PURE_DIGITS_RE.test(w)); // 排除纯数字
}

/**
 * 实体识别（规则匹配）
 */
function extractEntities(text: string): EntityExtraction[] {
  const entities: EntityExtraction[] = [];

  for (const { pattern, type } of ENTITY_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[0] && !entities.some(e => e.text === match[0])) {
        entities.push({
          text: match[0],
          type,
          confidence: 0.9, // 规则匹配置信度较高
        });
      }
    }
  }

  return entities;
}

/**
 * 同义词扩展
 */
function expandSynonyms(keywords: string[]): string[] {
  const expanded = [...keywords];

  for (const keyword of keywords) {
    const synonyms = SYNONYMS[keyword];
    if (synonyms) {
      expanded.push(...synonyms);
    }
  }

  return [...new Set(expanded)]; // 去重
}

/**
 * 生成查询变体
 *
 * 用于提高召回率：
 *   - 原始查询
 *   - 关键词组合
 *   - 同义词替换
 */
function generateVariations(
  original: string,
  keywords: string[],
  expandedKeywords: string[],
): string[] {
  const variations = [original];

  // 变体 1：关键词拼接
  if (keywords.length > 1) {
    variations.push(keywords.join(' '));
  }

  // 变体 2：扩展关键词拼接（最多 5 个）
  if (expandedKeywords.length > keywords.length) {
    const topExpanded = expandedKeywords.slice(0, 5);
    variations.push(topExpanded.join(' '));
  }

  return [...new Set(variations)];
}

// 预编译正则：意图分类
const INTENT_CONVERSATIONAL_RE = /^(你好|嗨|哈喽|早上好|晚上好|晚安)/;
const INTENT_PROCEDURAL_RE = /怎么|如何|怎样|步骤|流程|方法/;
const INTENT_AMBIGUOUS_RE = /是什么意思|指的是|有几种/;
const INTENT_FACTUAL_RE = /是谁|是什么|哪里|什么时候|为什么/;

/**
 * 意图分类（规则匹配）
 */
function classifyIntent(text: string): QueryIntent {
  // 对话型（问候/闲聊）
  if (INTENT_CONVERSATIONAL_RE.test(text)) {
    return 'conversational';
  }

  // 过程查询（怎么做）
  if (INTENT_PROCEDURAL_RE.test(text)) {
    return 'procedural';
  }

  // 歧义查询（多义词）
  if (INTENT_AMBIGUOUS_RE.test(text)) {
    return 'ambiguous';
  }

  // 事实查询（默认）
  if (INTENT_FACTUAL_RE.test(text)) {
    return 'factual';
  }

  return 'unknown';
}

/**
 * 将变换后的查询转换为检索字符串
 *
 * 用于 worldbook 关键词匹配。
 */
export function toSearchableQuery(transformed: TransformedQuery): string {
  // 优先使用关键词 + 实体
  const parts = [...transformed.keywords];

  for (const entity of transformed.entities) {
    if (!parts.includes(entity.text)) {
      parts.push(entity.text);
    }
  }

  return parts.join(' ');
}