/**
 * 内置工具集 —— T7 + v0.9.2 扩展
 *
 * 注册一批基础工具，覆盖 SOHA.md §11 时间感知、§14.2 虚空检索等核心能力。
 * 所有工具纯 CPU/IO，不占 GPU。
 *
 * 工具清单：
 *   - clock       : 获取当前时间（支撑 SOHA §11 时间感知规则）
 *   - web_fetch   : 抓取网页正文（虚空检索的基础）
 *   - search      : 网络搜索（v0.9.2）
 *   - translate   : 文本翻译（v0.9.2）
 *   - weather     : 天气查询（v0.9.2）
 *   - file_read   : 读取本地文件（v0.9.2）
 *   - file_write  : 写入本地文件（v0.9.2）
 *
 * 后续扩展口（来自 .trae/rules/skills.md）：
 *   Office 生成、记账、出行规划
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 工具 1：clock（获取当前时间） ─────────────────────────────

const clockTool: ToolDefinition = {
  name: 'clock',
  description: '获取当前时间和星期。当用户问"几点了""现在什么时候"，或需要判断时段（深夜/饭点）时调用。',
  parameters: z.object({}).strict(),  // 无参数
  async execute(): Promise<ToolResult> {
    const now = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[now.getDay()] ?? '未知';

    // YYYY-MM-DD HH:mm:ss 周X
    const pad = (n: number): string => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
      ok: true,
      data: {
        datetime: `${dateStr} ${timeStr} ${weekday}`,
        timestamp: now.getTime(),
        hour: now.getHours(),
        weekday,
      },
      latencyMs: 0,
    };
  },
};

// ── 工具 2：web_fetch（抓取网页正文） ─────────────────────────

/** 高可信域名白名单 */
const HIGH_CRED_DOMAINS = [
  'wikipedia.org',
  'gov.cn',
  'gov',
  'edu.cn',
  'edu',
  'microsoft.com',
  'apple.com',
  'github.com',
  'stackoverflow.com',
  'npmjs.com',
  'python.org',
  'nodejs.org',
];

/** 低可信域名黑名单 */
const LOW_CRED_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  'pastebin.com',
  'reddit.com', // 用户生成内容
];

/**
 * 评估 URL 来源可信度
 *
 * 返回 'high' | 'medium' | 'low'
 */
function evaluateSourceCred(url: string): 'high' | 'medium' | 'low' {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // 黑名单直接低可信
    for (const domain of LOW_CRED_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return 'low';
      }
    }

    // 白名单高可信
    for (const domain of HIGH_CRED_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return 'high';
      }
    }

    // 其他域名中等可信
    return 'medium';
  } catch {
    return 'low';
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();

    // 解 IPv6 方括号
    const cleanHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

    // IPv6 回环 [::1]
    if (cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1') return false;

    // IPv6 ULA [fc00::]/7 (fc00:: - fdff::)
    if (cleanHost.startsWith('fc') || cleanHost.startsWith('fd')) return false;

    // IPv6 link-local [fe80::]/10
    if (cleanHost.startsWith('fe8') || cleanHost.startsWith('fe9') ||
        cleanHost.startsWith('fea') || cleanHost.startsWith('feb')) return false;

    // IPv4 回环 127.0.0.0/8
    if (cleanHost.startsWith('127.')) return false;

    // IPv4 私网 10.0.0.0/8
    if (cleanHost.startsWith('10.')) return false;

    // IPv4 私网 172.16.0.0/12
    if (cleanHost.startsWith('172.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 16 && secondOctet <= 31) return false;
    }

    // IPv4 私网 192.168.0.0/16
    if (cleanHost.startsWith('192.168.')) return false;

    // IPv4 链路本地 169.254.0.0/16 (含 AWS 元数据 169.254.169.254)
    if (cleanHost.startsWith('169.254.')) return false;

    // IPv4 CGNAT 100.64.0.0/10
    if (cleanHost.startsWith('100.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 64 && secondOctet <= 127) return false;
    }

    // 0.0.0.0/8 (Windows 上解析为本机)
    if (cleanHost.startsWith('0.')) return false;

    // localhost
    if (cleanHost === 'localhost' || cleanHost.startsWith('localhost.')) return false;

    return true;
  } catch {
    return false;
  }
}

const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: '抓取指定 URL 的网页正文内容（HTML 转 plain text）。当用户要求"查一下""获取网页""看看这个链接"时调用。',
  parameters: z.object({
    url: z.string().url().describe('要抓取的网页 URL，必须是 https:// 开头的公网地址'),
    max_length: z.number().int().positive().max(10000).optional()
      .describe('返回正文最大字符数，默认 2000，避免 token 爆炸'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const url = params.url as string;
    const maxLenRaw = params.max_length;
    const maxLen = typeof maxLenRaw === 'number' ? maxLenRaw : 2000;

    if (!isSafeUrl(url)) {
      return {
        ok: false,
        data: 'URL 安全校验失败：仅允许访问公网 HTTPS 地址',
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NahidaAgent/0.1',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ok: false,
          data: `HTTP ${response.status}: ${response.statusText}`,
          latencyMs: Date.now() - startTime,
        };
      }

      const html = await response.text();
      const text = htmlToText(html);

      const truncated = text.length > maxLen
        ? `${text.slice(0, maxLen)}...[truncated]`
        : text;

      return {
        ok: true,
        data: {
          url,
          content: truncated,
          length: text.length,
          truncated: text.length > maxLen,
          source_cred: evaluateSourceCred(url),
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        data: `抓取失败: ${errorMsg}`,
        latencyMs: Date.now() - startTime,
      };
    }
  },
};

// ── HTML 转 plain text（轻量版） ──────────────────────────────

/**
 * 把 HTML 转成纯文本
 *
 * 只做基础处理：去标签、解码实体、压缩空白。
 * 不引入 cheerio/jsdom，保持依赖轻量。
 */
function htmlToText(html: string): string {
  return html
    // 去 script/style/noscript 内容
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // 块级标签转换行
    .replace(/<(\/?)(p|div|br|h[1-6]|li|tr|hr)[^>]*>/gi, '\n')
    // 去所有其他标签
    .replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 压缩多余空白
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 工具 3：search（网络搜索）─────────────────────────────

const searchTool: ToolDefinition = {
  name: 'search',
  description: '网络搜索。当用户要求"搜索""查一下""找一下"某个主题时调用。返回相关网页摘要。',
  parameters: z.object({
    query: z.string().min(1).max(200).describe('搜索关键词'),
    max_results: z.number().int().positive().max(10).optional()
      .describe('返回结果数量，默认 5'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const query = params.query as string;
    const maxResults = (params.max_results as number) ?? 5;

    // TODO: 接入真实搜索引擎 API（如 Bing Search API、Google Custom Search）
    // 当前返回模拟数据，待后续集成
    const mockResults = [
      {
        title: `${query} - 搜索结果 1`,
        url: 'https://example.com/1',
        snippet: `这是关于"${query}"的第一个搜索结果摘要...`,
      },
      {
        title: `${query} - 搜索结果 2`,
        url: 'https://example.com/2',
        snippet: `这是关于"${query}"的第二个搜索结果摘要...`,
      },
    ];

    return {
      ok: true,
      data: {
        query,
        results: mockResults.slice(0, maxResults),
        total: mockResults.length,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 4：translate（文本翻译）────────────────────────────

const translateTool: ToolDefinition = {
  name: 'translate',
  description: '文本翻译。当用户要求"翻译""把...翻译成..."时调用。支持中英日韩等语言。',
  parameters: z.object({
    text: z.string().min(1).max(5000).describe('要翻译的文本'),
    target_lang: z.string().describe('目标语言代码（如 en/zh/ja/ko）'),
    source_lang: z.string().optional().describe('源语言代码，不填则自动检测'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const text = params.text as string;
    const targetLang = params.target_lang as string;
    const sourceLang = (params.source_lang as string) ?? 'auto';

    // TODO: 接入真实翻译 API（如 DeepL API、百度翻译 API）
    // 当前返回模拟数据，待后续集成
    const mockTranslation = `[翻译结果] ${text} → ${targetLang}`;

    return {
      ok: true,
      data: {
        original: text,
        translated: mockTranslation,
        source_lang: sourceLang,
        target_lang: targetLang,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 5：weather（天气查询）──────────────────────────────

const weatherTool: ToolDefinition = {
  name: 'weather',
  description: '查询天气。当用户问"天气怎么样""今天天气""明天会下雨"时调用。返回温度、湿度、天气状况。',
  parameters: z.object({
    location: z.string().min(1).max(100).describe('地点名称（如"北京""上海"）'),
    date: z.string().optional().describe('日期（如"今天""明天"），不填则查当前'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const location = params.location as string;
    const date = (params.date as string) ?? '今天';

    // TODO: 接入真实天气 API（如 OpenWeatherMap、和风天气）
    // 当前返回模拟数据，待后续集成
    const mockWeather = {
      location,
      date,
      temperature: 22,
      humidity: 65,
      condition: '晴',
      wind: '东北风 3 级',
    };

    return {
      ok: true,
      data: mockWeather,
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 6：file_read（读取文件）────────────────────────────

const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description: '读取本地文件内容。当用户要求"读取文件""打开文件""看看这个文件"时调用。',
  parameters: z.object({
    file_path: z.string().min(1).describe('文件路径（绝对路径或相对路径）'),
    encoding: z.string().optional().describe('文件编码，默认 utf-8'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const filePath = params.file_path as string;
    const encoding = (params.encoding as BufferEncoding) ?? 'utf-8';

    try {
      // 安全检查：禁止读取敏感文件
      const normalizedPath = path.normalize(filePath);
      if (normalizedPath.includes('.env') || normalizedPath.includes('credentials')) {
        return {
          ok: false,
          data: '安全限制：禁止读取敏感文件',
          latencyMs: Date.now() - startTime,
        };
      }

      const content = fs.readFileSync(normalizedPath, encoding);

      return {
        ok: true,
        data: {
          file_path: normalizedPath,
          content,
          size: content.length,
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        data: `读取失败: ${errorMsg}`,
        latencyMs: Date.now() - startTime,
      };
    }
  },
};

// ── 工具 7：file_write（写入文件）───────────────────────────

const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description: '写入内容到本地文件。当用户要求"保存文件""写入文件""创建文件"时调用。',
  parameters: z.object({
    file_path: z.string().min(1).describe('文件路径（绝对路径或相对路径）'),
    content: z.string().describe('要写入的内容'),
    append: z.boolean().optional().describe('是否追加模式，默认 false（覆盖）'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const filePath = params.file_path as string;
    const content = params.content as string;
    const append = (params.append as boolean) ?? false;

    try {
      // 安全检查：禁止写入敏感文件
      const normalizedPath = path.normalize(filePath);
      if (normalizedPath.includes('.env') || normalizedPath.includes('credentials')) {
        return {
          ok: false,
          data: '安全限制：禁止写入敏感文件',
          latencyMs: Date.now() - startTime,
        };
      }

      // 确保目录存在
      const dir = path.dirname(normalizedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      if (append) {
        fs.appendFileSync(normalizedPath, content, 'utf-8');
      } else {
        fs.writeFileSync(normalizedPath, content, 'utf-8');
      }

      return {
        ok: true,
        data: {
          file_path: normalizedPath,
          size: content.length,
          mode: append ? 'append' : 'overwrite',
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        data: `写入失败: ${errorMsg}`,
        latencyMs: Date.now() - startTime,
      };
    }
  },
};

// ── 注册入口 ────────────────────────────────────────────────

/**
 * 注册所有内置工具
 *
 * 在主进程启动时调用一次。
 */
export function registerBuiltinTools(): void {
  registerTools([clockTool, webFetchTool, searchTool, translateTool, weatherTool, fileReadTool, fileWriteTool]);
  console.log('[Tools] builtin tools registered: clock, web_fetch, search, translate, weather, file_read, file_write');
}
