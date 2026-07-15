/**
 * 反馈模态框 —— v0.9.8 L4 产品外壳
 *
 * 职责：
 *   收集用户反馈（Bug 报告 / 功能建议 / 其他），写入项目 feedback/ 目录。
 *
 * 触发方式：
 *   Ctrl+Shift+F 全局快捷键（主进程监听，IPC 推送到渲染层）
 *
 * 设计：
 *   - 简洁：标题 + 类型 + 内容 + 提交按钮
 *   - 反馈文件命名：YYYYMMDD_HHMMSS_{type}.md
 *   - 存储位置：项目根目录 feedback/（方便用户查看）
 */

import React, { useState } from 'react';

interface FeedbackModalProps {
  onClose: () => void;
}

type FeedbackType = 'bug' | 'feature' | 'other';

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose }) => {
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      alert('请填写标题和内容');
      return;
    }

    setSubmitting(true);
    try {
      const res = await window.nahidaAPI?.invoke('feedback:submit', {
        type,
        title: title.trim(),
        content: content.trim(),
      }) as { ok: boolean } | undefined;

      if (res?.ok) {
        alert('感谢反馈！（花冠轻点）我会认真看的。');
        onClose();
      } else {
        throw new Error('submit failed');
      }
    } catch (err) {
      console.error('[FeedbackModal] submit failed:', err);
      alert('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

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
    width: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(46, 125, 50, 0.25)',
    padding: 24,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 13,
    marginTop: 4,
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 120,
    resize: 'vertical' as const,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  };

  const typeButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    border: active ? '1px solid #4caf50' : '1px solid #ddd',
    borderRadius: 6,
    backgroundColor: active ? '#e8f5e9' : '#fff',
    color: active ? '#2e7d32' : '#666',
    cursor: 'pointer',
    fontSize: 13,
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* 标题 */}
        <div style={{ fontSize: 18, fontWeight: 600, color: '#2e7d32', marginBottom: 20 }}>
          📝 反馈
        </div>

        {/* 类型选择 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>类型</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button style={typeButtonStyle(type === 'bug')} onClick={() => setType('bug')}>
              🐛 Bug
            </button>
            <button style={typeButtonStyle(type === 'feature')} onClick={() => setType('feature')}>
              ✨ 功能建议
            </button>
            <button style={typeButtonStyle(type === 'other')} onClick={() => setType('other')}>
              💬 其他
            </button>
          </div>
        </div>

        {/* 标题 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>标题</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={inputStyle}
            placeholder="一句话概括（如：Live2D 窗口偶现黑屏）"
            maxLength={100}
          />
        </div>

        {/* 内容 */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>内容</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={textareaStyle}
            placeholder="详细描述（如：复现步骤、期望行为、实际行为）"
          />
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 20px',
              border: '1px solid #ccc',
              borderRadius: 6,
              backgroundColor: '#fff',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 14,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 6,
              backgroundColor: submitting ? '#ccc' : '#4caf50',
              color: '#fff',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {submitting ? '提交中...' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;