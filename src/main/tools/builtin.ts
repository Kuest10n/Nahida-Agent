/**
 * 内置工具集 —— T7
 *
 * 注册一批基础工具，覆盖 SOHA.md §11 时间感知、§14.2 虚空检索等核心能力。
 * 所有工具纯 CPU/IO，不占 GPU。
 *
 * 工具清单：
 *   - clock       : 获取当前时间（支撑 SOHA §11 时间感知规则）
 *   - web_fetch   : 抓取网页正文（虚空检索的基础）
 *
 * 后续扩展口（来自 .trae/rules/skills.md）：
 *   文件操作、搜索、天气、Office 生成、翻译、记账、出行规划
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';

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
    if (hostname.startsWith('localhost') || hostname.startsWith('127.')) return false;
    if (hostname.startsWith('10.')) return false;
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 16 && secondOctet <= 31) return false;
    }
    if (hostname.startsWith('192.168.')) return false;
    if (hostname === '169.254.169.254') return false;
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

// ── 注册入口 ──────────────────────────────────────────────────

/**
 * 注册所有内置工具
 *
 * 在主进程启动时调用一次。
 */
export function registerBuiltinTools(): void {
  registerTools([clockTool, webFetchTool]);
  console.log('[Tools] builtin tools registered: clock, web_fetch');
}
