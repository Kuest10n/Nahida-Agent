import React, { useState } from 'react';

interface SidebarProps {
  currentPersonality: { id: string; displayName: string } | null;
  personalities: { id: string; displayName: string; description: string }[];
  onSwitchPersonality: (personalityId: string) => Promise<void>;
  onClearChat: () => void;
  onShowStats: () => void;
  onShowBalance?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 左侧边栏 —— Cherry Studio 风格
 *
 * 布局：
 *   ┌────┐
 *   │ 🌿 │  ← Logo + 当前人格
 *   ├────┤
 *   │ +  │  ← 新对话
 *   │ 💬 │  ← 会话列表（当前 v0.9.5 占位）
 *   │ 📊 │  ← /stats
 *   │ ⚙  │  ← 人格切换
 *   └────┘
 */
export const Sidebar: React.FC<SidebarProps> = ({
  currentPersonality,
  personalities,
  onSwitchPersonality,
  onClearChat,
  onShowStats,
  onShowBalance,
  onOpenSettings,
}) => {
  const [expanded, setExpanded] = useState(false);

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: expanded ? '10px 14px' : '10px 0',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#558b2f',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: expanded ? 'flex-start' : 'center',
    gap: 10,
    borderRadius: 6,
    marginBottom: 2,
    transition: 'background-color 0.15s',
  };

  return (
    <aside
      style={{
        width: expanded ? 220 : 60,
        flexShrink: 0,
        background: 'linear-gradient(180deg, #ffffff 0%, #f1f7ed 100%)',
        borderRight: '1px solid #d9e4d4',
        display: 'flex',
        flexDirection: 'column',
        padding: 8,
        transition: 'width 0.2s',
      }}
    >
      {/* Logo 区 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          padding: '8px 4px',
          marginBottom: 8,
          gap: 8,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #81c784 0%, #aed581 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: '0 1px 4px rgba(129, 199, 132, 0.4)',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          🌿
        </div>
        {expanded && (
          <span style={{ fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
            {currentPersonality?.displayName ?? '纳西妲'}
          </span>
        )}
      </div>

      {/* 新对话 */}
      <button
        style={buttonStyle}
        onClick={onClearChat}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#e8f5e9'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        title="新对话 (清空历史)"
      >
        <span style={{ fontSize: 16 }}>＋</span>
        {expanded && <span>新对话</span>}
      </button>

      {/* 会话列表（v0.9.5 占位） */}
      <button
        style={{ ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        title="历史会话（v0.9.5 占位）"
        disabled
      >
        <span style={{ fontSize: 16 }}>💬</span>
        {expanded && <span>历史会话</span>}
      </button>

      {/* 统计 */}
      <button
        style={buttonStyle}
        onClick={onShowStats}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#e8f5e9'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        title="Token 统计"
      >
        <span style={{ fontSize: 16 }}>📊</span>
        {expanded && <span>统计</span>}
      </button>

      {/* 余额 */}
      <button
        style={buttonStyle}
        onClick={onShowBalance}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#e8f5e9'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        title="API 余额"
      >
        <span style={{ fontSize: 16 }}>💰</span>
        {expanded && <span>余额</span>}
      </button>

      {/* 设置 */}
      <button
        style={buttonStyle}
        onClick={onOpenSettings}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#e8f5e9'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        title="设置"
      >
        <span style={{ fontSize: 16 }}>🔧</span>
        {expanded && <span>设置</span>}
      </button>

      {/* 人格切换 */}
      <div style={{ marginTop: 'auto', position: 'relative' }}>
        <button
          style={buttonStyle}
          onClick={() => setExpanded(!expanded)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#e8f5e9'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          title="人格切换"
        >
          <span style={{ fontSize: 16 }}>⚙</span>
          {expanded && <span>切换人格</span>}
        </button>

        {expanded && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: 4,
              backgroundColor: '#fff',
              border: '1px solid #d9e4d4',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(46, 125, 50, 0.15)',
              padding: 4,
              zIndex: 100,
            }}
          >
            {personalities.map((p) => (
              <button
                key={p.id}
                onClick={() => onSwitchPersonality(p.id)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  textAlign: 'left',
                  border: 'none',
                  backgroundColor: p.id === currentPersonality?.id ? '#e8f5e9' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 12,
                  color: p.id === currentPersonality?.id ? '#2e7d32' : '#333',
                }}
              >
                <div style={{ fontWeight: 500 }}>{p.displayName}</div>
                <div style={{ fontSize: 10, color: '#7a8d72', marginTop: 2 }}>{p.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
