import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { Sidebar } from './Sidebar';
import { SettingsModal } from './SettingsModal';
import { FeedbackModal } from './FeedbackModal';
import type { Message } from './types';
import { generateMessageId, extractActionTag } from './types';
import { IpcChannel } from '../../shared/types/ipc';
import type { Config } from '../../shared/types/config';

interface Personality {
  id: string;
  name: string;
  displayName: string;
  description: string;
  default: boolean;
  createdAt: number;
}

/**
 * 聊天面板 —— Cherry Studio 风格两栏布局
 *
 *  ┌──────┬──────────────────────┐
 *  │      │  标题栏              │
 *  │ Side │  消息列表            │
 *  │ bar  │  StatusBar           │
 *  │      │  输入栏              │
 *  └──────┴──────────────────────┘
 *
 *   - 左侧栏：人格切换 + 新对话 + /stats + 历史占位
 *   - 主区：消息列表 + 输入栏
 *   - 流式输出时禁用输入
 */
export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [currentPersonality, setCurrentPersonality] = useState<Personality | null>(null);
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  // 设置模态框状态
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  // 反馈模态框状态
  const [showFeedback, setShowFeedback] = useState(false);

  // 监听 Ctrl+Shift+F 快捷键（主进程推送）
  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('feedback:open', () => {
      setShowFeedback(true);
    });
    return () => { cleanup?.(); };
  }, []);

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

  // 监听流式推送（只用 ref 跟踪最新 streamingId，避免重复订阅）
  const streamingIdRef = useRef<string | null>(null);
  useEffect(() => {
    streamingIdRef.current = streamingId;
  }, [streamingId]);

  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('agent:model-delta', (payload) => {
      const data = payload as { delta: string; finishReason?: string; sessionId?: string };

      setMessages(prev => {
        const currentStreamingId = streamingIdRef.current;
        const streamingMsg = prev.find(m => m.id === currentStreamingId);
        if (streamingMsg) {
          return prev.map(m =>
            m.id === currentStreamingId
              ? { ...m, content: m.content + data.delta }
              : m
          );
        } else {
          const newId = generateMessageId();
          streamingIdRef.current = newId;
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

      if (data.finishReason) {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setStreamingId(null);
        setMessages(prev => prev.map(m =>
          m.isStreaming
            ? { ...m, isStreaming: false, actionTag: extractActionTag(m.content) }
            : m
        ));
      }
    });

    return () => { cleanup?.(); };
  }, []);

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
    } catch (err) {
      console.error('[ChatPanel] send failed:', err);
      setIsStreaming(false);
      setStreamingId(null);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: '（草光暗了一瞬）抱歉，出了点问题...',
        timestamp: Date.now(),
      }]);
    }
  }, [isStreaming]);

  // 新对话：清空消息
  const handleClearChat = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
  }, [isStreaming]);

  // 切换人格
  const handleSwitchPersonality = useCallback(async (personalityId: string) => {
    try {
      await window.nahidaAPI?.invoke(IpcChannel.PERSONALITY_SWITCH, { personalityId });
      const p = personalities.find(x => x.id === personalityId);
      if (p) setCurrentPersonality(p);
      setMessages([]);
    } catch (err) {
      console.error('[ChatPanel] switch personality failed:', err);
    }
  }, [personalities]);

  // /stats 触发 —— 显示真实统计数据
  const handleShowStats = useCallback(async () => {
    try {
      const res = await window.nahidaAPI?.invoke('stats:get', {}) as { ok: boolean; summary?: string } | undefined;
      const summary = res?.ok && res.summary ? res.summary : '（轻托腮）……统计数据暂时拿不到，再试试？';

      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      console.error('[ChatPanel] stats:get failed:', err);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: '（虚空屏暗了一瞬）……统计模块好像睡着了，让我看看。',
        timestamp: Date.now(),
      }]);
    }
  }, []);

  // 余额按钮触发 —— 显示 API 余额
  const handleShowBalance = useCallback(async () => {
    try {
      const res = await window.nahidaAPI?.invoke('balance:get', {}) as { ok: boolean; summary?: string } | undefined;
      const summary = res?.ok && res.summary ? res.summary : '（虚空屏暗了一瞬）……余额查询没成功，再试试？';

      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      console.error('[ChatPanel] balance:get failed:', err);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        role: 'assistant',
        content: '（虚空屏暗了一瞬）……余额模块好像睡着了，让我看看。',
        timestamp: Date.now(),
      }]);
    }
  }, []);

  // 打开设置
  const handleOpenSettings = useCallback(async () => {
    try {
      const res = await window.nahidaAPI?.invoke('config:get', {}) as { ok: boolean; config?: Config } | undefined;
      if (res && res.ok && res.config) {
        setConfig(res.config);
      }
      setShowSettings(true);
    } catch (err) {
      console.error('[ChatPanel] get config failed:', err);
      setShowSettings(true); // 依然打开，只是配置可能为空
    }
  }, []);

  // 保存配置
  const handleSaveConfig = useCallback(async (newConfig: Partial<Config>) => {
    try {
      await window.nahidaAPI?.invoke('config:set', { config: newConfig });
      setConfig(prev => prev ? { ...prev, ...newConfig } : null);
    } catch (err) {
      console.error('[ChatPanel] save config failed:', err);
      throw err;
    }
  }, []);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: 'linear-gradient(180deg, #f3f7f1 0%, #e8f1f4 100%)',
        color: '#2e3a32',
        fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      {/* 左侧栏 */}
      <Sidebar
        currentPersonality={currentPersonality}
        personalities={personalities}
        onSwitchPersonality={handleSwitchPersonality}
        onClearChat={handleClearChat}
        onShowStats={handleShowStats}
        onShowBalance={handleShowBalance}
        onOpenSettings={handleOpenSettings}
      />

      {/* 右侧主区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 顶部标题栏 */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid #d9e4d4',
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 1px 3px rgba(46, 125, 50, 0.04)',
          }}
        >
          <span style={{ fontSize: 14, color: '#2e7d32', fontWeight: 600 }}>
            {currentPersonality?.displayName ?? '纳西妲'}
          </span>
          <span style={{ fontSize: 11, color: '#7a8d72' }}>
            · {isStreaming ? '正在思考...' : '愿世界树的枝叶为你指路'}
          </span>
        </div>

        {/* 消息列表 */}
        <MessageList messages={messages} />

        {/* 状态栏（Perception 报警 toast） */}
        <StatusBar />

        {/* 输入栏 */}
        <InputBar onSend={handleSend} disabled={isStreaming} />
      </div>

      {/* 设置模态框 */}
      {showSettings && (
        <SettingsModal
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 反馈模态框 */}
      {showFeedback && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}
    </div>
  );
};
