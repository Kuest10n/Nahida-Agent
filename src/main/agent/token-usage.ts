/**
 * Token 使用统计模块 —— v1.0.0 封板功能
 *
 * 职责：
 *   统一管理 token 使用统计，支持 /stats 命令查询和折线图可视化。
 *
 * 设计：
 *   - 单次对话 token ≈ 输入字符数/4 + 输出字符数/4（近似估算，足够统计用）
 *   - 按日期聚合：每天一个统计单元，支持历史趋势分析
 *   - 持久化：memory/token-usage.json，启动时加载，每次对话后更新
 *   - 支持模型区分：统计每个模型的调用量
 *
 * 纯 CPU 运算，不占 GPU。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 单次 token 使用记录 */
export interface TokenRecord {
  /** 会话 ID */
  sessionId: string;
  /** 模型名 */
  model: string;
  /** 输入 token（近似） */
  promptTokens: number;
  /** 输出 token（近似） */
  completionTokens: number;
  /** 总 token */
  totalTokens: number;
  /** 时间戳 */
  timestamp: number;
  /** 层级（local/standard/flash） */
  tier?: string;
}

/** 日统计单元 */
export interface DailyStats {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 总 token 数 */
  totalTokens: number;
  /** 总对话次数 */
  conversationCount: number;
  /** 各模型调用量 */
  modelUsage: Record<string, number>;
  /** 平均响应时间（ms） */
  avgLatencyMs: number;
  /** 总延迟（用于计算平均） */
  totalLatencyMs: number;
}

/** 完整统计数据 */
export interface TokenUsageData {
  /** 总 token 数（累计） */
  totalTokens: number;
  /** 总对话次数（累计） */
  totalConversations: number;
  /** 首次启动时间 */
  firstStartedAt: number;
  /** 最近 30 天统计 */
  dailyStats: DailyStats[];
  /** 当前会话 token 累计 */
  currentSessionTokens: number;
  /** 当前会话对话数 */
  currentSessionConversations: number;
}

// ── 常量 ──────────────────────────────────────────────────────

const DATA_FILE = path.resolve(process.cwd(), 'memory', 'token-usage.json');
const MAX_DAILY_STATS = 30;

// ── 模块状态 ──────────────────────────────────────────────────

let data: TokenUsageData;
let initialized = false;
/** 写盘 debounce 定时器，避免每次对话都同步 IO */
let saveTimer: NodeJS.Timeout | null = null;
/** 缓存今日的 dailyStats 引用，避免每次都 find() */
let cachedToday: DailyStats | null = null;
let cachedTodayStr = '';

// ── 核心逻辑 ──────────────────────────────────────────────────

/** 创建默认数据 */
function createDefaultData(): TokenUsageData {
  return {
    totalTokens: 0,
    totalConversations: 0,
    firstStartedAt: Date.now(),
    dailyStats: [],
    currentSessionTokens: 0,
    currentSessionConversations: 0,
  };
}

/** 获取今日日期字符串 */
function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 获取今日的 dailyStats 引用（带缓存）
 *
 * 优化：避免每次 recordTokenUsage 都 O(n) find()
 */
function getTodayStats(): DailyStats {
  const today = getTodayStr();

  // 缓存命中：日期未变且引用有效
  if (today === cachedTodayStr && cachedToday) {
    return cachedToday;
  }

  // 缓存失效：查找或创建
  let daily = data.dailyStats.find(d => d.date === today);
  if (!daily) {
    daily = {
      date: today,
      totalTokens: 0,
      conversationCount: 0,
      modelUsage: {},
      avgLatencyMs: 0,
      totalLatencyMs: 0,
    };
    data.dailyStats.push(daily);
    // 只保留最近 30 天
    if (data.dailyStats.length > MAX_DAILY_STATS) {
      data.dailyStats.shift();
    }
  }

  cachedToday = daily;
  cachedTodayStr = today;
  return daily;
}

/** 初始化（启动时调用一次） */
export function initTokenUsage(): void {
  if (initialized) return;

  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const saved = JSON.parse(content) as Partial<TokenUsageData>;
      data = {
        totalTokens: saved.totalTokens ?? 0,
        totalConversations: saved.totalConversations ?? 0,
        firstStartedAt: saved.firstStartedAt ?? Date.now(),
        dailyStats: saved.dailyStats ?? [],
        currentSessionTokens: 0,
        currentSessionConversations: 0,
      };
    } catch (err) {
      console.warn('[TokenUsage] failed to load data:', err);
      data = createDefaultData();
    }
  } else {
    data = createDefaultData();
  }

  initialized = true;
  console.log(`[TokenUsage] initialized: totalTokens=${data.totalTokens}, totalConversations=${data.totalConversations}`);
}

/** 记录一次 token 使用 */
export function recordTokenUsage(record: TokenRecord): void {
  if (!initialized) initTokenUsage();

  // 累加总数
  data.totalTokens += record.totalTokens;
  data.totalConversations++;
  data.currentSessionTokens += record.totalTokens;
  data.currentSessionConversations++;

  // 更新日统计（使用缓存，O(1)）
  const daily = getTodayStats();
  daily.totalTokens += record.totalTokens;
  daily.conversationCount++;
  daily.modelUsage[record.model] = (daily.modelUsage[record.model] ?? 0) + record.totalTokens;

  // debounce 写盘（2 秒，token 统计对实时性要求不高）
  scheduleSave();
}

/** 带延迟的记录（推荐用法） */
export function recordTokenUsageWithLatency(
  sessionId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  tier?: string,): void {
  recordTokenUsage({
    sessionId,
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    timestamp: Date.now(),
    tier,
  });

  // 更新日延迟统计（使用缓存，O(1)）
  const daily = getTodayStats();
  daily.totalLatencyMs += latencyMs;
  daily.avgLatencyMs = Math.round(daily.totalLatencyMs / daily.conversationCount);
}

/** debounce 调度写盘 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveData();
  }, 2000);
}

/** 保存到磁盘（原子写） */
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
    console.error('[TokenUsage] save failed:', err);
  }
}

/** 获取完整统计数据 */
export function getTokenUsageData(): TokenUsageData {
  if (!initialized) initTokenUsage();
  return { ...data };
}

/** 获取统计摘要（/stats 用） */
export function getTokenStatsSummary(): string {
  if (!initialized) initTokenUsage();

  const lines: string[] = [
    `📊 Token 使用统计`,
    ``,
    `**累计**`,
    `- 总 Token: ${data.totalTokens.toLocaleString()}`,
    `- 总对话: ${data.totalConversations} 次`,
    `- 运行天数: ${Math.ceil((Date.now() - data.firstStartedAt) / (24 * 60 * 60 * 1000))} 天`,
    ``,
    `**当前会话**`,
    `- Token: ${data.currentSessionTokens.toLocaleString()}`,
    `- 对话: ${data.currentSessionConversations} 次`,
  ];

  // 最近 7 天趋势
  if (data.dailyStats.length > 0) {
    lines.push(``, `**最近 7 天趋势**`);
    const recent = data.dailyStats.slice(-7).reverse();
    for (const day of recent) {
      const avgPerConv = day.conversationCount > 0
        ? Math.round(day.totalTokens / day.conversationCount)
        : 0;
      lines.push(`- ${day.date}: ${day.totalTokens.toLocaleString()} tokens (${day.conversationCount} 次, 平均 ${avgPerConv}/次)`);
    }
  }

  // 模型使用分布（按总 token 排序）
  const modelTotals: Record<string, number> = {};
  for (const day of data.dailyStats) {
    for (const [model, tokens] of Object.entries(day.modelUsage)) {
      modelTotals[model] = (modelTotals[model] ?? 0) + tokens;
    }
  }

  if (Object.keys(modelTotals).length > 0) {
    lines.push(``, `**模型使用分布**`);
    const sorted = Object.entries(modelTotals).sort((a, b) => b[1] - a[1]);
    for (const [model, tokens] of sorted.slice(0, 5)) {
      const percent = data.totalTokens > 0
        ? Math.round((tokens / data.totalTokens) * 100)
        : 0;
      lines.push(`- ${model}: ${tokens.toLocaleString()} (${percent}%)`);
    }
  }

  return lines.join('\n');
}

/** 获取图表数据（Chart.js 用） */
export function getChartData(): {
  dates: string[];
  tokens: number[];
  conversations: number[];
  modelDistribution: { labels: string[]; values: number[] };
} {
  if (!initialized) initTokenUsage();

  const dates = data.dailyStats.map(d => d.date);
  const tokens = data.dailyStats.map(d => d.totalTokens);
  const conversations = data.dailyStats.map(d => d.conversationCount);

  // 模型使用分布（累计所有天数）
  const modelTotals: Record<string, number> = {};
  for (const day of data.dailyStats) {
    for (const [model, count] of Object.entries(day.modelUsage)) {
      modelTotals[model] = (modelTotals[model] ?? 0) + count;
    }
  }
  const sorted = Object.entries(modelTotals).sort((a, b) => b[1] - a[1]);

  return {
    dates,
    tokens,
    conversations,
    modelDistribution: {
      labels: sorted.map(([name]) => name),
      values: sorted.map(([, count]) => count),
    },
  };
}

/** 重置当前会话统计（新会话开始时调用） */
export function resetCurrentSession(): void {
  if (!initialized) initTokenUsage();
  data.currentSessionTokens = 0;
  data.currentSessionConversations = 0;
}

/**
 * 立即将内存中的统计数据刷到磁盘
 *
 * 在应用退出时调用，防止 debounce 中的数据丢失。
 */
export function flushTokenUsage(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveData();
  }
}

/** 重置全部（测试用） */
export function resetTokenUsage(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  data = createDefaultData();
  cachedToday = null;
  cachedTodayStr = '';
  saveData();
  console.log('[TokenUsage] reset');
}