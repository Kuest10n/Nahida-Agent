/**
 * 审计日志 —— v1.2.x 安全补丁（L5 纵深防御）
 *
 * 职责：
 *   记录敏感操作（配置修改、文件读写、工具调用、模型切换等），
 *   为事后溯源和安全分析提供依据。
 *
 * 设计：
 *   - 异步追加写入，不阻塞主流程
 *   - 按日轮转，避免单文件过大
 *   - 敏感字段（密码/Key）自动脱敏
 *   - 纯文本格式，便于人工审计
 *
 * 日志路径：memory/audit/YYYY-MM-DD.log
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 审计事件类型 */
export type AuditEventType =
  | 'config_change'
  | 'file_read'
  | 'file_write'
  | 'tool_call'
  | 'model_switch'
  | 'personality_switch'
  | 'email_send'
  | 'mcp_connect'
  | 'ipc_invoke';

/** 审计事件 */
export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  action: string;
  details: Record<string, unknown>;
  source: 'user' | 'system' | 'agent';
}

const AUDIT_DIR = path.resolve(process.cwd(), 'memory', 'audit');

/** 获取今日日志文件路径 */
function getTodayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(AUDIT_DIR, `${date}.log`);
}

/** 确保目录存在 */
function ensureDir(): void {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

/**
 * 脱敏敏感字段
 *
 * 把 password、key、token 等字段的值替换为 ***
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'key', 'token', 'secret', 'apiKey', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(details)) {
    const lowerKey = k.toLowerCase();
    const isSensitive = sensitiveKeys.some(sk => lowerKey.includes(sk));
    if (isSensitive && typeof v === 'string') {
      sanitized[k] = v.length > 4 ? `${v.slice(0, 2)}***${v.slice(-2)}` : '***';
    } else {
      sanitized[k] = v;
    }
  }

  return sanitized;
}

/**
 * 记录审计事件
 *
 * @param event 审计事件（会自动脱敏和追加时间戳）
 */
export function auditLog(event: Omit<AuditEvent, 'timestamp'>): void {
  try {
    ensureDir();

    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    const line = JSON.stringify({
      ...fullEvent,
      details: sanitizeDetails(fullEvent.details),
    });

    fs.appendFileSync(getTodayLogPath(), line + '\n', 'utf-8');
  } catch (err) {
    // 审计日志失败不能阻断主流程
    console.error('[AuditLog] write failed:', err);
  }
}

/**
 * 便捷函数：记录配置变更
 */
export function auditConfigChange(section: string, changedKeys: string[]): void {
  auditLog({
    type: 'config_change',
    action: `修改配置: ${section}`,
    details: { section, changedKeys },
    source: 'user',
  });
}

/**
 * 便捷函数：记录工具调用
 */
export function auditToolCall(toolName: string, params: Record<string, unknown>): void {
  auditLog({
    type: 'tool_call',
    action: `调用工具: ${toolName}`,
    details: { toolName, params },
    source: 'agent',
  });
}

/**
 * 便捷函数：记录文件操作
 */
export function auditFileOperation(
  operation: 'read' | 'write',
  filePath: string,
  result: 'success' | 'failure',
): void {
  auditLog({
    type: operation === 'read' ? 'file_read' : 'file_write',
    action: `${operation === 'read' ? '读取' : '写入'}文件: ${path.basename(filePath)}`,
    details: { filePath, result },
    source: 'agent',
  });
}
