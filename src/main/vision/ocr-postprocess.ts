/**
 * OCR 后处理模块（v2.10.0）
 *
 * 为什么需要后处理：
 *   Tesseract.js 对中文、低分辨率、复杂背景的识别准确率有限，
 *   原始输出常包含：噪声字符、中英文混排空格错误、常见 OCR 混淆（0/O、1/l/I）、
 *   多余空行、重复字符等。后处理能在不换模型的情况下显著提升可读性。
 *
 * 设计原则（参考经验 1276728）：
 *   1. 不做过度修正——只修"确定错"的，不做"可能对"的猜测
 *   2. 分场景处理——中文/英文/数字各有不同的混淆模式
 *   3. 保留原始文本——postProcess 返回 { raw, cleaned, structure } 三层
 *   4. 可诊断——每步处理都记录改动点，便于排查
 *
 * 处理管线：
 *   rawText → cleanText() → detectStructure() → OcrProcessedResult
 *                    ↓
 *              字符级修正映射表
 */

// ── 类型定义 ──────────────────────────────────────────────────

export interface OcrProcessedResult {
  /** 原始 OCR 输出 */
  raw: string;
  /** 清洗后的文本（去噪 + 常见错误修正 + 空格规范化） */
  cleaned: string;
  /** 结构分析结果 */
  structure: OcrStructure;
  /** 修正记录（用于诊断） */
  corrections: OcrCorrection[];
  /** v2.14：行级置信度信息（来自 Tesseract，可选） */
  confidence?: OcrConfidenceSummary;
}

export interface OcrStructure {
  /** 段落列表（按空行分段） */
  paragraphs: string[];
  /** 检测到的表格（Markdown 格式） */
  tables: string[];
  /** 检测到的代码块 */
  codeBlocks: string[];
  /** 检测到的列表项 */
  listItems: string[];
  /** 语言检测结果（粗略） */
  primaryLanguage: 'zh' | 'en' | 'mixed';
  /** 文本质量评分（0-100，越高越好） */
  qualityScore: number;
}

export interface OcrCorrection {
  /** 修正类型 */
  type: 'whitespace' | 'common-ocr-error' | 'duplicate' | 'punctuation' | 'newline';
  /** 修正前片段 */
  from: string;
  /** 修正后片段 */
  to: string;
  /** 位置（字符偏移，近似） */
  position: number;
}

// ── v2.14.0：行级置信度 ──────────────────────────────────────

/** v2.17：Tesseract 行的边界框（用于二次识别裁剪） */
export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 单行 OCR 置信度信息 */
export interface OcrLineConfidence {
  /** 行文本 */
  text: string;
  /** Tesseract 置信度（0-100，越高越可信） */
  confidence: number;
  /** 置信度等级（便于 UI 高亮） */
  level: 'high' | 'medium' | 'low';
  /** v2.17：行的边界框（来自 Tesseract，用于二次识别裁剪，可选） */
  bbox?: BoundingBox;
}

/** 置信度阈值（经验值） */
export const CONFIDENCE_THRESHOLD_HIGH = 85;
export const CONFIDENCE_THRESHOLD_MEDIUM = 60;

/** 把 Tesseract 置信度映射到等级 */
export function confidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= CONFIDENCE_THRESHOLD_HIGH) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLD_MEDIUM) return 'medium';
  return 'low';
}

/** 置信度聚合结果 */
export interface OcrConfidenceSummary {
  /** 所有行的置信度（按文本顺序） */
  lines: OcrLineConfidence[];
  /** 整体平均置信度（0-100） */
  average: number;
  /** 最低置信度（0-100） */
  minimum: number;
  /** 低置信度行数（<60） */
  lowCount: number;
  /** 总行数 */
  totalLines: number;
}

// ── 常见 OCR 混淆字符修正映射 ─────────────────────────────────
//
// 只做"上下文明确"的修正，不做纯猜测。
// 规则：
//   - 纯数字串中：O→0, l→1, I→1, S→5, B→8, Z→2, q→9
//   - 纯英文单词中：0→O, 1→l, 5→S, 8→B
//   - 中文上下文中的单个混淆字符：按中文习惯修正
//
// 注意：不做全局替换！只在特定上下文中修正，避免误伤。

/** 纯数字串中的常见 OCR 错误映射（字母 → 数字） */
const DIGIT_CONTEXT_MAP: Record<string, string> = {
  'O': '0', 'o': '0',
  'l': '1', 'I': '1', 'i': '1',
  'S': '5', 's': '5',
  'B': '8',
  'Z': '2', 'z': '2',
  'q': '9',
  'G': '6',
  'g': '6',
  'Q': '0',
  'D': '0',
};

/** 纯英文单词中的常见 OCR 错误映射（数字 → 字母） */
const LETTER_CONTEXT_MAP: Record<string, string> = {
  '0': 'O',
  '1': 'l',
  '5': 'S',
  '8': 'B',
  '2': 'Z',
  '9': 'q',
  '6': 'G',
};

// ── 预编译正则（模块级常量，避免每次调用重新编译） ─────────────

const RE_MULTIPLE_NEWLINES = /\n{3,}/g;
const RE_TRAILING_SPACES = /[ \t]+$/gm;
const RE_MULTIPLE_SPACES = / {2,}/g;
const RE_INVISIBLE_CHARS = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g;
const RE_TOKEN_SPLIT = /(\s+|[，。！？、；：""''（）【】《》,\.!?;:"'()\[\]<>]+)/;
const RE_PUNCT_OR_SPACE = /^[\s\p{P}]+$/u;
const RE_DIGITS = /^\d+$/;
const RE_LETTERS = /^[a-zA-Z]+$/;
const RE_ALNUM = /^[a-zA-Z0-9]+$/;
const RE_LETTER_MATCH = /[a-zA-Z]/g;
const RE_CN_EN_BOUNDARY_1 = /([\u4e00-\u9fa5])([a-zA-Z0-9])/g;
const RE_CN_EN_BOUNDARY_2 = /([a-zA-Z0-9])([\u4e00-\u9fa5])/g;
const RE_CN_PUNCT_SPACE_1 = /([\u4e00-\u9fa5])\s+([，。！？、；：""''（）【】《》])/g;
const RE_CN_PUNCT_SPACE_2 = /([，。！？、；：""''（）【】《》])\s+([\u4e00-\u9fa5])/g;
const RE_CN_DOT = /([\u4e00-\u9fa5])\.([\u4e00-\u9fa5])/g;
const RE_CN_COMMA = /([\u4e00-\u9fa5]),([\u4e00-\u9fa5])/g;
const RE_CN_QUESTION = /([\u4e00-\u9fa5])\?([\u4e00-\u9fa5])/g;
const RE_CN_EXCLAMATION = /([\u4e00-\u9fa5])!([\u4e00-\u9fa5])/g;
const RE_CN_COLON = /([\u4e00-\u9fa5]):([\u4e00-\u9fa5])/g;
const RE_CN_SEMICOLON = /([\u4e00-\u9fa5]);([\u4e00-\u9fa5])/g;
const RE_PARAGRAPH_SPLIT = /\n\s*\n/;
const RE_TABLE_SEPARATOR = /^[+\-=|]+$/;
const RE_CODE_INDENT_SPACE = /^    / ;
const RE_CODE_INDENT_TAB = /^\t/;
const RE_LIST_MARKER_1 = /^\s*[-*+]\s+/;
const RE_LIST_MARKER_2 = /^\s*\d+[.)]\s+/;
const RE_CHINESE_CHAR = /[\u4e00-\u9fa5]/g;
const RE_ENGLISH_CHAR = /[a-zA-Z]/g;
const RE_PRINTABLE_CHAR = /[\x20-\x7E\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef\n\t]/g;

// ── 主入口 ────────────────────────────────────────────────────

/**
 * OCR 后处理主函数
 *
 * @param rawText Tesseract 原始输出
 * @param tesseractLines Tesseract 的行数据（含置信度和 bbox，可选，v2.14/v2.17）
 * @returns 处理后的结果（含原始文本、清洗文本、结构分析、修正记录、置信度）
 */
export function postProcessOcr(
  rawText: string,
  tesseractLines?: Array<{ text: string; confidence: number; bbox?: BoundingBox }>,
): OcrProcessedResult {
  const corrections: OcrCorrection[] = [];

  // 阶段 1: 基础清洗
  let cleaned = cleanBasic(rawText, corrections);

  // 阶段 2: 常见 OCR 错误修正（上下文感知）
  cleaned = fixCommonOcrErrors(cleaned, corrections);

  // 阶段 3: 中英文混排空格规范化
  cleaned = normalizeCnEnSpacing(cleaned, corrections);

  // 阶段 4: 标点规范化
  cleaned = normalizePunctuation(cleaned, corrections);

  // 阶段 5: 结构分析
  const structure = detectStructure(cleaned);

  // v2.14：聚合行级置信度
  const confidence = summarizeConfidence(tesseractLines, structure.qualityScore);

  return {
    raw: rawText,
    cleaned,
    structure,
    corrections,
    confidence,
  };
}

/**
 * 从 Tesseract 行数据聚合置信度信息
 *
 * 如果没有 Tesseract 行数据（旧调用方/降级路径），用结构质量评分反推一个伪置信度，
 * 保证返回结构始终存在 confidence 字段。
 */
function summarizeConfidence(
  lines: Array<{ text: string; confidence: number; bbox?: BoundingBox }> | undefined,
  fallbackQuality: number,
): OcrConfidenceSummary {
  if (!lines || lines.length === 0) {
    // 降级：用结构质量评分作为伪平均置信度
    return {
      lines: [],
      average: fallbackQuality,
      minimum: fallbackQuality,
      lowCount: 0,
      totalLines: 0,
    };
  }

  const lineConfidences: OcrLineConfidence[] = lines.map(l => ({
    text: l.text,
    confidence: Math.round(l.confidence),
    level: confidenceLevel(l.confidence),
    bbox: l.bbox,
  }));

  const confidences = lineConfidences.map(l => l.confidence);
  const sum = confidences.reduce((a, b) => a + b, 0);
  const average = Math.round(sum / confidences.length);
  const minimum = Math.min(...confidences);
  const lowCount = lineConfidences.filter(l => l.level === 'low').length;

  return {
    lines: lineConfidences,
    average,
    minimum,
    lowCount,
    totalLines: lineConfidences.length,
  };
}

// ── 阶段 1: 基础清洗 ─────────────────────────────────────────

function cleanBasic(text: string, corrections: OcrCorrection[]): string {
  let result = text;

  // 去除首尾空白
  const trimmed = result.trim();
  if (trimmed !== result) {
    corrections.push({ type: 'whitespace', from: result, to: trimmed, position: 0 });
    result = trimmed;
  }

  // 合并连续空行（3+ 空行 → 2 空行，即保留段落间隔）
  const beforeLines = result;
  result = result.replace(RE_MULTIPLE_NEWLINES, '\n\n');
  if (result !== beforeLines) {
    corrections.push({ type: 'newline', from: beforeLines.slice(0, 50) + '...', to: result.slice(0, 50) + '...', position: 0 });
  }

  // 去除行尾空白
  const beforeTrailing = result;
  result = result.replace(RE_TRAILING_SPACES, '');
  if (result !== beforeTrailing) {
    corrections.push({ type: 'whitespace', from: '行尾空白', to: '已清理', position: 0 });
  }

  // 合并连续空格（2+ → 1，但保留缩进的单空格）
  const beforeSpaces = result;
  result = result.replace(RE_MULTIPLE_SPACES, ' ');
  if (result !== beforeSpaces) {
    corrections.push({ type: 'whitespace', from: '连续空格', to: '单空格', position: 0 });
  }

  // 去除零宽字符和不可见控制字符（保留 \n \r \t）
  const beforeInvisible = result;
  result = result.replace(RE_INVISIBLE_CHARS, '');
  if (result !== beforeInvisible) {
    corrections.push({ type: 'whitespace', from: '零宽/控制字符', to: '已清理', position: 0 });
  }

  return result;
}

// ── 阶段 2: 常见 OCR 错误修正（上下文感知） ──────────────────

function fixCommonOcrErrors(text: string, corrections: OcrCorrection[]): string {
  // 策略：按"token"处理，每个 token 根据上下文判断修正方向
  // token = 连续的字母数字序列，或连续的中文字符，或其他符号

  const tokens = text.split(RE_TOKEN_SPLIT);
  const fixedTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';

    // 跳过空白和纯标点 token（原样保留）
    if (!token || RE_PUNCT_OR_SPACE.test(token)) {
      fixedTokens.push(token);
      continue;
    }

    // 判断 token 类型
    if (RE_DIGITS.test(token)) {
      // 纯数字——不需要修正（本来就是数字）
      fixedTokens.push(token);
    } else if (RE_LETTERS.test(token)) {
      // 纯英文单词——不做修正（避免误伤）
      // 只有当单词长度为 1 且是常见混淆字符时才考虑
      if (token.length === 1 && LETTER_CONTEXT_MAP[token]) {
        // 单字符的数字→字母修正太危险，跳过
      }
      fixedTokens.push(token);
    } else if (RE_ALNUM.test(token) && token.length >= 3) {
      // 字母数字混合（可能是单词中混了数字 OCR 错误，也可能是序列号）
      // 策略：如果"看起来像英文单词"（字母多、数字少且在常见混淆位置），则修正
      const letterCount = (token.match(RE_LETTER_MATCH) ?? []).length;
      const digitCount = token.length - letterCount;

      if (letterCount > digitCount && digitCount <= 2) {
        // 字母多数字少 → 可能是 OCR 把字母识别成数字
        const fixed = fixLetterContext(token);
        if (fixed !== token) {
          corrections.push({ type: 'common-ocr-error', from: token, to: fixed, position: i });
        }
        fixedTokens.push(fixed);
      } else if (digitCount > letterCount && letterCount <= 2) {
        // 数字多字母少 → 可能是 OCR 把数字识别成字母
        const fixed = fixDigitContext(token);
        if (fixed !== token) {
          corrections.push({ type: 'common-ocr-error', from: token, to: fixed, position: i });
        }
        fixedTokens.push(fixed);
      } else {
        // 差不多，不修正
        fixedTokens.push(token);
      }
    } else {
      // 包含中文或其他字符，不做字符级修正
      fixedTokens.push(token);
    }
  }

  return fixedTokens.join('');
}

/** 数字多字母少的场景：字母 → 数字修正 */
function fixDigitContext(token: string): string {
  let result = '';
  for (const ch of token) {
    if (/[a-zA-Z]/.test(ch)) {
      result += DIGIT_CONTEXT_MAP[ch] ?? ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/** 字母多数字少的场景：数字 → 字母修正 */
function fixLetterContext(token: string): string {
  let result = '';
  for (const ch of token) {
    if (/[0-9]/.test(ch)) {
      result += LETTER_CONTEXT_MAP[ch] ?? ch;
    } else {
      result += ch;
    }
  }
  return result;
}

// ── 阶段 3: 中英文混排空格规范化 ─────────────────────────────

function normalizeCnEnSpacing(text: string, corrections: OcrCorrection[]): string {
  // 中文与英文/数字之间加一个空格（符合中文排版规范）
  // 但已经有空格的不重复加

  let result = text;
  let changed = false;

  // 中文 + 英文/数字 → 中文 + 空格 + 英文/数字
  const before1 = result;
  result = result.replace(RE_CN_EN_BOUNDARY_1, '$1 $2');
  if (result !== before1) changed = true;

  // 英文/数字 + 中文 → 英文/数字 + 空格 + 中文
  const before2 = result;
  result = result.replace(RE_CN_EN_BOUNDARY_2, '$1 $2');
  if (result !== before2) changed = true;

  // 但不要在中文标点旁边加空格
  result = result.replace(RE_CN_PUNCT_SPACE_1, '$1$2');
  result = result.replace(RE_CN_PUNCT_SPACE_2, '$1$2');

  if (changed) {
    corrections.push({ type: 'whitespace', from: '中英文无空格', to: '已规范化', position: 0 });
  }

  return result;
}

// ── 阶段 4: 标点规范化 ──────────────────────────────────────

function normalizePunctuation(text: string, corrections: OcrCorrection[]): string {
  let result = text;
  let changed = false;

  // 中文上下文中的英文句号 → 中文句号（. 前后都是中文时）
  const before1 = result;
  result = result.replace(RE_CN_DOT, '$1。$2');
  if (result !== before1) changed = true;

  // 中文上下文中的英文逗号 → 中文逗号
  const before2 = result;
  result = result.replace(RE_CN_COMMA, '$1，$2');
  if (result !== before2) changed = true;

  // 中文上下文中的英文问号 → 中文问号
  const before3 = result;
  result = result.replace(RE_CN_QUESTION, '$1？$2');
  if (result !== before3) changed = true;

  // 中文上下文中的英文感叹号 → 中文感叹号
  const before4 = result;
  result = result.replace(RE_CN_EXCLAMATION, '$1！$2');
  if (result !== before4) changed = true;

  // 中文上下文中的英文冒号 → 中文冒号
  const before5 = result;
  result = result.replace(RE_CN_COLON, '$1：$2');
  if (result !== before5) changed = true;

  // 中文上下文中的英文分号 → 中文分号
  const before6 = result;
  result = result.replace(RE_CN_SEMICOLON, '$1；$2');
  if (result !== before6) changed = true;

  if (changed) {
    corrections.push({ type: 'punctuation', from: '英文标点', to: '中文标点', position: 0 });
  }

  return result;
}

// ── 阶段 5: 结构分析 ────────────────────────────────────────

function detectStructure(text: string): OcrStructure {
  // 段落（空行分隔）
  const paragraphs = text.split(RE_PARAGRAPH_SPLIT).map(p => p.trim()).filter(p => p.length > 0);

  // 一次遍历完成：表格检测、代码块检测、列表项收集、语言计数、行长度统计
  const tables: string[] = [];
  const codeBlocks: string[] = [];
  const listItems: string[] = [];
  let zhCount = 0;
  let enCount = 0;
  let printableCount = 0;
  let emptyLines = 0;
  const lineLengths: number[] = [];

  const lines = text.split('\n');
  let tableBuffer: string[] = [];
  let inTable = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lineLen = trimmed.length;

    if (lineLen === 0) {
      emptyLines++;
    } else {
      lineLengths.push(lineLen);
    }

    // 语言计数（一次遍历同时统计中英文和可打印字符）
    for (const ch of line) {
      if (ch >= '\u4e00' && ch <= '\u9fa5') {
        zhCount++;
        printableCount++;
      } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
        enCount++;
        printableCount++;
      } else if (
        (ch >= '\x20' && ch <= '\x7E') ||
        (ch >= '\u3000' && ch <= '\u303F') ||
        (ch >= '\uFF00' && ch <= '\uFFEF') ||
        ch === '\n' || ch === '\t'
      ) {
        printableCount++;
      }
    }

    // 表格检测
    const hasPipe = trimmed.includes('|');
    const hasSeparator = RE_TABLE_SEPARATOR.test(trimmed);

    if (hasPipe || hasSeparator) {
      tableBuffer.push(trimmed);
      inTable = true;
    } else {
      if (inTable) {
        if (tableBuffer.length >= 2) {
          tables.push(tableBuffer.join('\n'));
        }
        tableBuffer = [];
        inTable = false;
      }
    }

    // 代码块检测
    if (RE_CODE_INDENT_SPACE.test(line) || RE_CODE_INDENT_TAB.test(line)) {
      codeBuffer.push(line);
    } else {
      if (codeBuffer.length >= 3) {
        codeBlocks.push(codeBuffer.join('\n'));
      }
      codeBuffer = [];
    }

    // 列表项检测
    if (RE_LIST_MARKER_1.test(line) || RE_LIST_MARKER_2.test(line)) {
      listItems.push(line);
    }
  }

  // 处理末尾的表格和代码块
  if (inTable && tableBuffer.length >= 2) {
    tables.push(tableBuffer.join('\n'));
  }
  if (codeBuffer.length >= 3) {
    codeBlocks.push(codeBuffer.join('\n'));
  }

  // 语言检测（粗略：统计中文字符占比）
  const totalAlpha = zhCount + enCount;
  let primaryLanguage: 'zh' | 'en' | 'mixed';
  if (totalAlpha === 0) {
    primaryLanguage = 'mixed';
  } else if (zhCount / totalAlpha > 0.7) {
    primaryLanguage = 'zh';
  } else if (enCount / totalAlpha > 0.7) {
    primaryLanguage = 'en';
  } else {
    primaryLanguage = 'mixed';
  }

  // 质量评分（使用已统计的数据，避免重复遍历）
  const qualityScore = calculateQualityScoreFast(
    text.length,
    printableCount,
    lines.length,
    emptyLines,
    lineLengths,
    primaryLanguage,
  );

  return {
    paragraphs,
    tables,
    codeBlocks,
    listItems,
    primaryLanguage,
    qualityScore,
  };
}

/**
 * OCR 文本质量评分（0-100）—— 快速版，使用 detectStructure 中已统计的数据
 *
 * 避免重复遍历文本，时间复杂度从 O(n) 降为 O(1)（基于预计算数据）
 */
function calculateQualityScoreFast(
  totalLen: number,
  printableCount: number,
  totalLines: number,
  emptyLines: number,
  lineLengths: number[],
  _lang: 'zh' | 'en' | 'mixed',
): number {
  let score = 70; // 基础分

  // 文本太短，质量不可靠
  if (totalLen < 20) {
    score -= 20;
  }

  // 可打印字符比例
  const printableRatio = totalLen > 0 ? printableCount / totalLen : 0;
  if (printableRatio < 0.8) {
    score -= Math.floor((0.8 - printableRatio) * 50);
  }

  // 空行比例
  const emptyRatio = totalLines > 0 ? emptyLines / totalLines : 0;
  if (emptyRatio > 0.5) {
    score -= 15; // 空行太多
  }

  // 行长度方差（太短的行太多可能是 OCR 断行错误）
  if (lineLengths.length > 0) {
    const avgLen = lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length;
    const shortLines = lineLengths.filter(l => l < avgLen * 0.3).length;
    if (shortLines / lineLengths.length > 0.4) {
      score -= 10; // 很多短行，可能是 OCR 识别不佳
    }
  }

  // 限定在 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * OCR 文本质量评分（0-100）—— 完整版（保留供外部直接调用）
 *
 * 评分维度：
 *   - 字符多样性（越多越好，说明识别正常）
 *   - 乱码/不可打印字符比例（越少越好）
 *   - 行长度均匀度（越均匀越好）
 *   - 空行比例（适中最好）
 *
 * @deprecated 请使用 calculateQualityScoreFast，避免重复遍历
 */
function calculateQualityScore(text: string, _lang: 'zh' | 'en' | 'mixed'): number {
  let score = 70; // 基础分

  // 字符总数
  const total = text.length;
  if (total < 20) {
    score -= 20; // 文本太短，质量不可靠
  }

  // 可打印字符比例
  const printable = (text.match(RE_PRINTABLE_CHAR) ?? []).length;
  const printableRatio = total > 0 ? printable / total : 0;
  if (printableRatio < 0.8) {
    score -= Math.floor((0.8 - printableRatio) * 50);
  }

  // 空行比例
  const lines = text.split('\n');
  const emptyLines = lines.filter(l => l.trim().length === 0).length;
  const emptyRatio = lines.length > 0 ? emptyLines / lines.length : 0;
  if (emptyRatio > 0.5) {
    score -= 15; // 空行太多
  }

  // 行长度方差（太短的行太多可能是 OCR 断行错误）
  const lineLengths = lines.filter(l => l.trim().length > 0).map(l => l.length);
  if (lineLengths.length > 0) {
    const avgLen = lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length;
    const shortLines = lineLengths.filter(l => l < avgLen * 0.3).length;
    if (shortLines / lineLengths.length > 0.4) {
      score -= 10; // 很多短行，可能是 OCR 识别不佳
    }
  }

  // 限定在 0-100
  return Math.max(0, Math.min(100, score));
}

// ── 工具函数 ─────────────────────────────────────────────────

/**
 * 格式化 OCR 后处理结果（用于命令行输出 / 调试）
 */
export function formatOcrResult(result: OcrProcessedResult): string {
  const { structure, corrections } = result;
  const lines: string[] = [];

  lines.push(`OCR 文本质量评分：${structure.qualityScore}/100`);
  lines.push(`主要语言：${structure.primaryLanguage === 'zh' ? '中文' : structure.primaryLanguage === 'en' ? '英文' : '中英混合'}`);
  lines.push(`段落数：${structure.paragraphs.length}`);
  if (structure.tables.length > 0) {
    lines.push(`检测到 ${structure.tables.length} 个表格`);
  }
  if (structure.codeBlocks.length > 0) {
    lines.push(`检测到 ${structure.codeBlocks.length} 个代码块`);
  }
  if (corrections.length > 0) {
    const typeCounts: Record<string, number> = {};
    for (const c of corrections) {
      typeCounts[c.type] = (typeCounts[c.type] ?? 0) + 1;
    }
    const corrDesc = Object.entries(typeCounts)
      .map(([type, count]) => `${type}: ${count}`)
      .join('、');
    lines.push(`修正记录：${corrections.length} 处（${corrDesc}）`);
  }
  lines.push('');
  lines.push('--- 清洗后文本 ---');
  lines.push(result.cleaned);

  return lines.join('\n');
}
