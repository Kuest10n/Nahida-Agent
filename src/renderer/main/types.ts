/**
 * 消息类型定义
 *
 * 支持用户消息和助手消息，助手消息支持流式输出
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 动作 tag（从内容末尾括号抽取） */
  actionTag?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
}

/** 生成唯一消息 ID */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从消息内容末尾抽取动作 tag */
export function extractActionTag(content: string): string | undefined {
  const match = content.match(/（([^）]+)）\s*$/);
  return match?.[1];
}