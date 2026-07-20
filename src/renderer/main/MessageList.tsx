import React, { useRef, useEffect } from 'react';
import type { Message } from './types';
import { MessageBubble } from './MessageBubble';
import { StatsCard } from './StatsCard';

/** 样式常量（模块级，避免每次渲染创建新对象） */
const EMPTY_STATE_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#81c784',
  fontSize: 14,
};

const EMPTY_CONTENT_STYLE: React.CSSProperties = {
  textAlign: 'center',
};

const EMPTY_ICON_STYLE: React.CSSProperties = {
  fontSize: 24,
  marginBottom: 8,
};

const LIST_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '12px 16px',
};

/**
 * 消息列表组件
 *
 * - 自动滚动到底部（新消息 / 流式输出）
 * - 空状态显示占位提示
 * - 识别统计类消息并渲染 StatsCard 图表
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
      <div style={EMPTY_STATE_STYLE}>
        <div style={EMPTY_CONTENT_STYLE}>
          <div style={EMPTY_ICON_STYLE}>🌿</div>
          <div>向纳西妲打个招呼吧</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} style={LIST_STYLE}>
      {messages.map(msg => {
        // 识别统计类消息，渲染图表卡片
        if (msg.role === 'assistant' && msg.content.startsWith('📊 Token 使用统计')) {
          return <StatsCard key={msg.id} summary={msg.content} />;
        }
        return <MessageBubble key={msg.id} message={msg} />;
      })}
    </div>
  );
};