/**
 * 搜索结果可信度评估 —— v1.2
 *
 * 职责：
 *   给 search / web_fetch 返回的结果打上可信度标签（high / medium / low），
 *   让纳西妲在引用网络信息时表达不确定性（元认知）。
 *
 * 评估维度：
 *   1. 域名权威度（gov/edu/github/stackoverflow/npmjs 等）
 *   2. 协议安全度（https vs http）
 *   3. URL 短链/跳转风险
 *   4. 内容类型（文档 vs 论坛 vs 视频）
 *   5. 域名年龄（可选，通过 whois 数据增强）
 *
 * 输出：
 *   - score: 0-100 数字分
 *   - level: 'high' | 'medium' | 'low'
 *   - reasons: 评分理由数组
 */

/** 可信度等级 */
export type CredibilityLevel = 'high' | 'medium' | 'low';

/** 可信度评估结果 */
export interface CredibilityResult {
  score: number;
  level: CredibilityLevel;
  reasons: string[];
}

/** 高可信域名后缀 / 根域名 */
const HIGH_TRUST_TLDS = ['.gov.cn', '.gov', '.edu.cn', '.edu', '.ac.cn', '.ac.uk', '.ac.jp'];
const HIGH_TRUST_HOSTS = [
  'wikipedia.org',
  'github.com',
  'stackoverflow.com',
  'npmjs.com',
  'python.org',
  'nodejs.org',
  'docs.python.org',
  'developer.mozilla.org',
  'learn.microsoft.com',
  'apple.com',
  'openai.com',
  'arxiv.org',
  'scholar.google.com',
  'pubmed.ncbi.nlm.nih.gov',
];

/** 低可信域名（用户生成内容 / 短链 / 匿名论坛） */
const LOW_TRUST_HOSTS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'pastebin.com',
  'termbin.com',
  '4chan.org',
  'reddit.com', // 用户生成内容，标记为低可信
  'zhihu.com',  // 用户生成内容，标记为中等偏低
];

/** 低可信文件扩展名 */
const LOW_TRUST_EXTENSIONS = ['.exe', '.zip', '.rar', '.apk', '.torrent'];

/**
 * 评估 URL 可信度
 *
 * @param url 网页 URL
 * @returns CredibilityResult
 */
export function evaluateUrlCredibility(url: string): CredibilityResult {
  const reasons: string[] = [];
  let score = 50; // 起始分：中等

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { score: 0, level: 'low', reasons: ['URL 格式非法'] };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  // 1. 协议
  if (parsed.protocol === 'https:') {
    score += 10;
    reasons.push('HTTPS 加密传输');
  } else {
    score -= 20;
    reasons.push('HTTP 明文传输，存在篡改风险');
  }

  // 2. 高可信 TLD
  for (const tld of HIGH_TRUST_TLDS) {
    if (hostname.endsWith(tld)) {
      score += 25;
      reasons.push(`权威域名后缀 ${tld}`);
      break;
    }
  }

  // 3. 高可信 Host
  for (const host of HIGH_TRUST_HOSTS) {
    if (hostname === host || hostname.endsWith(`.${host}`)) {
      score += 20;
      reasons.push(`可信来源 ${host}`);
      break;
    }
  }

  // 4. 低可信 Host
  for (const host of LOW_TRUST_HOSTS) {
    if (hostname === host || hostname.endsWith(`.${host}`)) {
      score -= 25;
      reasons.push(`用户生成内容或短链平台 ${host}`);
      break;
    }
  }

  // 5. 可疑文件扩展名
  for (const ext of LOW_TRUST_EXTENSIONS) {
    if (pathname.endsWith(ext)) {
      score -= 30;
      reasons.push(`可执行/压缩文件 ${ext}，需谨慎`);
      break;
    }
  }

  // 6. 路径深度惩罚（过深的路径可能是不稳定页面）
  const depth = pathname.split('/').filter(Boolean).length;
  if (depth > 6) {
    score -= 5;
    reasons.push('URL 路径过深，可能是临时页面');
  }

  // 分数裁剪到 0-100
  score = Math.max(0, Math.min(100, score));

  let level: CredibilityLevel;
  if (score >= 75) {
    level = 'high';
  } else if (score >= 45) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { score, level, reasons };
}

/**
 * 评估搜索结果单项的可信度
 *
 * @param result 搜索结果对象 { title, url, snippet }
 * @returns 带可信度字段的结果
 */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface ScoredSearchResult extends SearchResultItem {
  credibility: CredibilityResult;
}

export function scoreSearchResult(result: SearchResultItem): ScoredSearchResult {
  return {
    ...result,
    credibility: evaluateUrlCredibility(result.url),
  };
}

/**
 * 给搜索结果列表批量评分，并按可信度降序排序
 */
export function scoreSearchResults(results: SearchResultItem[]): ScoredSearchResult[] {
  return results
    .map(scoreSearchResult)
    .sort((a, b) => b.credibility.score - a.credibility.score);
}

/**
 * 获取可信度摘要文本（给模型参考）
 */
export function credibilitySummary(result: ScoredSearchResult): string {
  const r = result.credibility;
  const levelText = r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低';
  return `[可信度:${levelText} ${r.score}/100] ${r.reasons.slice(0, 2).join('；')}`;
}
