import React, { useState, useEffect, useCallback } from 'react';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import type { Message } from './types';
import { generateMessageId, extractActionTag } from './types';
import { IpcChannel } from '../../shared/types/ipc';

interface Personality {
  id: string;
  name: string;
  displayName: string;
  description: string;
  default: boolean;
  createdAt: number;
}

/**
 * 聊天面板 —— T4 完整聊天界面
 *
 * 功能：
 *   - 消息列表（用户 + 助手，支持流式输出）
 *   - 输入栏（回车发送 / 点击发送）
 *   - 监听 agent:model-delta 流式推送
 *   - 流式输出时禁用输入
 *   - 人格切换下拉菜单
 */
export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [currentPersonality, setCurrentPersonality] = useState<Personality | null>(null);
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [showPersonalityMenu, setShowPersonalityMenu] = useState(false);

  // 加载人格列表和当前人格
  useEffect(() => {
    const loadPersonality = async () => {
      try {
        const [currentRes, listRes] = await Promise.all([
          window.nahidaAPI?.invoke(IpcChannel.PERSONALITY_GET, {}) as Promise<{ ok: boolean; personality?: Personality } | undefined>,
          window.nahidaAPI?.invoke(IpcChannel.PERSONALITY_LIST, {}) as Promise<{ ok: boolean; personalities: Personality[] } | undefined>,
        ]);
        if (currentRes && currentRes.ok) {
          setCurrentPersonality(currentRes.personality ?? null);
        }
        if (listRes && listRes.ok) {
          setPersonalities(listRes.personalities);
        }
      } catch (err) {
        console.error('[ChatPanel] load personality failed:', err);
      }
    };
    loadPersonality();
  }, []);

  // 监听流式推送
  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('agent:model-delta', (payload) => {
      const data = payload as { delta: string; finishReason?: string; sessionId?: string };

      setMessages(prev => {
        // 找到正在流式输出的消息
        const streamingMsg = prev.find(m => m.id === streamingId);
        if (streamingMsg) {
          // 追加 delta 到现有消息
          return prev.map(m =>
            m.id === streamingId
              ? { ...m, content: m.content + data.delta }
              : m
          );
        } else {
          // 创建新的助手消息（流式开始）
          const newId = generateMessageId();
          setStreamingId(newId);
          return [...prev, {
            id: newId,
            role: 'assistant' as const,
            content: data.delta,
            timestamp: Date.now(),
            isStreaming: !data.finishReason,
          }];
        }
      });

      // 流式结束
      if (data.finishReason) {
        setIsStreaming(false);
        setStreamingId(null);
        // 抽取动作 tag
        setMessages(prev => prev.map(m =>
          m.isStreaming
            ? { ...m, isStreaming: false, actionTag: extractActionTag(m.content) }
            : m
        ));
      }
    });

    return () => { cleanup?.(); };
  }, [streamingId]);

  // 发送消息
  const handleSend = useCallback(async (content: string) => {
    if (!window.nahidaAPI || isStreaming) return;

    // 添加用户消息
    const userMsg: Message = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    // 调用 IPC
    try {
      await window.nahidaAPI.invoke('agent:chat', {
        message: content,
        mode: 'casual',
      });
      // 响应通过 agent:model-delta 推送，这里只等待确认
    } catch (err) {
      console.error('[ChatPanel] send failed:', err);
      setIsStreaming(false);
      setStreamingId(null);
      // 添加错误消息
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: '（草光暗了一瞬）抱歉，出了点问题...',
        timestamp: Date.now(),
      }]);
    }
  }, [isStreaming]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fafafa',
      }}
    >
      {/* 顶部标题栏 */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e8f5e9',
          backgroundColor: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 18 }}>🌿</span>
        <span style={{ fontSize: 16, color: '#2e7d32', fontWeight: 500 }}>
          {currentPersonality?.displayName ?? '纳西妲'}
        </span>
        {isStreaming && (
          <span style={{ fontSize: 12, color: '#81c784', marginLeft: 8 }}>
            正在思考...
          </span>
        )}

        {/* 人格切换下拉菜单 */}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            onClick={() => setShowPersonalityMenu(!showPersonalityMenu)}
            style={{
              padding: '4px 8px',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              backgroundColor: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            切换人格
            <span>{showPersonalityMenu ? '▲' : '▼'}</span>
          </button>

          {showPersonalityMenu && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                backgroundColor: '#fff',
                border: '1px solid #e0e0e0',
                borderRadius: 4,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                padding: 4,
                minWidth: 160,
                zIndex: 100,
              }}
            >
              {personalities.map((p) => (
                <button
                  key={p.id}
                  onClick={async () => {
                    try {
                      await window.nahidaAPI?.invoke(IpcChannel.PERSONALITY_SWITCH, {
                        personalityId: p.id,
                      });
                      setCurrentPersonality(p);
                      setMessages([]);
                    } catch (err) {
                      console.error('[ChatPanel] switch personality failed:', err);
                    }
                    setShowPersonalityMenu(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    textAlign: 'left',
                    border: 'none',
                    backgroundColor: p.id === currentPersonality?.id ? '#e8f5e9' : 'transparent',
                    cursor: 'pointer',
                    borderRadius: 2,
                    fontSize: 13,
                    color: p.id === currentPersonality?.id ? '#2e7d32' : '#333',
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{p.displayName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <MessageList messages={messages} />

      {/* 状态栏（Perception 报警 toast） */}
      <StatusBar />

      {/* 输入栏 */}
      <InputBar onSend={handleSend} disabled={isStreaming} />
    </div>
  );
};