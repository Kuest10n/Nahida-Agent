/**
 * OCR 多语言自动检测模块（v2.18.0）
 *
 * 通过分析文本中的 Unicode 字符范围，自动检测主要语言，
 * 返回对应的 Tesseract 语言代码数组。
 *
 * 设计原则：
 *   - 无外部依赖（避免包体积膨胀）
 *   - 基于 Unicode 字符范围检测（简单可靠）
 *   - 返回语言代码数组（Tesseract 支持多语言组合）
 *   - 优先选择检测到的语言，fallback 到 'chi_sim+eng'
 *   - 支持中文、英文、日文、韩文、数字符号
 *
 * 为什么不用外部语言检测库：
 *   - langdetect / franc 等库体积较大（几十 KB 到几百 KB）
 *   - OCR 场景下，先识别出文本再检测语言有延迟
 *   - Unicode 范围检测对 OCR 场景足够准确（中文/日文/韩文字符差异明显）
 *   - 零依赖意味着不需要等待额外包安装
 *
 * 检测逻辑：
 *   1. 统计文本中各语言字符的比例
 *   2. 按比例排序，选择占比最高的语言
 *   3. 如果检测到中文，始终保留英文（混排场景）
 *   4. 返回 Tesseract 语言代码数组
 */

// ── 语言定义 ──────────────────────────────────────────────────

/** 语言定义 */
interface LanguageDef {
  /** Tesseract 语言代码 */
  code: string;
  /** 语言名称（中文） */
  name: string;
  /** Unicode 字符范围数组 */
  ranges: Array<[number, number]>;
  /** 是否始终与其他语言组合（如中文混排英文） */
  alwaysCombine?: boolean;
}

/** 支持的语言列表 */
const LANGUAGES: LanguageDef[] = [
  {
    code: 'chi_sim',
    name: '中文简体',
    ranges: [
      [0x4E00, 0x9FFF],    // CJK 统一表意文字
      [0x3400, 0x4DBF],    // CJK 扩展 A
      [0x20000, 0x2A6DF],  // CJK 扩展 B
      [0xFF00, 0xFFEF],    // 全角符号
      [0x3000, 0x303F],    // CJK 标点
    ],
    alwaysCombine: true,
  },
  {
    code: 'chi_tra',
    name: '中文繁体',
    ranges: [
      [0x4E00, 0x9FFF],    // CJK 统一表意文字（与简体共享）
      [0x3400, 0x4DBF],    // CJK 扩展 A
      [0x20000, 0x2A6DF],  // CJK 扩展 B
      [0x3100, 0x312F],    // 注音符号
      [0x3000, 0x303F],    // CJK 标点
    ],
    alwaysCombine: true,
  },
  {
    code: 'jpn',
    name: '日文',
    ranges: [
      [0x3040, 0x30FF],    // 平假名 + 片假名
      [0x31F0, 0x31FF],    // 片假名扩展
      [0xFF66, 0xFF9F],    // 半角片假名
      [0x4E00, 0x9FFF],    // CJK 统一表意文字（日文汉字）
    ],
    alwaysCombine: true,
  },
  {
    code: 'kor',
    name: '韩文',
    ranges: [
      [0xAC00, 0xD7AF],    // 韩文音节
      [0x1100, 0x11FF],    // 韩文辅音
      [0x3130, 0x318F],    // 韩文兼容音节
      [0x3200, 0x32FF],    // 韩文半角符号
    ],
    alwaysCombine: true,
  },
  {
    code: 'eng',
    name: '英文',
    ranges: [
      [0x0041, 0x005A],    // 大写字母 A-Z
      [0x0061, 0x007A],    // 小写字母 a-z
      [0x00C0, 0x00FF],    // 拉丁扩展 A（重音字母）
      [0x0100, 0x017F],    // 拉丁扩展 B
    ],
  },
];

/** 默认语言（fallback） */
const DEFAULT_LANGUAGE = 'chi_sim';
/** 默认组合语言（中文 + 英文） */
const DEFAULT_COMBINATION = ['chi_sim', 'eng'];

// ── 类型 ──────────────────────────────────────────────────────

/** 语言检测结果 */
export interface LanguageDetection {
  /** 检测到的语言代码列表（按置信度排序） */
  languages: string[];
  /** 主语言 */
  primary: string;
  /** 各语言置信度（0-100） */
  confidence: Record<string, number>;
  /** 是否为混合语言 */
  isMixed: boolean;
}

// ── 核心检测逻辑 ──────────────────────────────────────────────

/**
 * 判断字符是否属于指定语言的 Unicode 范围
 */
function isInRanges(charCode: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => charCode >= start && charCode <= end);
}

/**
 * 统计文本中各语言字符的比例
 */
function countLanguageChars(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let totalChars = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    let matched = false;

    for (const lang of LANGUAGES) {
      if (isInRanges(code, lang.ranges)) {
        counts[lang.code] = (counts[lang.code] || 0) + 1;
        matched = true;
        break;
      }
    }

    if (matched) {
      totalChars++;
    }
  }

  // 转换为百分比
  const percentages: Record<string, number> = {};
  for (const [code, count] of Object.entries(counts)) {
    percentages[code] = Math.round((count / totalChars) * 100);
  }

  return percentages;
}

/**
 * 判断是否为繁体中文（通过特定繁体字特征）
 *
 * 中文简体和繁体共享大部分 Unicode 范围，需要额外判断。
 * 检测常用繁体字特征字符来区分。
 */
function isTraditionalChinese(text: string): boolean {
  const traditionalChars = [
    '為', '為', '愛', '愛', '學', '學', '國', '國', 
    '體', '體', '裡', '裡', '後', '後', '面', '麵',
    '發', '發', '頭', '頭', '聲', '聲', '車', '車',
    '馬', '馬', '鳥', '鳥', '魚', '魚', '飛', '飛',
    '開', '開', '關', '關', '門', '門', '間', '間',
    '時', '時', '過', '過', '經', '經', '畫', '畫',
    '書', '書', '寫', '寫', '看', '看', '聽', '聽',
    '說', '說', '話', '話', '讀', '讀', '寫', '寫',
  ];

  const simplifiedChars = [
    '为', '为', '爱', '爱', '学', '学', '国', '国',
    '体', '体', '里', '里', '后', '后', '面', '面',
    '发', '发', '头', '头', '声', '声', '车', '车',
    '马', '马', '鸟', '鸟', '鱼', '鱼', '飞', '飞',
    '开', '开', '关', '关', '门', '门', '间', '间',
    '时', '时', '过', '过', '经', '经', '画', '画',
    '书', '书', '写', '写', '看', '看', '听', '听',
    '说', '说', '话', '话', '读', '读', '写', '写',
  ];

  let traditionalCount = 0;
  let simplifiedCount = 0;

  for (const char of text) {
    if (traditionalChars.includes(char)) {
      traditionalCount++;
    } else if (simplifiedChars.includes(char)) {
      simplifiedCount++;
    }
  }

  return traditionalCount > simplifiedCount && traditionalCount > 0;
}

/**
 * 从文本检测语言
 *
 * @param text 待检测的文本
 * @returns 语言检测结果
 */
export function detectLanguage(text: string): LanguageDetection {
  if (!text || text.trim().length === 0) {
    return {
      languages: [DEFAULT_LANGUAGE],
      primary: DEFAULT_LANGUAGE,
      confidence: { [DEFAULT_LANGUAGE]: 100 },
      isMixed: false,
    };
  }

  const percentages = countLanguageChars(text);
  
  // 按百分比排序
  const sorted = Object.entries(percentages)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return {
      languages: [DEFAULT_LANGUAGE],
      primary: DEFAULT_LANGUAGE,
      confidence: { [DEFAULT_LANGUAGE]: 100 },
      isMixed: false,
    };
  }

  const first = sorted[0];
  if (!first) {
    return {
      languages: [DEFAULT_LANGUAGE],
      primary: DEFAULT_LANGUAGE,
      confidence: { [DEFAULT_LANGUAGE]: 100 },
      isMixed: false,
    };
  }

  const [primaryCode, primaryPercent] = first;
  let languages: string[] = [primaryCode];
  let isMixed = false;

  // 判断中文简体/繁体
  if (primaryCode === 'chi_sim' && isTraditionalChinese(text)) {
    languages[0] = 'chi_tra';
  }

  // 添加组合语言（如中文混排英文）
  for (const lang of LANGUAGES) {
    if (lang.alwaysCombine && lang.code !== languages[0]) {
      const percent = percentages[lang.code] || 0;
      // 如果该语言占比超过 5%，且不是主语言，则添加
      if (percent > 5 && !languages.includes(lang.code)) {
        languages.push(lang.code);
        isMixed = true;
      }
    }
  }

  // 确保至少有一个语言
  if (languages.length === 0) {
    languages = DEFAULT_COMBINATION;
  }

  return {
    languages,
    primary: languages[0] ?? DEFAULT_LANGUAGE,
    confidence: percentages,
    isMixed,
  };
}

/**
 * 获取 Tesseract 语言参数字符串（多语言用 + 连接）
 *
 * @param text 待检测的文本
 * @returns Tesseract 语言参数（如 'chi_sim+eng'）
 */
export function getTesseractLanguage(text: string): string {
  const detection = detectLanguage(text);
  return detection.languages.join('+');
}

/**
 * 获取语言名称
 *
 * @param code Tesseract 语言代码
 * @returns 语言名称
 */
export function getLanguageName(code: string): string {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang?.name ?? code;
}

/**
 * 预检测图片语言（基于文件名或用户提示）
 *
 * 某些场景下，OCR 前就能知道语言（如文件名含 zh/jp/ko），
 * 可以提前指定语言，避免先识别再检测的延迟。
 *
 * @param hint 语言提示（文件名、用户输入等）
 * @returns 语言代码数组，空数组表示无法确定
 */
export function hintToLanguage(hint: string): string[] {
  if (!hint) return [];

  const lower = hint.toLowerCase();
  const result: string[] = [];

  if (lower.includes('zh') || lower.includes('中文') || lower.includes('chinese')) {
    if (lower.includes('tra') || lower.includes('繁')) {
      result.push('chi_tra');
    } else {
      result.push('chi_sim');
    }
  }
  if (lower.includes('jp') || lower.includes('日本') || lower.includes('japan')) {
    result.push('jpn');
  }
  if (lower.includes('ko') || lower.includes('韩国') || lower.includes('korea')) {
    result.push('kor');
  }
  if (lower.includes('en') || lower.includes('英文') || lower.includes('english')) {
    result.push('eng');
  }

  return result;
}
