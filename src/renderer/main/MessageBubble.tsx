import React from 'react';
import type { Message } from './types';

/**
 * 消息气泡组件
 *
 * - 用户消息：靠右，绿色背景
 * - 助手消息：靠左，白色背景，带草绿边框
 */
export const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 14px',
          borderRadius: 12,
          backgroundColor: isUser ? '#c8e6c9' : '#fff',
          border: isUser ? 'none' : '1px solid #a5d6a7',
          color: '#1b5e20',
          fontSize: 14,
          lineHeight: 1.5,
          // 流式输出时的光标效果
          ...(message.isStreaming ? {
            boxShadow: '0 0 0 2px rgba(46, 125, 50, 0.2)',
          } : {}),
        }}
      >
        {message.content}
        {/* 流式输出时显示闪烁光标 */}
        {message.isStreaming && (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 14,
              backgroundColor: '#2e7d32',
              marginLeft: 2,
              animation: 'blink 1s infinite',
              verticalAlign: 'text-bottom',
            }}
          />
        )}
      </div>

      {/* 内联样式定义闪烁动画 */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};