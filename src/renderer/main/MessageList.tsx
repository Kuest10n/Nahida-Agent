import React, { useRef, useEffect } from 'react';
import type { Message } from './types';
import { MessageBubble } from './MessageBubble';

/**
 * 消息列表组件
 *
 * - 自动滚动到底部（新消息 / 流式输出）
 * - 空状态显示占位提示
 */
export const MessageList: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 新消息或流式输出时自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#81c784',
          fontSize: 14,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🌿</div>
          <div>向纳西妲打个招呼吧</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px 16px',
      }}
    >
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
};