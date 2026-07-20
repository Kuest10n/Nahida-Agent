import React, { useState, useRef, useCallback, KeyboardEvent, DragEvent, ClipboardEvent, ChangeEvent } from 'react';
import type { ImageAttachment } from './types';
import { generateImageId } from './types';

/** 单张图片最大 10MB（base64 后约 13MB） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 支持的 MIME 类型 */
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * 输入栏组件
 *
 * - 文本框支持回车发送
 * - 发送中禁用按钮
 * - 简洁的草绿色主题
 * - v2.6: 📎按钮 + 拖拽 + 粘贴 支持图片上传
 */
export const InputBar: React.FC<{
  onSend: (message: string, images?: ImageAttachment[]) => void;
  disabled?: boolean;
}> = ({ onSend, disabled }) => {
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 图片转 ImageAttachment ─────────────────────────────
  const fileToAttachment = useCallback(async (file: File, source: 'file' | 'clipboard' | 'drag'): Promise<ImageAttachment | null> => {
    if (!SUPPORTED_MIME.has(file.type)) {
      setError(`不支持的图片格式: ${file.type}（仅 PNG/JPEG/WebP/GIF）`);
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`图片过大: ${(file.size / 1024 / 1024).toFixed(1)}MB，最大 10MB`);
      return null;
    }
    try {
      const base64 = await readFileAsBase64(file);
      return {
        id: generateImageId(),
        dataUrl: `data:${file.type};base64,${base64}`,
        base64,
        mimeType: file.type,
        filename: file.name,
        source,
      };
    } catch (err) {
      setError(`读取图片失败: ${String(err)}`);
      return null;
    }
  }, []);

  const addFiles = useCallback(async (files: FileList | File[], source: 'file' | 'clipboard' | 'drag') => {
    setError(null);
    const fileArr = Array.from(files);
    const newAttachments: ImageAttachment[] = [];
    for (const file of fileArr) {
      const att = await fileToAttachment(file, source);
      if (att) newAttachments.push(att);
    }
    if (newAttachments.length > 0) {
      setPendingImages(prev => [...prev, ...newAttachments]);
    }
  }, [fileToAttachment]);

  // ── 文件选择按钮 ───────────────────────────────────────
  const handleButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void addFiles(e.target.files, 'file');
    }
    // 清空 input value 以便重复选同一张图
    e.target.value = '';
  }, [addFiles]);

  // ── 拖拽 ───────────────────────────────────────────────
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files, 'drag');
    }
  }, [disabled, addFiles]);

  // ── 粘贴 ───────────────────────────────────────────────
  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addFiles(imageFiles, 'clipboard');
    }
  }, [addFiles]);

  // ── 删除待发送图片 ─────────────────────────────────────
  const handleRemoveImage = useCallback((id: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // ── 发送 ───────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    const hasText = trimmed.length > 0;
    const hasImages = pendingImages.length > 0;
    if ((!hasText && !hasImages) || disabled) return;

    onSend(trimmed, hasImages ? pendingImages : undefined);
    setInput('');
    setPendingImages([]);
    setError(null);
  }, [input, pendingImages, disabled, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const canSend = !disabled && (input.trim().length > 0 || pendingImages.length > 0);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        padding: '10px 16px 12px',
        borderTop: '1px solid #e8f5e9',
        backgroundColor: isDragging ? '#f1f8e9' : '#fff',
        transition: 'background-color 0.15s',
        position: 'relative',
      }}
    >
      {/* 拖拽提示遮罩 */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(102, 187, 106, 0.12)',
            border: '2px dashed #66bb6a',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2e7d32',
            fontSize: 14,
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          释放鼠标以添加图片
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div
          style={{
            marginBottom: 6,
            padding: '6px 10px',
            background: '#ffebee',
            border: '1px solid #ef9a9a',
            borderRadius: 6,
            color: '#c62828',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* 待发送图片缩略图条 */}
      {pendingImages.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          {pendingImages.map(img => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: 64,
                height: 64,
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid #c8e6c9',
              }}
            >
              <img
                src={img.dataUrl}
                alt={img.filename ?? 'pending'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                onClick={() => handleRemoveImage(img.id)}
                disabled={disabled}
                aria-label="移除图片"
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(0, 0, 0, 0.55)',
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: '18px',
                  padding: 0,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                ×
              </button>
              <span
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'rgba(0, 0, 0, 0.55)',
                  color: '#fff',
                  fontSize: 10,
                  padding: '1px 4px',
                  textAlign: 'center',
                }}
              >
                {img.source === 'clipboard' ? '剪贴板' : img.source === 'drag' ? '拖拽' : '文件'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* 隐藏的文件选择 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* 📎 上传按钮 */}
        <button
          onClick={handleButtonClick}
          disabled={disabled}
          aria-label="上传图片"
          title="上传图片（支持拖拽 / 粘贴）"
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: '50%',
            border: '1px solid #c8e6c9',
            backgroundColor: disabled ? '#f5f5f5' : '#fff',
            color: disabled ? '#bdbdbd' : '#2e7d32',
            fontSize: 16,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.2s, border-color 0.2s',
          }}
          onMouseEnter={e => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#f1f8e9';
              e.currentTarget.style.borderColor = '#81c784';
            }
          }}
          onMouseLeave={e => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#fff';
              e.currentTarget.style.borderColor = '#c8e6c9';
            }
          }}
        >
          📎
        </button>

        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={pendingImages.length > 0 ? '可附带说明（可空，直接发送）...' : '说点什么，或粘贴/拖拽图片...'}
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
          disabled={!canSend}
          style={{
            padding: '10px 20px',
            borderRadius: 20,
            border: 'none',
            backgroundColor: canSend ? '#66bb6a' : '#e0e0e0',
            color: '#fff',
            fontSize: 14,
            cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.2s',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
};

// ── 工具函数 ──────────────────────────────────────────────

/** 读取 File 为 base64 字符串（不含 data: 前缀） */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader 返回非字符串'));
        return;
      }
      // 去掉 "data:image/xxx;base64," 前缀
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 错误'));
    reader.readAsDataURL(file);
  });
}
