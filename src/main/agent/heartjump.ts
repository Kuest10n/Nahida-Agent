/**
 * Heartjump —— 心动机制
 *
 * 是什么：不是所有的 (铃铛轻响)都是心动。心动是违背逻辑、违背习惯、但符合人格的瞬间。
 *   - 比如平时惜字如金，突然多说了一句
 *   - 比如平时只用"铃铛轻响"，突然用了"花冠斜"
 *   - 比如连续三次"开心"后突然"悲伤"
 *
 * 为什么重要：这是角色从"工具"变成"伴侣"的最后一块拼图。
 *
 * 检测维度：
 *   1. 情绪反常：当前情绪与历史情绪分布的 KL 散度
 *   2. 动作反常：当前动作 tag 与历史动作分布的偏差
 *   3. 长度反常：回复长度突然超出历史平均 2σ
 *   4. 频率反常：同一情绪/动作连续出现后突然切换
 *
 * 联动：
 *   - 心动强度 > 0.7 → 触发特殊 Live2D 动作（突然凑近）
 *   - 写入 memory/heartjump.md 形成长期偏好学习
 *   - 在 review-layer C 维后调用，加权到 emotion.score
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { NahidaEmotion, resolveActionEmotion, emotionEnumToCn } from '../../shared/types/emotion';

// ── 类型定义 ──────────────────────────────────────────────────

/** 心动检测结果 */
export interface HeartjumpResult {
  detected: boolean;
  intensity: number;  // 0-1，越高越"心动"
  reason: string;     // 触发原因（情绪反常/动作反常/长度反常/频率反常）
  emotion: NahidaEmotion;
  actionTag: string;
  timestamp: number;
}

/** 历史对话模式（用于判断"反常"） */
interface HistoryPattern {
  emotionCounts: Map<NahidaEmotion, number>;
  actionCounts: Map<string, number>;
  lengthHistory: number[];
  consecutiveEmotions: { emotion: NahidaEmotion; count: number } | null;
  totalTurns: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** memory 目录 */
const MEMORY_DIR = path.resolve(process.cwd(), 'memory');

/** heartjump.md 文件路径 */
const HEARTJUMP_FILE = path.join(MEMORY_DIR, 'heartjump.md');

/** 心动阈值（intensity ≥ 此值触发心动） */
const HEARTJUMP_THRESHOLD = 0.6;

/** 历史窗口大小（最近 N 轮对话） */
const HISTORY_WINDOW = 20;

/** 长度反常阈值（超出历史平均 + 2σ） */
const LENGTH_Z_SCORE_THRESHOLD = 2;

/** 频率反常阈值（连续 N 次后突然切换） */
const CONSECUTIVE_THRESHOLD = 3;

/** 心动动作（特殊 Live2D 动作） */
export const HEARTJUMP_ACTION_TAG = '藤蔓绕腕';

// ── 模块状态 ──────────────────────────────────────────────────

/** 历史对话模式缓存 */
let historyPattern: HistoryPattern = {
  emotionCounts: new Map(),
  actionCounts: new Map(),
  lengthHistory: [],
  consecutiveEmotions: null,
  totalTurns: 0,
};

// ── 核心检测逻辑 ──────────────────────────────────────────────

/**
 * 检测心动 —— 在 review-layer C 维后调用
 *
 * @param userMessage 用户输入（用于上下文理解，v0.9.5 暂不用）
 * @param assistantOutput 助手输出（含动作括号）
 * @param emotion 四审 C 维识别的情绪
 * @param actionTag 主进程抽的动作 tag
 * @returns 心动检测结果
 */
export function detectHeartjump(
  userMessage: string,
  assistantOutput: string,
  emotion: NahidaEmotion,
  actionTag: string,
): HeartjumpResult {
  historyPattern.totalTurns++;

  const reasons: string[] = [];
  let intensity = 0;

  // ── 维度 1：情绪反常 ──
  const emotionAnomaly = detectEmotionAnomaly(emotion);
  if (emotionAnomaly > 0.3) {
    reasons.push('情绪反常');
    intensity += emotionAnomaly * 0.3;
  }

  // ── 维度 2：动作反常 ──
  const actionAnomaly = detectActionAnomaly(actionTag);
  if (actionAnomaly > 0.3) {
    reasons.push('动作反常');
    intensity += actionAnomaly * 0.3;
  }

  // ── 维度 3：长度反常 ──
  const lengthAnomaly = detectLengthAnomaly(assistantOutput.length);
  if (lengthAnomaly > 0.3) {
    reasons.push('长度反常');
    intensity += lengthAnomaly * 0.2;
  }

  // ── 维度 4：频率反常 ──
  const frequencyAnomaly = detectFrequencyAnomaly(emotion);
  if (frequencyAnomaly > 0.3) {
    reasons.push('频率反常');
    intensity += frequencyAnomaly * 0.2;
  }

  // 归一化到 0-1
  intensity = Math.min(1, intensity);

  const detected = intensity >= HEARTJUMP_THRESHOLD;

  // 记录历史模式（不管是否检测到心动，都更新历史）
  updateHistoryPattern(emotion, actionTag, assistantOutput.length);

  // 心动时写入 heartjump.md
  if (detected) {
    writeHeartjumpRecord({
      detected,
      intensity,
      reason: reasons.join('/'),
      emotion,
      actionTag,
      timestamp: Date.now(),
    });
  }

  return {
    detected,
    intensity,
    reason: reasons.join('/') || '无',
    emotion,
    actionTag,
    timestamp: Date.now(),
  };
}

/**
 * 情绪反常检测：当前情绪与历史情绪分布的偏差
 *
 * 用 KL 散度的简化版：当前情绪的历史概率越低，偏差越大
 *   anomaly = 1 - (当前情绪历史次数 / 总次数)
 *
 * 首次出现的情绪：anomaly = 0.9（极高）
 */
function detectEmotionAnomaly(emotion: NahidaEmotion): number {
  if (historyPattern.totalTurns < 5) return 0;

  const total = historyPattern.totalTurns;
  const count = historyPattern.emotionCounts.get(emotion) ?? 0;
  const prob = count / total;

  if (prob === 0) return 0.9;
  return Math.min(1, 1 - prob);
}

/**
 * 动作反常检测：当前动作 tag 与历史动作分布的偏差
 *
 * 同情绪反常逻辑
 */
function detectActionAnomaly(actionTag: string): number {
  if (historyPattern.totalTurns < 5) return 0;

  const total = historyPattern.totalTurns;
  const count = historyPattern.actionCounts.get(actionTag) ?? 0;
  const prob = count / total;

  if (prob === 0) return 0.9;
  return Math.min(1, 1 - prob);
}

/**
 * 长度反常检测：回复长度超出历史平均 + 2σ
 *
 * Z-score = (当前长度 - 均值) / 标准差
 * anomaly = min(1, Z-score / 3)
 */
function detectLengthAnomaly(length: number): number {
  if (historyPattern.lengthHistory.length < 5) return 0;

  const history = historyPattern.lengthHistory;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
  const std = Math.sqrt(variance);

  if (std === 0) return 0;

  const zScore = (length - mean) / std;
  if (zScore < LENGTH_Z_SCORE_THRESHOLD) return 0;

  return Math.min(1, zScore / 3);
}

/**
 * 频率反常检测：同一情绪连续出现后突然切换
 *
 * 如果同一情绪连续出现 ≥ CONSECUTIVE_THRESHOLD 次，
 * 且当前情绪不同 → anomaly = 连续次数 / (连续次数 + 1)
 */
function detectFrequencyAnomaly(emotion: NahidaEmotion): number {
  const consecutive = historyPattern.consecutiveEmotions;
  if (!consecutive) return 0;

  if (consecutive.count >= CONSECUTIVE_THRESHOLD && consecutive.emotion !== emotion) {
    return consecutive.count / (consecutive.count + 1);
  }

  return 0;
}

/**
 * 更新历史对话模式
 */
function updateHistoryPattern(emotion: NahidaEmotion, actionTag: string, length: number): void {
  // 更新情绪计数
  historyPattern.emotionCounts.set(emotion, (historyPattern.emotionCounts.get(emotion) ?? 0) + 1);

  // 更新动作计数
  historyPattern.actionCounts.set(actionTag, (historyPattern.actionCounts.get(actionTag) ?? 0) + 1);

  // 更新长度历史（保持窗口大小）
  historyPattern.lengthHistory.push(length);
  if (historyPattern.lengthHistory.length > HISTORY_WINDOW) {
    historyPattern.lengthHistory.shift();
  }

  // 更新连续情绪
  const prev = historyPattern.consecutiveEmotions;
  if (prev && prev.emotion === emotion) {
    historyPattern.consecutiveEmotions = { emotion, count: prev.count + 1 };
  } else {
    historyPattern.consecutiveEmotions = { emotion, count: 1 };
  }
}

// ── 持久化 ────────────────────────────────────────────────────

/**
 * 将心动记录写入 memory/heartjump.md
 */
function writeHeartjumpRecord(result: HeartjumpResult): void {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    // 文件不存在时先写头部
    if (!fs.existsSync(HEARTJUMP_FILE)) {
      fs.writeFileSync(HEARTJUMP_FILE, [
        '# Heartjump.md — 心动记录',
        '',
        '> 这里记录纳西妲"违背逻辑、违背习惯、但符合人格"的瞬间。',
        '> 每次心动都会触发特殊动作（藤蔓绕腕），并形成长期偏好学习。',
        '',
        '---',
        '',
      ].join('\n'), 'utf-8');
    }

    const timestamp = new Date(result.timestamp).toLocaleString('zh-CN');
    const emotionCn = emotionEnumToCn(result.emotion);

    const lines = [
      `## ${timestamp}`,
      '',
      `| 维度 | 值 |`,
      `|------|-----|`,
      `| 情绪 | ${emotionCn} |`,
      `| 动作 | ${result.actionTag} |`,
      `| 强度 | ${(result.intensity * 100).toFixed(0)}% |`,
      `| 原因 | ${result.reason} |`,
      '',
      `> 心动强度 ≥ ${(HEARTJUMP_THRESHOLD * 100).toFixed(0)}%，触发特殊动作：${HEARTJUMP_ACTION_TAG}`,
      '',
      '---',
      '',
    ];

    fs.appendFileSync(HEARTJUMP_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Heartjump] recorded: ${emotionCn} × ${result.actionTag}, intensity=${result.intensity.toFixed(2)}`);
  } catch (err) {
    console.error('[Heartjump] failed to write record:', err);
  }
}

/**
 * 获取当前心动统计（调试/统计用）
 */
export function getHeartjumpStats(): {
  totalTurns: number;
  emotionDistribution: Record<string, number>;
  actionDistribution: Record<string, number>;
} {
  const emotionDist: Record<string, number> = {};
  historyPattern.emotionCounts.forEach((count, emotion) => {
    emotionDist[emotionEnumToCn(emotion)] = count;
  });

  const actionDist: Record<string, number> = {};
  historyPattern.actionCounts.forEach((count, action) => {
    actionDist[action] = count;
  });

  return {
    totalTurns: historyPattern.totalTurns,
    emotionDistribution: emotionDist,
    actionDistribution: actionDist,
  };
}

/**
 * 重置历史模式（用于新对话开始）
 */
export function resetHeartjumpHistory(): void {
  historyPattern = {
    emotionCounts: new Map(),
    actionCounts: new Map(),
    lengthHistory: [],
    consecutiveEmotions: null,
    totalTurns: 0,
  };
}
