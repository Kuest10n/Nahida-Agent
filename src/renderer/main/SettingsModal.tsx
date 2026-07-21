/**
 * 设置模态框 —— v0.9.8 L4 产品外壳
 *
 * 职责：
 *   提供模型/感知/人格三 Tab 配置界面，修改后保存到配置文件。
 *
 * 布局：
 *   ┌────────────────────────────┐
 *   │ [模型] [感知] [人格]        │  ← Tab 栏
 *   ├────────────────────────────┤
 *   │                            │
 *   │  Tab 内容区                │
 *   │                            │
 *   ├────────────────────────────┤
 *   │      [取消] [保存]          │  ← 底部操作栏
 *   └────────────────────────────┘
 *
 * 设计：
 *   - 纯前端组件，状态由 props 传入，onSave 回调通知父组件
 *   - 样式继承须弥风格（草绿色主题）
 *   - Tab 切换用 useState，不用路由（轻量优先）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { IpcChannel } from '../../shared/types/ipc';
import type { Config } from '../../shared/types/config';

interface SettingsModalProps {
  /** 当前配置（从主进程获取） */
  config: Config | null;
  /** 保存回调 */
  onSave: (newConfig: Partial<Config>) => Promise<void>;
  /** 关闭回调 */
  onClose: () => void;
}

type TabKey = 'model' | 'perception' | 'personality' | 'connection';

/** Tab 配置 */
const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'model', label: '模型', icon: '🤖' },
  { key: 'perception', label: '感知', icon: '👁️' },
  { key: 'personality', label: '人格', icon: '🌱' },
  { key: 'connection', label: '连接', icon: '🔌' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  onSave,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('model');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 本地表单状态（深拷贝 config，避免直接修改 props）
  const [localConfig, setLocalConfig] = useState<Partial<Config>>({});

  // 初始化本地配置
  useEffect(() => {
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config)));
    }
  }, [config]);

  // ── 字段更新辅助函数 ────────────────────────────────────────

  const updateOllama = (key: keyof Config['ollama'], value: string | number) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      ollama: { ...prev.ollama!, [key]: value },
    }));
    setDirty(true);
  };

  const updateModels = (key: keyof Config['models'], value: string) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      models: { ...prev.models!, [key]: value },
    }));
    setDirty(true);
  };

  const updateVoice = (key: keyof Config['voice'], value: string) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      voice: { ...prev.voice!, [key]: value },
    }));
    setDirty(true);
  };

  const updateApi = (key: keyof Config['api'], value: string) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      api: { ...prev.api!, [key]: value },
    }));
    setDirty(true);
  };

  const updateEmail = (key: keyof Config['email'], value: string | number | boolean) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      email: { ...(prev.email ?? {}), [key]: value } as Config['email'],
    }));
    setDirty(true);
  };

  const updateMcpServers = (key: keyof Config['mcpServers'], value: string) => {
    setLocalConfig((prev: Partial<Config>) => ({
      ...prev,
      mcpServers: { ...(prev.mcpServers ?? {}), [key]: value } as Config['mcpServers'],
    }));
    setDirty(true);
  };

  // ── 保存 ──────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!dirty) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await onSave(localConfig);
      onClose();
    } catch (err) {
      console.error('[SettingsModal] save failed:', err);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // ── 渲染 ──────────────────────────────────────────────────────

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

  const modalStyle: React.CSSProperties = {
    width: 520,
    maxHeight: '80vh',
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(46, 125, 50, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '12px 20px',
    border: 'none',
    backgroundColor: active ? '#e8f5e9' : 'transparent',
    color: active ? '#2e7d32' : '#666',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 14,
    borderBottom: active ? '2px solid #4caf50' : '2px solid transparent',
    transition: 'all 0.15s',
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div
          style={{
            padding: '16px 20px 0',
            borderBottom: '1px solid #e0e0e0',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: '#2e7d32', marginBottom: 12 }}>
            ⚙ 设置
          </div>
          {/* Tab 栏 */}
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                style={tabStyle(activeTab === tab.key)}
                onClick={() => setActiveTab(tab.key)}
              >
                <span style={{ marginRight: 6 }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeTab === 'model' && (
            <ModelTab
              ollama={localConfig.ollama}
              models={localConfig.models}
              api={localConfig.api}
              onUpdateOllama={updateOllama}
              onUpdateModels={updateModels}
              onUpdateApi={updateApi}
            />
          )}
          {activeTab === 'perception' && (
            <PerceptionTab
              voice={localConfig.voice}
              onUpdateVoice={updateVoice}
            />
          )}
          {activeTab === 'personality' && (
            <PersonalityTab />
          )}
          {activeTab === 'connection' && (
            <ConnectionTab
              email={localConfig.email}
              mcpServers={localConfig.mcpServers}
              onUpdateEmail={updateEmail}
              onUpdateMcpServers={updateMcpServers}
            />
          )}
        </div>

        {/* 底部操作栏 */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 20px',
              border: '1px solid #ccc',
              borderRadius: 6,
              backgroundColor: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 14,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 6,
              backgroundColor: dirty ? '#4caf50' : '#ccc',
              color: '#fff',
              cursor: saving || !dirty ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 子 Tab 组件 ──────────────────────────────────────────────────

/** 模型 Tab */
const ModelTab: React.FC<{
  ollama?: Config['ollama'];
  models?: Config['models'];
  api?: Config['api'];
  onUpdateOllama: (key: keyof Config['ollama'], value: string | number) => void;
  onUpdateModels: (key: keyof Config['models'], value: string) => void;
  onUpdateApi: (key: keyof Config['api'], value: string) => void;
}> = ({ ollama, models, api, onUpdateOllama, onUpdateModels, onUpdateApi }) => {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 13,
    marginTop: 4,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: 'auto' as const,
    backgroundColor: '#fff',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  };

  // 自动检测 Ollama 模型列表
  const handleRefreshModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await window.nahidaAPI?.invoke(IpcChannel.OLLAMA_LIST_MODELS, {}) as {
        ok: boolean;
        models?: string[];
      } | undefined;
      if (res?.ok && res.models) {
        setAvailableModels(res.models);
      } else {
        setAvailableModels([]);
      }
    } catch (err) {
      console.error('[Settings] failed to list models:', err);
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // 组件挂载时自动检测
  useEffect(() => {
    handleRefreshModels();
  }, [handleRefreshModels]);

  return (
    <div>
      {/* Ollama 配置 */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>Ollama 服务</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Host</label>
            <input
              type="text"
              value={ollama?.host ?? ''}
              onChange={e => onUpdateOllama('host', e.target.value)}
              style={inputStyle}
              placeholder="localhost"
            />
          </div>
          <div>
            <label style={labelStyle}>Port</label>
            <input
              type="number"
              value={ollama?.port ?? ''}
              onChange={e => onUpdateOllama('port', parseInt(e.target.value, 10) || 11434)}
              style={inputStyle}
              placeholder="11434"
            />
          </div>
        </div>
      </section>

      {/* 模型配置 */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>
          模型选择
          <button
            onClick={handleRefreshModels}
            disabled={loadingModels}
            style={{
              marginLeft: 8,
              padding: '2px 8px',
              fontSize: 11,
              border: '1px solid #4caf50',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#4caf50',
              cursor: loadingModels ? 'not-allowed' : 'pointer',
            }}
          >
            {loadingModels ? '检测中...' : '🔄 刷新'}
          </button>
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>本地模型（Ollama）</label>
            {availableModels.length > 0 ? (
              <select
                value={models?.local ?? ''}
                onChange={e => onUpdateModels('local', e.target.value)}
                style={selectStyle}
              >
                <option value="">-- 选择模型 --</option>
                {availableModels.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={models?.local ?? ''}
                onChange={e => onUpdateModels('local', e.target.value)}
                style={inputStyle}
                placeholder={loadingModels ? '检测中...' : 'qwen3-8b-nahida'}
              />
            )}
          </div>
          <div>
            <label style={labelStyle}>审查模型</label>
            {availableModels.length > 0 ? (
              <select
                value={models?.review ?? ''}
                onChange={e => onUpdateModels('review', e.target.value)}
                style={selectStyle}
              >
                <option value="">-- 选择模型 --</option>
                {availableModels.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={models?.review ?? ''}
                onChange={e => onUpdateModels('review', e.target.value)}
                style={inputStyle}
                placeholder={loadingModels ? '检测中...' : 'qwen2.5-1.5b-review-lora-v3'}
              />
            )}
          </div>
          <div>
            <label style={labelStyle}>本地 GGUF 路径（可选）</label>
            <input
              type="text"
              value={models?.localModelPath ?? ''}
              onChange={e => onUpdateModels('localModelPath', e.target.value)}
              style={inputStyle}
              placeholder="./resources/ollama/models/qwen3-8b-nahida.gguf"
            />
          </div>
        </div>
      </section>

      {/* API Key */}
      <section>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>云端 API</h3>
        <div>
          <label style={labelStyle}>DeepSeek API Key（可选）</label>
          <input
            type="password"
            value={api?.deepseekKey ?? ''}
            onChange={e => onUpdateApi('deepseekKey', e.target.value)}
            style={inputStyle}
            placeholder="sk-..."
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
            用于云端模型调用（standard/flash tier）
          </div>
        </div>
      </section>
    </div>
  );
};

/** 感知 Tab */
const PerceptionTab: React.FC<{
  voice?: Config['voice'];
  onUpdateVoice: (key: keyof Config['voice'], value: string) => void;
}> = ({ voice, onUpdateVoice }) => {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 13,
    marginTop: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  };

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>语音合成（TTS）</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>TTS 适配器</label>
          <select
            value={voice?.ttsAdapter ?? 'edge-tts'}
            onChange={e => onUpdateVoice('ttsAdapter', e.target.value as Config['voice']['ttsAdapter'])}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="edge-tts">edge-tts（CPU，默认）</option>
            <option value="gpt-sovits">GPT-SoVITS（GPU，日常对话）</option>
          </select>
        </div>

        {voice?.ttsAdapter === 'gpt-sovits' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>API 地址</label>
              <input
                type="text"
                value={voice?.gptsovitsApiUrl ?? ''}
                onChange={e => onUpdateVoice('gptsovitsApiUrl', e.target.value)}
                style={inputStyle}
                placeholder="http://localhost:9880"
              />
            </div>
            <div>
              <label style={labelStyle}>模型目录</label>
              <input
                type="text"
                value={voice?.gptsovitsModelDir ?? ''}
                onChange={e => onUpdateVoice('gptsovitsModelDir', e.target.value)}
                style={inputStyle}
                placeholder="./resources/gpt-sovits/models"
              />
            </div>
          </div>
        )}

        {voice?.ttsAdapter === 'edge-tts' && (
          <div>
            <label style={labelStyle}>edge-tts 声音</label>
            <input
              type="text"
              value={voice?.edgeVoice ?? ''}
              onChange={e => onUpdateVoice('edgeVoice', e.target.value)}
              style={inputStyle}
              placeholder="zh-CN-XiaoyiNeural"
            />
          </div>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>RVC 声音转换</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>模型文件名</label>
            <input
              type="text"
              value={voice?.rvcModelName ?? ''}
              onChange={e => onUpdateVoice('rvcModelName', e.target.value)}
              style={inputStyle}
              placeholder="nahida_v0.3_100e.pth"
            />
          </div>
          <div>
            <label style={labelStyle}>RVC WebUI 根目录（外部依赖）</label>
            <input
              type="text"
              value={voice?.rvcRoot ?? ''}
              onChange={e => onUpdateVoice('rvcRoot', e.target.value)}
              style={inputStyle}
              placeholder="F:\\RVC20240604Nvidia"
            />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              用于 AI 翻唱 / 实时声换，需独立安装 RVC WebUI
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

/** 人格 Tab（占位，v0.9.8 只展示提示） */
const PersonalityTab: React.FC = () => {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🌱</div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>人格管理</div>
      <div style={{ fontSize: 12, color: '#999' }}>
        人格切换功能已在左下角提供，<br />
        详细管理界面将在 v1.1 实现。
      </div>
    </div>
  );
};

/** 连接 Tab —— 邮箱 + 第三方 MCP Server */
const ConnectionTab: React.FC<{
  email?: Config['email'];
  mcpServers?: Config['mcpServers'];
  onUpdateEmail: (key: keyof Config['email'], value: string | number | boolean) => void;
  onUpdateMcpServers: (key: keyof Config['mcpServers'], value: string) => void;
}> = ({ email, mcpServers, onUpdateEmail, onUpdateMcpServers }) => {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 13,
    marginTop: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  };

  return (
    <div>
      {/* 邮箱配置 */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>📧 邮箱（SMTP / IMAP）</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>SMTP 服务器</label>
            <input
              type="text"
              value={email?.smtpHost ?? ''}
              onChange={e => onUpdateEmail('smtpHost', e.target.value)}
              style={inputStyle}
              placeholder="smtp.qq.com"
            />
          </div>
          <div>
            <label style={labelStyle}>SMTP 端口</label>
            <input
              type="number"
              value={email?.smtpPort ?? ''}
              onChange={e => onUpdateEmail('smtpPort', parseInt(e.target.value, 10) || 0)}
              style={inputStyle}
              placeholder="465"
            />
          </div>
          <div>
            <label style={labelStyle}>IMAP 服务器</label>
            <input
              type="text"
              value={email?.imapHost ?? ''}
              onChange={e => onUpdateEmail('imapHost', e.target.value)}
              style={inputStyle}
              placeholder="imap.qq.com"
            />
          </div>
          <div>
            <label style={labelStyle}>IMAP 端口</label>
            <input
              type="number"
              value={email?.imapPort ?? ''}
              onChange={e => onUpdateEmail('imapPort', parseInt(e.target.value, 10) || 0)}
              style={inputStyle}
              placeholder="993"
            />
          </div>
          <div>
            <label style={labelStyle}>邮箱账号</label>
            <input
              type="text"
              value={email?.username ?? ''}
              onChange={e => onUpdateEmail('username', e.target.value)}
              style={inputStyle}
              placeholder="example@qq.com"
            />
          </div>
          <div>
            <label style={labelStyle}>邮箱密码 / 授权码</label>
            <input
              type="password"
              value={email?.password ?? ''}
              onChange={e => onUpdateEmail('password', e.target.value)}
              style={inputStyle}
              placeholder="授权码"
            />
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#999' }}>
          提示：QQ/163 等邮箱通常需要"授权码"而非登录密码
        </div>
      </section>

      {/* 第三方 MCP Server */}
      <section>
        <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>🔌 第三方 MCP Server</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>QQ MCP Server 路径（可选）</label>
            <input
              type="text"
              value={mcpServers?.qq ?? ''}
              onChange={e => onUpdateMcpServers('qq', e.target.value)}
              style={inputStyle}
              placeholder="C:\\go-cqhttp\\mcp-server.exe"
            />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              指向第三方 QQ Bot 的 MCP Server 可执行文件
            </div>
          </div>
          <div>
            <label style={labelStyle}>微信 MCP Server 路径（可选）</label>
            <input
              type="text"
              value={mcpServers?.wechat ?? ''}
              onChange={e => onUpdateMcpServers('wechat', e.target.value)}
              style={inputStyle}
              placeholder="C:\\wcferry\\mcp-server.exe"
            />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              指向第三方微信 Bot 的 MCP Server 可执行文件
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsModal;