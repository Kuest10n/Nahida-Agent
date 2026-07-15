/**
 * Rand_error —— 自主进化实现
 *
 * 职责：
 *   追踪四审 fail 事件，同类型错误累计超过阈值时自动抛出 Rand_error 报告，
 *   写入 memory/rand_error.md，并返回报告内容供 IPC 推送。
 *
 * 自主进化机制（v0.8.2）：
 *   - 启动时从 reflect.md 加载已识别问题
 *   - 生成报告时检查是否与已知问题重复
 *   - 如果是新问题，自动追加到 reflect.md
 *   - 如果已知问题再次触发，更新其计数/最近样本
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

/** 按类型分组的错误日志（用于报告样本） */
const errorLog = new Map<ReviewErrorType, ErrorRecord[]>();

/** 按类型累计计数（独立计数器，不受报告后清理影响） */
const errorCounts = new Map<ReviewErrorType, number>();

/** 已生成但尚未被消费的报告队列 */
const pendingReports: RandErrorReport[] = [];

/** reflect.md 文件路径 */
const REFLECT_FILE = path.join(MEMORY_DIR, 'reflect.md');

/** 已识别问题缓存（从 reflect.md 加载） */
let knownIssuesCache: Map<ReviewErrorType, KnownIssue> | null = null;

/** 已知问题结构 */
interface KnownIssue {
  type: ReviewErrorType;
  description: string;
  lastCount: number;
  lastSample: string;
  lastSeen: number;
}

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

  // 独立计数器：每次追加 +1，不受报告后清理影响
  const current = errorCounts.get(type) ?? 0;
  const next = current + 1;
  errorCounts.set(type, next);

  // 检查是否超阈值（>50 自动抛出）
  if (next >= ERROR_THRESHOLD) {
    const report = generateReport(type, next);
    if (report) {
      pendingReports.push(report);
      // 报告生成后不清空计数，保持累计可见
      console.warn(`[RandError] threshold reached: ${type} ×${next}, report generated`);
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
    'A-OOC': errorCounts.get('A-OOC') ?? 0,
    'B-bracket': errorCounts.get('B-bracket') ?? 0,
    'C-mismatch': errorCounts.get('C-mismatch') ?? 0,
    'D-tool': errorCounts.get('D-tool') ?? 0,
  };
}

// ── 内部逻辑 ──────────────────────────────────────────────────

/**
 * 从 reflect.md 加载已识别问题
 *
 * 解析 reflect.md 中的"已识别问题"章节，提取问题类型和描述
 */
function loadKnownIssues(): Map<ReviewErrorType, KnownIssue> {
  if (knownIssuesCache) return knownIssuesCache;

  const cache = new Map<ReviewErrorType, KnownIssue>();

  try {
    if (!fs.existsSync(REFLECT_FILE)) {
      knownIssuesCache = cache;
      return cache;
    }

    const content = fs.readFileSync(REFLECT_FILE, 'utf-8');

    // 解析"已识别问题"章节
    const issuePattern = /### (\d+)\. (.+?)\n- \*\*问题\*\*：(.+?)\n/g;
    let match;

    while ((match = issuePattern.exec(content)) !== null) {
      const description = match[2] ?? '';
      const problem = match[3] ?? '';

      // 根据描述推断错误类型
      let type: ReviewErrorType | null = null;
      if (/OOC|助手腔|全知/.test(description)) {
        type = 'A-OOC';
      } else if (/动作括号|末句/.test(description)) {
        type = 'B-bracket';
      } else if (/情绪|动作.*不匹配/.test(description)) {
        type = 'C-mismatch';
      } else if (/工具调用|tool_call/.test(description)) {
        type = 'D-tool';
      }

      if (type) {
        cache.set(type, {
          type,
          description,
          lastCount: 0,
          lastSample: problem,
          lastSeen: Date.now(),
        });
      }
    }

    console.log(`[RandError] loaded ${cache.size} known issues from reflect.md`);
  } catch (err) {
    console.error('[RandError] failed to load known issues:', err);
  }

  knownIssuesCache = cache;
  return cache;
}

/**
 * 检查问题是否已知
 */
function isKnownIssue(type: ReviewErrorType): boolean {
  const known = loadKnownIssues();
  return known.has(type);
}

/**
 * 将新问题追加到 reflect.md
 */
function appendToReflect(type: ReviewErrorType, sample: string, count: number): void {
  try {
    if (!fs.existsSync(REFLECT_FILE)) {
      fs.writeFileSync(REFLECT_FILE, '# reflect.md — 反思与改进\n\n', 'utf-8');
    }

    const timestamp = new Date().toLocaleString('zh-CN');
    const suggestion = ERROR_SUGGESTIONS[type];

    const lines = [
      '',
      `### 自动识别问题：${type}（累计 ${count} 次）`,
      `- **问题**：${sample}`,
      `- **触发时间**：${timestamp}`,
      `- **累计次数**：${count}`,
      `- **建议修改方向**：${suggestion}`,
      '',
      '---',
      '',
    ];

    fs.appendFileSync(REFLECT_FILE, lines.join('\n'), 'utf-8');
    console.log(`[RandError] new issue appended to reflect.md: ${type}`);
  } catch (err) {
    console.error('[RandError] failed to append to reflect.md:', err);
  }
}

/**
 * 生成单类型的 Rand_error 报告
 */
function generateReport(type: ReviewErrorType, totalCount: number): RandErrorReport | null {
  const list = errorLog.get(type);
  if (!list || list.length === 0) return null;

  // 取最近 MAX_SAMPLES_IN_REPORT 条样本
  const recent = list.slice(-MAX_SAMPLES_IN_REPORT).map(r => r.sample);

  const report: RandErrorReport = {
    type,
    count: totalCount,
    threshold: ERROR_THRESHOLD,
    recentSamples: recent,
    suggestion: ERROR_SUGGESTIONS[type],
    generatedAt: Date.now(),
  };

  // 自主进化：检查是否已知问题
  const known = isKnownIssue(type);
  if (!known) {
    // 新问题，追加到 reflect.md
    appendToReflect(type, recent[0] ?? '', totalCount);
    console.log(`[RandError] new issue detected and logged: ${type}`);
  } else {
    console.log(`[RandError] known issue triggered again: ${type}`);
  }

  return report;
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
