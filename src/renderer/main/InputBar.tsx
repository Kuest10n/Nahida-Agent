import React, { useState, KeyboardEvent } from 'react';

/**
 * 输入栏组件
 *
 * - 文本框支持回车发送
 * - 发送中禁用按钮
 * - 简洁的草绿色主题
 */
export const InputBar: React.FC<{
  onSend: (message: string) => void;
  disabled?: boolean;
}> = ({ onSend, disabled }) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        borderTop: '1px solid #e8f5e9',
        backgroundColor: '#fff',
      }}
    >
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="说点什么..."
        disabled={disabled}
        style={{
          flex: 1,
          padding: '10px 14px',
          borderRadius: 20,
          border: '1px solid #c8e6c9',
          outline: 'none',
          fontSize: 14,
          color: '#1b5e20',
          backgroundColor: disabled ? '#f5f5f5' : '#fff',
        }}
        onFocus={e => {
          e.target.style.borderColor = '#81c784';
        }}
        onBlur={e => {
          e.target.style.borderColor = '#c8e6c9';
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !input.trim()}
        style={{
          padding: '10px 20px',
          borderRadius: 20,
          border: 'none',
          backgroundColor: (disabled || !input.trim()) ? '#e0e0e0' : '#66bb6a',
          color: '#fff',
          fontSize: 14,
          cursor: (disabled || !input.trim()) ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s',
        }}
      >
        发送
      </button>
    </div>
  );
};