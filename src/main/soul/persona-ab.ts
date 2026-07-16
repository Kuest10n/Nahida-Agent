/**
 * 人格分叉 A/B 测试模块 —— v1.7
 *
 * 职责：
 *   1. 为同一人格创建两个变体（A/B），测试不同 prompt 风格
 *   2. 随机分配用户到 A 或 B 组
 *   3. 跟踪两组的对话质量指标（回复长度/追问率/用户满意度）
 *   4. 提供统计报告，判断哪个变体更优
 *
 * 使用方式：
 *   /ab start <variantA_prompt> <variantB_prompt>  → 启动 A/B 测试
 *   /ab stop                                       → 停止测试
 *   /ab stats                                      → 查看统计
 *   /ab assign                                     → 手动切换分组
 *
 * 设计原则：
 *   - 轻量：不修改人格核心文件，仅注入 prompt 变体
 *   - 公平：随机分配 + 样本均衡
 *   - 可解释：记录每条消息的分组 + 质量指标
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** A/B 测试变体 */
export interface ABVariant {
  /** 变体 ID（'A' 或 'B'） */
  id: 'A' | 'B';
  /** 变体名称 */
  name: string;
  /** Prompt 修饰文本（注入 system prompt） */
  promptModifier: string;
  /** 分配到的消息数 */
  messageCount: number;
  /** 用户追问次数（用户在收到回复后继续发消息的比例） */
  followUpCount: number;
  /** 回复平均长度 */
  totalReplyLength: number;
  /** 回复次数 */
  replyCount: number;
  /** 用户满意度评分（正反馈 +1，负反馈 -1） */
  satisfactionScore: number;
}

/** A/B 测试配置 */
export interface ABTestConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 当前用户分组 */
  currentGroup: 'A' | 'B';
  /** 变体 A */
  variantA: ABVariant;
  /** 变体 B */
  variantB: ABVariant;
  /** 测试开始时间 */
  startTime: string | null;
  /** 总消息数 */
  totalMessages: number;
}

/** A/B 测试统计结果 */
export interface ABTestStats {
  enabled: boolean;
  totalMessages: number;
  variantA: {
    name: string;
    messageCount: number;
    avgReplyLength: number;
    followUpRate: number;
    satisfactionScore: number;
  };
  variantB: {
    name: string;
    messageCount: number;
    avgReplyLength: number;
    followUpRate: number;
    satisfactionScore: number;
  };
  /** 推荐变体（基于综合评分） */
  recommendation: 'A' | 'B' | 'tie' | 'insufficient_data';
}

// ── 常量 ──────────────────────────────────────────────────────

/** A/B 测试持久化文件 */
const AB_FILE = path.resolve(process.cwd(), 'memory', 'persona-ab.json');

/** 默认变体 */
function createDefaultVariant(id: 'A' | 'B', name: string, promptModifier: string): ABVariant {
  return {
    id,
    name,
    promptModifier,
    messageCount: 0,
    followUpCount: 0,
    totalReplyLength: 0,
    replyCount: 0,
    satisfactionScore: 0,
  };
}

/** 默认配置 */
const DEFAULT_CONFIG: ABTestConfig = {
  enabled: false,
  currentGroup: 'A',
  variantA: createDefaultVariant('A', '温柔原版', ''),
  variantB: createDefaultVariant('B', '活泼变体', '在回应中加入更多俏皮和活力，偶尔使用感叹号表达兴奋。'),
  startTime: null,
  totalMessages: 0,
};

// ── 模块状态 ──────────────────────────────────────────────────

let cachedConfig: ABTestConfig | null = null;
let lastMessageWasReply = false;

// ── 持久化 ────────────────────────────────────────────────────

function loadConfig(): ABTestConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(AB_FILE)) {
      const content = fs.readFileSync(AB_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Partial<ABTestConfig>;
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    console.warn('[AB-Test] load failed, use default:', err);
    cachedConfig = { ...DEFAULT_CONFIG };
  }

  return cachedConfig;
}

function saveConfig(config: ABTestConfig): void {
  const tmpPath = AB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, AB_FILE);
    cachedConfig = config;
  } catch (err) {
    console.error('[AB-Test] save failed:', err);
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 启动 A/B 测试
 *
 * @param variantAPrompt 变体 A 的 prompt 修饰
 * @param variantBPrompt 变体 B 的 prompt 修饰
 */
export function startABTest(
  variantAPrompt: string = '',
  variantBPrompt: string = '在回应中加入更多俏皮和活力，偶尔使用感叹号表达兴奋。',
): { success: boolean; message: string } {
  const config = loadConfig();

  if (config.enabled) {
    return { success: false, message: 'A/B 测试已在运行中，请先停止 (/ab stop)' };
  }

  config.enabled = true;
  config.startTime = new Date().toISOString();
  config.totalMessages = 0;
  config.variantA = createDefaultVariant('A', '变体A', variantAPrompt);
  config.variantB = createDefaultVariant('B', '变体B', variantBPrompt);

  // 随机分配初始分组
  config.currentGroup = Math.random() < 0.5 ? 'A' : 'B';

  saveConfig(config);

  return {
    success: true,
    message: `（花冠轻转，眼中闪烁着好奇的光）……A/B 测试已启动！\n变体A：${variantAPrompt || '（默认）'}\n变体B：${variantBPrompt}\n当前分组：${config.currentGroup}`,
  };
}

/**
 * 停止 A/B 测试
 */
export function stopABTest(): { success: boolean; message: string } {
  const config = loadConfig();

  if (!config.enabled) {
    return { success: false, message: 'A/B 测试未在运行' };
  }

  config.enabled = false;
  saveConfig(config);

  return { success: true, message: '（花冠微垂）……A/B 测试已停止，数据已保存。发送 /ab stats 查看结果。' };
}

/**
 * 获取当前分组的 prompt 修饰
 *
 * 在 agent-core 构建 system prompt 时调用。
 */
export function getABPromptModifier(): string {
  const config = loadConfig();
  if (!config.enabled) return '';

  return config.currentGroup === 'A'
    ? config.variantA.promptModifier
    : config.variantB.promptModifier;
}

/**
 * 记录一条消息（在用户发送消息时调用）
 *
 * @returns 当前分组
 */
export function recordMessage(): 'A' | 'B' | null {
  const config = loadConfig();
  if (!config.enabled) return null;

  // 如果上一条是回复，这次消息算追问
  if (lastMessageWasReply && config.totalMessages > 0) {
    const variant = config.currentGroup === 'A' ? config.variantA : config.variantB;
    variant.followUpCount++;
  }

  config.totalMessages++;

  // 记录到当前变体
  const variant = config.currentGroup === 'A' ? config.variantA : config.variantB;
  variant.messageCount++;

  // 随机重新分组（50% 概率切换，保证样本均衡）
  if (Math.random() < 0.5) {
    config.currentGroup = config.currentGroup === 'A' ? 'B' : 'A';
  }

  saveConfig(config);
  lastMessageWasReply = false;

  return config.currentGroup;
}

/**
 * 记录回复（在模型回复完成后调用）
 *
 * @param replyLength 回复长度
 * @param variantGroup 回复所属的分组
 */
export function recordReply(replyLength: number, variantGroup: 'A' | 'B'): void {
  const config = loadConfig();
  if (!config.enabled) return;

  const variant = variantGroup === 'A' ? config.variantA : config.variantB;
  variant.totalReplyLength += replyLength;
  variant.replyCount++;

  saveConfig(config);
  lastMessageWasReply = true;
}

/**
 * 记录用户满意度反馈
 *
 * @param positive 是否正面（true=赞，false=踩）
 */
export function recordFeedback(positive: boolean): void {
  const config = loadConfig();
  if (!config.enabled) return;

  const variant = config.currentGroup === 'A' ? config.variantA : config.variantB;
  variant.satisfactionScore += positive ? 1 : -1;

  saveConfig(config);
}

/**
 * 手动切换分组
 */
export function switchGroup(): { success: boolean; message: string } {
  const config = loadConfig();
  if (!config.enabled) {
    return { success: false, message: 'A/B 测试未在运行' };
  }

  config.currentGroup = config.currentGroup === 'A' ? 'B' : 'A';
  saveConfig(config);

  return { success: true, message: `（虚空屏微光一闪）……已切换到分组 ${config.currentGroup}` };
}

/**
 * 获取 A/B 测试统计
 */
export function getABStats(): ABTestStats {
  const config = loadConfig();

  const variantA = config.variantA;
  const variantB = config.variantB;

  const avgA = variantA.replyCount > 0 ? variantA.totalReplyLength / variantA.replyCount : 0;
  const avgB = variantB.replyCount > 0 ? variantB.totalReplyLength / variantB.replyCount : 0;

  const followUpRateA = variantA.messageCount > 0 ? variantA.followUpCount / variantA.messageCount : 0;
  const followUpRateB = variantB.messageCount > 0 ? variantB.followUpCount / variantB.messageCount : 0;

  // 综合评分：追问率(40%) + 满意度(40%) + 回复长度适中(20%)
  const scoreA = followUpRateA * 40 + variantA.satisfactionScore * 10 + Math.min(avgA / 200, 1) * 20;
  const scoreB = followUpRateB * 40 + variantB.satisfactionScore * 10 + Math.min(avgB / 200, 1) * 20;

  let recommendation: ABTestStats['recommendation'] = 'insufficient_data';
  if (config.totalMessages >= 10) {
    if (Math.abs(scoreA - scoreB) < 2) {
      recommendation = 'tie';
    } else {
      recommendation = scoreA > scoreB ? 'A' : 'B';
    }
  }

  return {
    enabled: config.enabled,
    totalMessages: config.totalMessages,
    variantA: {
      name: variantA.name,
      messageCount: variantA.messageCount,
      avgReplyLength: Math.round(avgA),
      followUpRate: Math.round(followUpRateA * 100) / 100,
      satisfactionScore: variantA.satisfactionScore,
    },
    variantB: {
      name: variantB.name,
      messageCount: variantB.messageCount,
      avgReplyLength: Math.round(avgB),
      followUpRate: Math.round(followUpRateB * 100) / 100,
      satisfactionScore: variantB.satisfactionScore,
    },
    recommendation,
  };
}

/**
 * 格式化统计报告为纳西妲腔文本
 */
export function formatABStats(stats: ABTestStats): string {
  if (!stats.enabled && stats.totalMessages === 0) {
    return '（花冠微垂）……还没有进行过 A/B 测试呢。发送 `/ab start` 开始吧。';
  }

  const lines: string[] = [];
  lines.push('（指尖轻拂虚空屏，数据如花瓣般浮现）……A/B 测试统计：');
  lines.push('');
  lines.push(`总消息数：${stats.totalMessages}`);
  lines.push(`状态：${stats.enabled ? '运行中' : '已停止'}`);
  lines.push('');
  lines.push('┌─────────┬──────────┬──────────┐');
  lines.push('│  指标   │  变体A   │  变体B   │');
  lines.push('├─────────┼──────────┼──────────┤');
  lines.push(`│ 消息数   │    ${stats.variantA.messageCount}    │    ${stats.variantB.messageCount}    │`);
  lines.push(`│ 平均长度 │   ${stats.variantA.avgReplyLength}   │   ${stats.variantB.avgReplyLength}   │`);
  lines.push(`│ 追问率   │  ${stats.variantA.followUpRate}  │  ${stats.variantB.followUpRate}  │`);
  lines.push(`│ 满意度   │   ${stats.variantA.satisfactionScore}    │   ${stats.variantB.satisfactionScore}    │`);
  lines.push('└─────────┴──────────┴──────────┘');

  const recText = {
    'A': '变体 A 表现更好呢，就像向阳的花朵更茁壮',
    'B': '变体 B 表现更好呢，看来这边的养分更充足',
    'tie': '两个变体不相上下，就像并蒂的花朵',
    'insufficient_data': '数据还不够充分，至少需要 10 条消息才能做出判断呢',
  };
  lines.push('');
  lines.push(`建议：${recText[stats.recommendation]}`);

  return lines.join('\n');
}

/**
 * 重置 A/B 测试（测试用）
 */
export function resetABTest(): void {
  cachedConfig = null;
  if (fs.existsSync(AB_FILE)) {
    fs.unlinkSync(AB_FILE);
  }
  lastMessageWasReply = false;
}