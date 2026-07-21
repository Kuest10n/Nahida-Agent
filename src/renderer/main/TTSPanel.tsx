/**
 * TTS 控制面板
 *
 * 功能：
 *   - TTS 开关
 *   - 当前适配器显示（edge-tts / GPT-SoVITS）
 *   - 语音状态显示
 *   - 试听功能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { IpcChannel } from '../../shared/types/ipc';
import type { Config } from '../../shared/types/config';

interface TTSPanelProps {
  config: Config | null;
  onClose: () => void;
  onSaveConfig: (config: Partial<Config>) => Promise<void>;
}

type VoiceConfigUpdate = Partial<Config['voice']> & {
  ttsAdapter?: 'edge-tts' | 'gpt-sovits';
  ttsEnabled?: boolean;
};

export const TTSPanel: React.FC<TTSPanelProps> = ({ config, onClose, onSaveConfig }) => {
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsAdapter, setTtsAdapter] = useState<'edge-tts' | 'gpt-sovits'>('edge-tts');
  const [isPlaying, setIsPlaying] = useState(false);
  const [saving, setSaving] = useState(false);

  // 初始化配置
  useEffect(() => {
    if (config?.voice) {
      setTtsEnabled(config.voice.ttsEnabled ?? true);
      setTtsAdapter(config.voice.ttsAdapter ?? 'edge-tts');
    }
  }, [config]);

  // 切换 TTS 开关
  const handleToggleTTS = useCallback(async () => {
    const newValue = !ttsEnabled;
    setTtsEnabled(newValue);
    setSaving(true);
    try {
      const voiceUpdate: VoiceConfigUpdate = { ttsEnabled: newValue };
      await onSaveConfig({ voice: voiceUpdate as Config['voice'] });
    } catch (err) {
      console.error('[TTSPanel] save failed:', err);
      setTtsEnabled(!newValue); // 回滚
    } finally {
      setSaving(false);
    }
  }, [ttsEnabled, onSaveConfig]);

  // 切换适配器
  const handleSwitchAdapter = useCallback(async (adapter: 'edge-tts' | 'gpt-sovits') => {
    setTtsAdapter(adapter);
    setSaving(true);
    try {
      const voiceUpdate: VoiceConfigUpdate = { ttsAdapter: adapter };
      await onSaveConfig({ voice: voiceUpdate as Config['voice'] });
    } catch (err) {
      console.error('[TTSPanel] save failed:', err);
      setTtsAdapter(adapter === 'edge-tts' ? 'gpt-sovits' : 'edge-tts'); // 回滚
    } finally {
      setSaving(false);
    }
  }, [onSaveConfig]);

  // 试听
  const handleTest = useCallback(async () => {
    if (isPlaying) return;
    setIsPlaying(true);
    try {
      const testText = '你好，我是纳西妲，很高兴见到你。';
      // 通过 TTS 通道发送试听请求
      await window.nahidaAPI?.invoke(IpcChannel.TTS_CHUNK, {
        text: testText,
        emotion: 'neutral',
      });
      // 等待播放完成（简化：假设 3 秒）
      setTimeout(() => setIsPlaying(false), 3000);
    } catch (err) {
      console.error('[TTSPanel] test failed:', err);
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const panelStyle: React.CSSProperties = {
    width: 380,
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(46, 125, 50, 0.25)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const buttonStyle = (primary?: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    border: primary ? 'none' : '1px solid #ccc',
    borderRadius: 6,
    backgroundColor: primary ? '#4caf50' : '#fff',
    color: primary ? '#fff' : '#333',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.15s',
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={headerStyle}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#2e7d32' }}>
            🔊 语音控制
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: '#666',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {/* TTS 开关 */}
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 14, color: '#2e7d32', margin: 0 }}>语音合成</h3>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  当前状态：{ttsEnabled ? '已启用' : '已禁用'}
                </div>
              </div>
              <button
                style={{
                  ...buttonStyle(ttsEnabled),
                  width: 80,
                }}
                onClick={handleToggleTTS}
                disabled={saving}
              >
                {ttsEnabled ? '开启' : '关闭'}
              </button>
            </div>
          </section>

          {/* 适配器选择 */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>适配器</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={{
                  ...buttonStyle(ttsAdapter === 'edge-tts'),
                  flex: 1,
                  backgroundColor: ttsAdapter === 'edge-tts' ? '#4caf50' : '#fff',
                  color: ttsAdapter === 'edge-tts' ? '#fff' : '#333',
                }}
                onClick={() => handleSwitchAdapter('edge-tts')}
                disabled={saving}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>💻</div>
                <div>edge-tts</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>CPU</div>
              </button>
              <button
                style={{
                  ...buttonStyle(ttsAdapter === 'gpt-sovits'),
                  flex: 1,
                  backgroundColor: ttsAdapter === 'gpt-sovits' ? '#4caf50' : '#fff',
                  color: ttsAdapter === 'gpt-sovits' ? '#fff' : '#333',
                }}
                onClick={() => handleSwitchAdapter('gpt-sovits')}
                disabled={saving}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>🎵</div>
                <div>GPT-SoVITS</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>GPU</div>
              </button>
            </div>
          </section>

          {/* 试听 */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>试听</h3>
            <button
              style={buttonStyle(true)}
              onClick={handleTest}
              disabled={!ttsEnabled || isPlaying}
            >
              {isPlaying ? '🔈 播放中...' : '▶️ 试听纳西妲语音'}
            </button>
            {!ttsEnabled && (
              <div style={{ fontSize: 11, color: '#ef5350', marginTop: 8 }}>
                请先启用语音合成
              </div>
            )}
          </section>

          {/* 状态信息 */}
          <section>
            <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>状态</h3>
            <div style={{
              padding: 12,
              backgroundColor: '#f5f5f5',
              borderRadius: 6,
              fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>适配器：</span>
                <span style={{ fontWeight: 500 }}>{ttsAdapter}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>状态：</span>
                <span style={{ color: ttsEnabled ? '#2e7d32' : '#999', fontWeight: 500 }}>
                  {ttsEnabled ? '✅ 已启用' : '⏸️ 已暂停'}
                </span>
              </div>
              {ttsAdapter === 'gpt-sovits' && config?.voice?.gptsovitsApiUrl && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>API：</span>
                  <span style={{ fontWeight: 500 }}>{config.voice.gptsovitsApiUrl}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TTSPanel;