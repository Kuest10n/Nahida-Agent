/**
 * 邮箱 MCP Server —— v1.2.x 补丁
 *
 * 职责：
 *   提供邮件收发能力的真实现（nodemailer + imap）。
 *
 * 协议：
 *   直接作为内置 Tool 注册到 Tool Registry（无需 stdio 子进程）。
 *
 * 工具清单：
 *   - email_send    : 发送邮件（SMTP）
 *   - email_receive : 接收邮件列表（IMAP）
 *
 * 依赖：
 *   nodemailer（SMTP 发送）
 *   imap（IMAP 接收）
 */

import { z } from 'zod';
import { createTransport } from 'nodemailer';
import * as Imap from 'imap';
import { getConfig } from '../../config/config';

// ── 类型定义 ──────────────────────────────────────────────────

/** 邮件消息 */
export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
}

/** 邮箱配置（从 Config 读取） */
export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  password: string;
}

// ── 工具 Schema ───────────────────────────────────────────────

export const emailSendSchema = z.object({
  to: z.array(z.string().email()).describe('收件人邮箱列表'),
  subject: z.string().describe('邮件主题'),
  body: z.string().describe('邮件正文'),
  cc: z.array(z.string().email()).optional().describe('抄送邮箱列表'),
});

export const emailReceiveSchema = z.object({
  folder: z.string().optional().describe('邮箱文件夹，默认 INBOX'),
  limit: z.number().int().positive().max(50).optional().describe('获取数量限制，默认 10，最大 50'),
});

// ── 配置读取 ──────────────────────────────────────────────────

function getEmailConfig(): EmailConfig | null {
  const cfg = getConfig().email;
  if (!cfg || !cfg.username || !cfg.password) return null;
  return {
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpSecure: cfg.smtpSecure,
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    imapSecure: cfg.imapSecure,
    username: cfg.username,
    password: cfg.password,
  };
}

// ── 工具执行 ──────────────────────────────────────────────────

/**
 * 发送邮件（SMTP via nodemailer）
 */
export async function emailSend(
  params: z.infer<typeof emailSendSchema>
): Promise<{ ok: boolean; data: unknown; latencyMs: number }> {
  const startTime = Date.now();
  const cfg = getEmailConfig();
  if (!cfg) {
    return {
      ok: false,
      data: { message: '邮箱未配置，请在设置中填写 SMTP/IMAP 信息' },
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const transporter = createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: {
        user: cfg.username,
        pass: cfg.password,
      },
      connectionTimeout: 10_000,
    });

    const info = await transporter.sendMail({
      from: cfg.username,
      to: params.to.join(', '),
      cc: params.cc?.join(', '),
      subject: params.subject,
      text: params.body,
    });

    return {
      ok: true,
      data: { messageId: info.messageId, accepted: info.accepted },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: { message: `发送失败: ${msg}` }, latencyMs: Date.now() - startTime };
  }
}

/**
 * 接收邮件列表（IMAP via imap 库）
 */
export async function emailReceive(
  params: z.infer<typeof emailReceiveSchema>
): Promise<{ ok: boolean; data: unknown; latencyMs: number }> {
  const startTime = Date.now();
  const cfg = getEmailConfig();
  if (!cfg) {
    return {
      ok: false,
      data: { message: '邮箱未配置，请在设置中填写 SMTP/IMAP 信息' },
      latencyMs: Date.now() - startTime,
    };
  }

  const folder = params.folder ?? 'INBOX';
  const limit = Math.min(params.limit ?? 10, 50);

  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const imap = new (Imap as unknown as new (opts: Record<string, unknown>) => {
      once(event: 'ready' | 'error', handler: (err?: Error) => void): void;
      openBox(name: string, readOnly: boolean, cb: (err: Error | null) => void): void;
      search(criteria: string[], cb: (err: Error | null, results: number[] | null) => void): void;
      fetch(sources: number[], options: Record<string, unknown>): {
        on(event: 'message', handler: (msg: {
          on(event: 'body', handler: (stream: { on(event: 'data', handler: (chunk: Buffer) => void): void }) => void): void;
          once(event: 'end', handler: () => void): void;
        }, seqno: number) => void): void;
        once(event: 'error' | 'end', handler: (err?: Error) => void): void;
      };
      end(): void;
      connect(): void;
    })({
      user: cfg.username,
      password: cfg.password,
      host: cfg.imapHost,
      port: cfg.imapPort,
      tls: cfg.imapSecure,
      connTimeout: 10_000,
    });

    const messages: EmailMessage[] = [];

    imap.once('ready', () => {
      imap.openBox(folder, true, (err) => {
        if (err) {
          imap.end();
          resolve({ ok: false, data: { message: `打开邮箱失败: ${err.message}` }, latencyMs: Date.now() - startTime });
          return;
        }

        imap.search(['ALL'], (searchErr, results) => {
          if (searchErr) {
            imap.end();
            resolve({ ok: false, data: { message: `搜索邮件失败: ${searchErr.message}` }, latencyMs: Date.now() - startTime });
            return;
          }

          if (!results || results.length === 0) {
            imap.end();
            resolve({ ok: true, data: { messages: [], count: 0 }, latencyMs: Date.now() - startTime });
            return;
          }

          // 取最新的 limit 条
          const target = results.slice(-limit);

          const f = imap.fetch(target, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)', struct: false });

          f.on('message', (msg, seqno) => {
            let headerBuffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk: Buffer) => {
                headerBuffer += chunk.toString('utf8');
              });
            });
            msg.once('end', () => {
              const from = headerBuffer.match(/From: (.+)/)?.[1]?.trim() ?? 'Unknown';
              const to = headerBuffer.match(/To: (.+)/)?.[1]?.trim() ?? '';
              const subject = headerBuffer.match(/Subject: (.+)/)?.[1]?.trim() ?? '(无主题)';
              const date = headerBuffer.match(/Date: (.+)/)?.[1]?.trim() ?? '';
              messages.push({
                id: String(seqno),
                from,
                to: to ? to.split(',').map(s => s.trim()) : [],
                subject,
                body: '(正文未获取，仅显示头信息)',
                date,
              });
            });
          });

          f.once('error', (fetchErr) => {
            imap.end();
            resolve({ ok: false, data: { message: `获取邮件失败: ${fetchErr?.message ?? 'unknown'}` }, latencyMs: Date.now() - startTime });
          });

          f.once('end', () => {
            imap.end();
            resolve({ ok: true, data: { messages, count: messages.length }, latencyMs: Date.now() - startTime });
          });
        });
      });
    });

    imap.once('error', (err?: Error) => {
      resolve({ ok: false, data: { message: `IMAP 连接失败: ${err?.message ?? 'unknown'}` }, latencyMs: Date.now() - startTime });
    });

    imap.connect();
  });
}
