import React, { useState, memo } from 'react';
import type { Message, ImageAttachment, OcrConfidenceInfo } from './types';

/**
 * 消息气泡组件
 *
 * - 用户消息：靠右，绿色背景
 * - 助手消息：靠左，白色背景，带草绿边框
 * - v2.6: 用户消息支持渲染附带图片缩略图，点击可放大预览
 * - v2.15: 助手消息支持展示 OCR 文本 + 置信度高亮 + 视频元信息
 *
 * 性能：用 memo 包裹，流式输出时只有 message prop 变化的气泡才重渲染
 */

/** v2.15：根据置信度返回颜色（高绿/中黄/低红） */
function confidenceColor(conf: OcrConfidenceInfo): string {
  if (conf.average >= 85) return '#2e7d32'; // 高 - 绿
  if (conf.average >= 60) return '#f57c00'; // 中 - 橙
  return '#c62828'; // 低 - 红
}

/** v2.15：置信度等级标签 */
function confidenceLabel(conf: OcrConfidenceInfo): string {
  if (conf.average >= 85) return '可信';
  if (conf.average >= 60) return '一般';
  return '需核对';
}

/** 闪烁动画样式（提到模块级，避免每次渲染都重新插入 <style>） */
const BLINK_STYLE = (
  <style>{`
    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
  `}</style>
);

const MessageBubbleInner: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);

  return (
    <>
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
          {/* v2.6: 用户消息渲染附带图片 */}
          {isUser && message.images && message.images.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginBottom: message.content ? 8 : 0,
                flexWrap: 'wrap',
              }}
            >
              {message.images.map(img => (
                <img
                  key={img.id}
                  src={img.dataUrl}
                  alt={img.filename ?? 'attachment'}
                  onClick={() => setPreviewImage(img)}
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: 'cover',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: '1px solid #a5d6a7',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(46, 125, 50, 0.25)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              ))}
            </div>
          )}

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

          {/* v2.15: 视频分析元信息 */}
          {!isUser && message.videoMeta && (
            <div
              style={{
                marginTop: 8,
                padding: '6px 10px',
                background: '#f1f8e9',
                borderRadius: 8,
                border: '1px solid #dcedc8',
                fontSize: 12,
                color: '#558b2f',
              }}
            >
              📹 视频 · {message.videoMeta.duration.toFixed(1)}s · {message.videoMeta.frameCount} 帧
              {message.videoMeta.strategy && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>
                  （{message.videoMeta.strategy === 'scene' ? '场景切换' : message.videoMeta.strategy === 'mixed' ? '混合' : '均匀'}抽帧）
                </span>
              )}
            </div>
          )}

          {/* v2.15: OCR 文本展示 + 置信度高亮 */}
          {!isUser && message.ocrText && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#faf5e6',
                borderRadius: 8,
                border: `1px solid ${message.ocrConfidence ? confidenceColor(message.ocrConfidence) : '#e0d6b8'}33`,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontSize: 11,
                }}
              >
                <span style={{ color: '#795548', fontWeight: 600 }}>📝 OCR 识别</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {/* v2.20：语言标签 */}
                  {message.ocrLanguage && (
                    <span
                      style={{
                        color: '#5d4037',
                        padding: '1px 5px',
                        borderRadius: 6,
                        background: '#efebe9',
                        fontSize: 10,
                      }}
                      title={message.ocrLanguage.autoDetected ? '自动检测' : '手动指定'}
                    >
                      {message.ocrLanguage.code}{message.ocrLanguage.autoDetected ? ' ⚡' : ''}
                    </span>
                  )}
                  {/* v2.20：缓存命中标签 */}
                  {message.fromCache && (
                    <span
                      style={{
                        color: '#1565c0',
                        padding: '1px 5px',
                        borderRadius: 6,
                        background: '#e3f2fd',
                        fontSize: 10,
                      }}
                    >
                      缓存
                    </span>
                  )}
                  {message.ocrConfidence && (
                    <span
                      style={{
                        color: confidenceColor(message.ocrConfidence),
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 8,
                        background: confidenceColor(message.ocrConfidence) + '1a',
                      }}
                      title={`平均 ${message.ocrConfidence.average}% · 最低 ${message.ocrConfidence.minimum}% · 低置信度行 ${message.ocrConfidence.lowCount}/${message.ocrConfidence.totalLines}`}
                    >
                      {message.ocrConfidence.average}% · {confidenceLabel(message.ocrConfidence)}
                      {message.ocrConfidence.lowCount > 0 && ` · ${message.ocrConfidence.lowCount} 行需核对`}
                    </span>
                  )}
                  {/* v2.20：二次识别标签 */}
                  {message.ocrRerecognize && message.ocrRerecognize.improvedCount > 0 && (
                    <span
                      style={{
                        color: '#2e7d32',
                        padding: '1px 5px',
                        borderRadius: 6,
                        background: '#e8f5e9',
                        fontSize: 10,
                      }}
                      title={`重识别 ${message.ocrRerecognize.rerecognizedCount} 行，改进 ${message.ocrRerecognize.improvedCount} 行`}
                    >
                      ✓ 改进 {message.ocrRerecognize.improvedCount} 行
                    </span>
                  )}
                </div>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'inherit',
                  color: '#3e2723',
                }}
              >
                {message.ocrText}
              </pre>
            </div>
          )}
        </div>

        {/* 闪烁动画样式（模块级常量，避免重复插入） */}
        {BLINK_STYLE}
      </div>

      {/* v2.6: 图片放大预览（点击缩略图后弹出） */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            padding: 20,
          }}
        >
          <img
            src={previewImage.dataUrl}
            alt={previewImage.filename ?? 'preview'}
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: 8,
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
              objectFit: 'contain',
            }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            aria-label="关闭预览"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
          {previewImage.filename && (
            <div
              style={{
                position: 'absolute',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: 12,
                fontSize: 12,
                maxWidth: '80%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {previewImage.filename}
            </div>
          )}
        </div>
      )}
    </>
  );
};

/** memo 包裹：message prop 不变时跳过重渲染（流式输出时只有当前消息在变） */
export const MessageBubble = memo(MessageBubbleInner);
