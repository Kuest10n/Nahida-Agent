/**
 * 邮箱 MCP Server 框架 —— v0.8.5
 *
 * 职责：
 *   提供邮件收发能力的 MCP Server 框架（预留接口）
 *
 * 协议：
 *   stdio 模式，主进程通过 MCP Client 接入
 *
 * 工具清单（预留）：
 *   - email_send    : 发送邮件（SMTP）
 *   - email_receive : 接收邮件（IMAP）
 *   - email_list    : 列出收件箱
 *
 * 依赖：
 *   需要配置 SMTP/IMAP 服务器信息（环境变量）
 */

import { z } from 'zod';

// ── 类型定义 ──────────────────────────────────────────────────

/** 邮件消息 */
interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  timestamp: number;
}

/** MCP Server 配置 */
interface EmailMcpConfig {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
  password: string;
}

// ── 工具定义（预留接口） ──────────────────────────────────────

/** 发送邮件工具 schema */
export const emailSendSchema = z.object({
  to: z.array(z.string().email()).describe('收件人邮箱列表'),
  subject: z.string().describe('邮件主题'),
  body: z.string().describe('邮件正文'),
  cc: z.array(z.string().email()).optional().describe('抄送邮箱列表'),
});

/** 接收邮件工具 schema */
export const emailReceiveSchema = z.object({
  folder: z.string().optional().describe('邮箱文件夹，默认 INBOX'),
  limit: z.number().int().positive().optional().describe('获取数量限制，默认 10'),
});

/** 列出邮件工具 schema */
export const emailListSchema = z.object({
  folder: z.string().optional().describe('邮箱文件夹，默认 INBOX'),
  page: z.number().int().positive().optional().describe('页码，默认 1'),
  pageSize: z.number().int().positive().optional().describe('每页数量，默认 20'),
});

// ── 工具执行函数（预留实现） ──────────────────────────────────

/**
 * 发送邮件（预留实现）
 *
 * TODO: 集成 nodemailer 或类似库实现 SMTP 发送
 */
export async function emailSend(params: z.infer<typeof emailSendSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '邮件发送功能尚未实现，需要配置 SMTP 服务器' },
  };
}

/**
 * 接收邮件（预留实现）
 *
 * TODO: 集成 imap 库实现 IMAP 接收
 */
export async function emailReceive(params: z.infer<typeof emailReceiveSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '邮件接收功能尚未实现，需要配置 IMAP 服务器' },
  };
}

/**
 * 列出邮件（预留实现）
 *
 * TODO: 集成 imap 库实现 IMAP 列表查询
 */
export async function emailList(params: z.infer<typeof emailListSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '邮件列表功能尚未实现，需要配置 IMAP 服务器' },
  };
}

// ── MCP Server 入口（预留） ───────────────────────────────────

/**
 * 启动邮箱 MCP Server
 *
 * TODO: 集成 @modelcontextprotocol/sdk 实现 stdio 服务
 */
export function startEmailMcpServer(config: EmailMcpConfig): void {
  console.log('[Email MCP] Server framework loaded (not yet implemented)');
  console.log('[Email MCP] Required config:', {
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
  });
}
