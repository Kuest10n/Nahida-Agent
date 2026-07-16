/**
 * 对话导出模块 —— v1.8
 *
 * 职责：
 *   1. 将指定会话的对话历史导出为 Markdown / JSON
 *   2. 支持导出全部会话或单个会话
 *   3. 导出文件保存到用户选择的路径
 *
 * 导出格式：
 *   - Markdown：人类可读，含时间戳和角色标记
 *   - JSON：机器可读，含完整元数据
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSessionMessages } from '../memory/session-store';

// ── 类型定义 ──────────────────────────────────────────────────

/** 导出格式 */
export type ExportFormat = 'markdown' | 'json';

/** 导出选项 */
export interface ExportOptions {
  /** 导出格式 */
  format: ExportFormat;
  /** 会话 ID（不指定则导出全部）
   * 注意：当前版本仅支持单会话导出
   */
  sessionId: string;
  /** 导出文件路径（不指定则返回内容字符串） */
  filePath?: string;
  /** 是否包含元数据（时间戳/模型/token 等） */
  includeMetadata: boolean;
}

/** 导出结果 */
export interface ExportResult {
  success: boolean;
  /** 导出文件路径（如果指定了 filePath） */
  filePath?: string;
  /** 导出内容（如果未指定 filePath） */
  content?: string;
  /** 导出的消息数 */
  messageCount: number;
  /** 错误信息 */
  error?: string;
}

// ── 核心逻辑 ──────────────────────────────────────────────────

/**
 * 导出对话历史
 */
export function exportConversation(options: ExportOptions): ExportResult {
  try {
    // 获取会话消息
    const messages = getSessionMessages(options.sessionId);

    if (messages.length === 0) {
      return {
        success: false,
        messageCount: 0,
        error: '会话中没有消息可导出',
      };
    }

    let content: string;

    // 根据格式生成内容
    if (options.format === 'markdown') {
      content = toMarkdown(messages, options);
    } else {
      content = toJSON(messages, options);
    }

    // 写入文件或返回内容
    if (options.filePath) {
      fs.writeFileSync(options.filePath, content, 'utf-8');
      return {
        success: true,
        filePath: options.filePath,
        messageCount: messages.length,
      };
    }

    return {
      success: true,
      content,
      messageCount: messages.length,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      messageCount: 0,
      error: errorMsg,
    };
  }
}

// ── 格式化函数 ────────────────────────────────────────────────

/**
 * 转换为 Markdown 格式
 */
function toMarkdown(
  messages: Array<{ role: string; content: string; timestamp?: number | string }>,
  options: ExportOptions,
): string {
  const lines: string[] = [];

  // 标题
  lines.push('# 对话记录');
  lines.push('');

  // 元数据
  if (options.includeMetadata) {
    lines.push(`> 导出时间：${new Date().toISOString()}`);
    lines.push(`> 会话 ID：${options.sessionId}`);
    lines.push(`> 消息数：${messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 消息
  for (const msg of messages) {
    const role = msg.role === 'user' ? '🧑 旅行者' : msg.role === 'assistant' ? '🌿 纳西妲' : `🔧 ${msg.role}`;
    const time = msg.timestamp ? ` *(${new Date(typeof msg.timestamp === 'number' ? msg.timestamp : Date.parse(msg.timestamp)).toISOString()})*` : '';

    lines.push(`### ${role}${time}`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  // 尾部
  lines.push('---');
  lines.push('');
  lines.push('*由纳西妲 Agent 导出（铃铛轻响）*');

  return lines.join('\n');
}

/**
 * 转换为 JSON 格式
 */
function toJSON(
  messages: Array<{ role: string; content: string; timestamp?: number | string }>,
  options: ExportOptions,
): string {
  const data = {
    metadata: options.includeMetadata
      ? {
          exportedAt: new Date().toISOString(),
          sessionId: options.sessionId,
          messageCount: messages.length,
          format: 'json',
        }
      : undefined,
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp ?? null,
    })),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * 获取默认导出文件路径
 *
 * 在用户目录下创建 nahida-exports/ 目录。
 */
export function getDefaultExportPath(sessionId: string, format: ExportFormat): string {
  const exportDir = path.resolve(process.cwd(), 'exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0] ?? '';
  const ext = format === 'markdown' ? 'md' : 'json';
  const safeSessionId = sessionId.substring(0, 8);

  return path.join(exportDir, `conversation_${safeSessionId}_${timestamp}.${ext}`);
}