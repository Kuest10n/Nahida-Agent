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
import { emailSendSchema, emailReceiveSchema, emailSend, emailReceive } from '../mcp/servers/email-mcp-server';

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 安全配置：文件工具的路径白名单 ────────────────────────────
//
// 只允许访问项目根目录及其子目录，防止路径遍历攻击（../../etc/passwd 之类）。
// 用 path.resolve() 解析后检查是否以白名单目录开头。

/** 允许访问的目录列表（绝对路径） */
function getAllowedDirs(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd),           // 项目根目录
    path.resolve(cwd, 'memory'),  // 记忆目录
    path.resolve(cwd, 'data'),    // 数据目录
    path.resolve(cwd, 'feedback'),// 反馈目录
  ];
}

/**
 * 安全解析文件路径，检查是否在白名单内
 *
 * @returns 解析后的绝对路径，或 null（表示不在白名单内）
 */
function safeResolvePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const allowedDirs = getAllowedDirs();

  const isAllowed = allowedDirs.some(dir => {
    // 必须是 dir 本身或 dir 的子目录
    return resolved === dir || resolved.startsWith(dir + path.sep);
  });

  return isAllowed ? resolved : null;
}

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

      const { evaluateUrlCredibility } = await import('./search-credibility.js');
      const cred = evaluateUrlCredibility(url);

      return {
        ok: true,
        data: {
          url,
          content: truncated,
          length: text.length,
          truncated: text.length > maxLen,
          source_cred: cred.level,
          credibility_score: cred.score,
          credibility_reasons: cred.reasons,
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
const RE_SCRIPT_STYLE = /<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi;
const RE_BLOCK_TAGS = /<(\/?)(p|div|br|h[1-6]|li|tr|hr)[^>]*>/gi;
const RE_ANY_TAG = /<[^>]+>/g;
const RE_MULTI_SPACE = /[ \t]+/g;
const RE_MULTI_NEWLINE = /\n{3,}/g;

function htmlToText(html: string): string {
  return html
    .replace(RE_SCRIPT_STYLE, '')
    .replace(RE_BLOCK_TAGS, '\n')
    .replace(RE_ANY_TAG, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(RE_MULTI_SPACE, ' ')
    .replace(RE_MULTI_NEWLINE, '\n\n')
    .trim();
}

// ── 工具 3：search（网络搜索）─────────────────────────────

const searchTool: ToolDefinition = {
  name: 'search',
  description: '网络搜索。当用户要求"搜索""查一下""找一下"某个主题时调用。返回带可信度评分的网页摘要。',
  parameters: z.object({
    query: z.string().min(1).max(200).describe('搜索关键词'),
    max_results: z.number().int().positive().max(10).optional()
      .describe('返回结果数量，默认 5'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const query = params.query as string;
    const maxResults = (params.max_results as number) ?? 5;

    // TODO: 接入真实搜索引擎 API（如 Bing Search API、Google Custom Search、SearXNG）
    // v1.2 先提供带可信度评分的框架数据，真实 API 在后续版本替换
    const mockResults = [
      {
        title: `${query} - 搜索结果 1`,
        url: 'https://github.com/example/repo',
        snippet: `这是关于"${query}"的 GitHub 技术仓库摘要。`,
      },
      {
        title: `${query} - 搜索结果 2`,
        url: 'https://zh.wikipedia.org/wiki/Example',
        snippet: `这是关于"${query}"的维基百科条目摘要。`,
      },
      {
        title: `${query} - 搜索结果 3`,
        url: 'https://bit.ly/xyz123',
        snippet: `这是关于"${query}"的短链分享。`,
      },
    ];

    const { scoreSearchResults, credibilitySummary } = await import('./search-credibility.js');
    const scored = scoreSearchResults(mockResults).slice(0, maxResults);

    return {
      ok: true,
      data: {
        query,
        results: scored.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          credibility: r.credibility,
          summary: credibilitySummary(r as import('./search-credibility.js').ScoredSearchResult),
        })),
        total: scored.length,
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
      // 安全检查：路径白名单（防路径遍历）
      const safePath = safeResolvePath(filePath);
      if (!safePath) {
        return {
          ok: false,
          data: '安全限制：只能访问项目目录内的文件',
          latencyMs: Date.now() - startTime,
        };
      }

      // 安全检查：禁止读取敏感文件
      if (safePath.includes('.env') || safePath.includes('credentials') || safePath.includes('.key')) {
        return {
          ok: false,
          data: '安全限制：禁止读取敏感文件',
          latencyMs: Date.now() - startTime,
        };
      }

      const content = fs.readFileSync(safePath, encoding);

      return {
        ok: true,
        data: {
          file_path: safePath,
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
      // 安全检查：路径白名单（防路径遍历）
      const safePath = safeResolvePath(filePath);
      if (!safePath) {
        return {
          ok: false,
          data: '安全限制：只能写入项目目录内的文件',
          latencyMs: Date.now() - startTime,
        };
      }

      // 安全检查：禁止写入敏感文件
      if (safePath.includes('.env') || safePath.includes('credentials') || safePath.includes('.key')) {
        return {
          ok: false,
          data: '安全限制：禁止写入敏感文件',
          latencyMs: Date.now() - startTime,
        };
      }

      // 确保目录存在
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      if (append) {
        fs.appendFileSync(safePath, content, 'utf-8');
      } else {
        fs.writeFileSync(safePath, content, 'utf-8');
      }

      return {
        ok: true,
        data: {
          file_path: safePath,
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

// ── 工具 8：email_send（发送邮件） ────────────────────────────

const emailSendTool: ToolDefinition = {
  name: 'email_send',
  description: '发送邮件（SMTP）。需要提供收件人、主题和正文。当用户要求"发邮件""给某人发信"时调用。',
  parameters: emailSendSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = emailSendSchema.parse(params);
    return emailSend(parsed);
  },
};

// ── 工具 9：email_receive（接收邮件） ─────────────────────────

const emailReceiveTool: ToolDefinition = {
  name: 'email_receive',
  description: '接收邮件列表（IMAP）。列出收件箱中的邮件，包含发件人、主题和日期。当用户要求"看看邮件""收件箱有什么"时调用。',
  parameters: emailReceiveSchema,
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = emailReceiveSchema.parse(params);
    return emailReceive(parsed);
  },
};

// ── 注册入口 ────────────────────────────────────────────────

/**
 * 注册所有内置工具
 *
 * 在主进程启动时调用一次。
 */
export function registerBuiltinTools(): void {
  registerTools([
    clockTool, webFetchTool, searchTool, translateTool, weatherTool,
    fileReadTool, fileWriteTool, emailSendTool, emailReceiveTool,
  ]);
  console.log('[Tools] builtin tools registered: clock, web_fetch, search, translate, weather, file_read, file_write, email_send, email_receive');
}
