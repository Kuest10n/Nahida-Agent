/**
 * Rand_error —— 自主进化最小实现
 *
 * 职责：
 *   追踪四审 fail 事件，同类型错误累计超过阈值时自动抛出 Rand_error 报告，
 *   写入 memory/rand_error.md，并返回报告内容供 IPC 推送。
 *
 * 设计理念（来自用户草稿）：
 *   - reflect.md：人工维护"我知道我错了"（已识别+经验教训）
 *   - rand_error.md：自动维护"错够多了，强制改"（同类型>阈值 → 抛报告）
 *
 * 阈值：默认 50 次（同类型错误），可通过配置调整
 * 报告格式：类型 / 累计次数 / 最近 5 条样本 / 建议修改方向
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 四审错误类型 */
export type ReviewErrorType =
  | 'A-OOC'        // A 维：OOC/助手腔
  | 'B-bracket'    // B 维：末句缺动作括号
  | 'C-mismatch'   // C 维：情绪与动作不匹配
  | 'D-tool';      // D 维：工具调用校验失败

/** 单条错误记录 */
interface ErrorRecord {
  type: ReviewErrorType;
  sample: string;
  ts: number;
}

/** Rand_error 报告 */
export interface RandErrorReport {
  type: ReviewErrorType;
  count: number;
  threshold: number;
  recentSamples: string[];
  suggestion: string;
  generatedAt: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 同类型错误阈值（超过则抛 Rand_error） */
const ERROR_THRESHOLD = 50;

/** 报告中保留的最近样本数 */
const MAX_SAMPLES_IN_REPORT = 5;

/** 内存中保留的最大记录数（防止无限增长） */
const MAX_RECORDS_PER_TYPE = 100;

/** memory 目录 */
const MEMORY_DIR = path.resolve(process.cwd(), 'memory');

// ── 模块状态 ──────────────────────────────────────────────────

/** 按类型分组的错误日志 */
const errorLog = new Map<ReviewErrorType, ErrorRecord[]>();

/** 已生成但尚未被消费的报告队列 */
const pendingReports: RandErrorReport[] = [];

// ── 错误类型 → 建议修改方向 ───────────────────────────────────

const ERROR_SUGGESTIONS: Record<ReviewErrorType, string> = {
  'A-OOC': '主模型频繁输出 OOC/助手腔。建议：1) 检查 SOHA.md §2 禁词列表是否完整；2) 考虑在 system prompt 加 few-shot 反例；3) 若 v3 模型 A 维准确率仍不够，保持规则兜底',
  'B-bracket': '主模型频繁漏动作括号。建议：1) 检查 SOHA.md §1 末句规则是否够强；2) 考虑在 TOOL_CALL_PROMPT 后追加"末句必须带（动作括号）"提醒；3) review-layer B 维 fail 时考虑自动补括号而非仅 rewrite',
  'C-mismatch': '情绪 tag 与动作 tag 频繁不匹配。建议：1) 检查 emotion.ts ACTION_TAG_TO_ENUM 映射表是否覆盖当前所有动作 tag；2) 考虑在 C 维 fail 时用动作 tag 反推情绪 tag（而非要求主模重出）',
  'D-tool': '工具调用频繁校验失败。建议：1) 检查 TOOL_CALL_PROMPT 是否给了足够的参数示例；2) 考虑在 tool_executor 加 JSON 修复逻辑（fixSingleQuotes 已有，扩展到缺引号/多余逗号）',
};

// ── 对外 API ──────────────────────────────────────────────────

/**
 * 追加一条错误记录
 *
 * 由 review-layer 在 fail 路径调用。同类型累计超过阈值时自动生成报告。
 *
 * @param type   错误类型
 * @param sample 导致 fail 的样本文本（截取前 200 字）
 */
export function appendReviewError(type: ReviewErrorType, sample: string): void {
  const truncated = sample.slice(0, 200);
  const record: ErrorRecord = { type, sample: truncated, ts: Date.now() };

  let list = errorLog.get(type);
  if (!list) {
    list = [];
    errorLog.set(type, list);
  }
  list.push(record);

  // 防止内存无限增长：超过上限时丢弃最早的
  if (list.length > MAX_RECORDS_PER_TYPE) {
    list.splice(0, list.length - MAX_RECORDS_PER_TYPE);
  }

  // 检查是否超阈值
  if (list.length >= ERROR_THRESHOLD) {
    const report = generateReport(type);
    if (report) {
      pendingReports.push(report);
      list.splice(0, list.length - 10);
      console.warn(`[RandError] threshold reached: ${type} ×${report.count}, report generated`);
    }
  }
}

/**
 * 消费待处理的 Rand_error 报告
 *
 * 由 handlers.ts 在每轮对话后检查，有报告则：
 *   1. 写入 memory/rand_error.md
 *   2. 返回报告内容供 IPC 推送渲染层
 *
 * @returns 待处理的报告列表（可能为空）
 */
export function consumePendingReports(): RandErrorReport[] {
  if (pendingReports.length === 0) return [];

  const reports = pendingReports.splice(0);
  writeReportToDisk(reports);
  return reports;
}

/**
 * 获取当前各类型错误计数（调试/统计用）
 */
export function getErrorCounts(): Record<ReviewErrorType, number> {
  return {
    'A-OOC': errorLog.get('A-OOC')?.length ?? 0,
    'B-bracket': errorLog.get('B-bracket')?.length ?? 0,
    'C-mismatch': errorLog.get('C-mismatch')?.length ?? 0,
    'D-tool': errorLog.get('D-tool')?.length ?? 0,
  };
}

// ── 内部逻辑 ──────────────────────────────────────────────────

/**
 * 生成单类型的 Rand_error 报告
 */
function generateReport(type: ReviewErrorType): RandErrorReport | null {
  const list = errorLog.get(type);
  if (!list || list.length === 0) return null;

  // 取最近 MAX_SAMPLES_IN_REPORT 条样本
  const recent = list.slice(-MAX_SAMPLES_IN_REPORT).map(r => r.sample);

  return {
    type,
    count: list.length,
    threshold: ERROR_THRESHOLD,
    recentSamples: recent,
    suggestion: ERROR_SUGGESTIONS[type],
    generatedAt: Date.now(),
  };
}

/**
 * 将报告写入 memory/rand_error.md（追加模式）
 */
function writeReportToDisk(reports: RandErrorReport[]): void {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    const filePath = path.join(MEMORY_DIR, 'rand_error.md');
    const timestamp = new Date().toISOString();

    const lines: string[] = [
      `<!-- ${timestamp} 自动生成 -->`,
      '',
    ];

    for (const r of reports) {
      lines.push(`## Rand_error: ${r.type}（累计 ${r.count} 次）`);
      lines.push('');
      lines.push(`> 阈值 ${r.threshold}，触发时间 ${new Date(r.generatedAt).toLocaleString('zh-CN')}`);
      lines.push('');
      lines.push('### 最近样本');
      r.recentSamples.forEach((s, i) => {
        lines.push(`${i + 1}. \`${s}\``);
      });
      lines.push('');
      lines.push('### 建议修改方向');
      lines.push(r.suggestion);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    fs.appendFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`[RandError] report written to ${filePath}`);
  } catch (err) {
    console.error('[RandError] failed to write report:', err);
  }
}
