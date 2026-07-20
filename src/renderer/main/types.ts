/**
 * 消息类型定义
 *
 * 支持用户消息和助手消息，助手消息支持流式输出
 * v2.6: 支持多模态消息（用户消息附带图片）
 * v2.15: 支持展示 OCR 文本 + 置信度高亮
 */

/** 图片附件（渲染层用） */
export interface ImageAttachment {
  /** 在消息中的唯一标识 */
  id: string;
  /** 用于显示的 data URL（带前缀 data:image/xxx;base64,） */
  dataUrl: string;
  /** 不带前缀的 base64，发送给主进程用 */
  base64: string;
  /** MIME 类型 */
  mimeType: string;
  /** 原始文件名（可选） */
  filename?: string;
  /** 来源：file / clipboard / drag */
  source: 'file' | 'clipboard' | 'drag';
}

/** v2.15：OCR 置信度摘要（来自主进程） */
export interface OcrConfidenceInfo {
  /** 平均置信度（0-100） */
  average: number;
  /** 最低置信度（0-100） */
  minimum: number;
  /** 低置信度行数 */
  lowCount: number;
  /** 总行数 */
  totalLines: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 动作 tag（从内容末尾括号抽取） */
  actionTag?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** v2.6: 用户消息附带的图片列表 */
  images?: ImageAttachment[];
  /** v2.15: 助手消息附带的 OCR 文本（图片/视频识别结果） */
  ocrText?: string;
  /** v2.15: OCR 置信度摘要 */
  ocrConfidence?: OcrConfidenceInfo;
  /** v2.20: OCR 二次识别信息 */
  ocrRerecognize?: {
    rerecognizedCount: number;
    improvedCount: number;
  };
  /** v2.20: OCR 语言检测信息 */
  ocrLanguage?: {
    code: string;
    autoDetected: boolean;
  };
  /** v2.20: 是否来自缓存命中 */
  fromCache?: boolean;
  /** v2.15: 视频分析元信息（仅视频消息） */
  videoMeta?: {
    frameCount: number;
    duration: number;
    strategy?: 'scene' | 'uniform' | 'mixed';
  };
}

/** 生成唯一消息 ID */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成唯一图片附件 ID */
export function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从消息内容末尾抽取动作 tag */
export function extractActionTag(content: string): string | undefined {
  const match = content.match(/（([^）]+)）\s*$/);
  return match?.[1];
}