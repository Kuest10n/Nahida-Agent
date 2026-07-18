/**
 * 多模态输出编排器（v2.5 全模态闭环）
 *
 * 职责：
 *   统一编排 Agent 回复的多模态输出：文本 → 动作 tag 抽取 → TTS → Live2D 表情映射
 *
 * 设计理念：
 *   - 文本是主输出（必须）
 *   - 动作 tag 从文本中正则抽取 → Live2D 表情/动作
 *   - 清洗后文本 → TTS 合成（带情绪参数）
 *   - 所有模态共享同一条消息 ID，时序对齐
 *
 * 不阻塞主流程：TTS 是异步的，文本先返回，语音后推。
 */

import type { NahidaEmotion } from '../../shared/types/emotion';

// ── 类型 ──────────────────────────────────────────────────────

/** 多模态输出单元 */
export interface MultimodalOutput {
  /** 消息 ID（与 session 消息 ID 对齐） */
  messageId: string;
  /** 原始文本（含动作 tag） */
  rawText: string;
  /** 清洗后文本（去除动作 tag 和情绪标签，供 TTS 用） */
  cleanText: string;
  /** 抽取到的动作 tag 列表（如 ['铃铛轻响', '花冠微垂']） */
  actionTags: string[];
  /** 情绪标签 */
  emotion: NahidaEmotion | null;
  /** TTS 音频 base64（异步推送，初始为空） */
  audioBase64?: string;
  /** 图片附件路径列表（vision 回复时可能有） */
  imagePaths?: string[];
}

// ── 常量 ──────────────────────────────────────────────────────

/** 动作 tag 正则：匹配（xxx）格式的中文括号 */
const ACTION_TAG_REGEX = /[（(]([^）)]{1,20})[）)]/g;

/** 情绪标签正则：匹配 [emotion:xxx] */
const EMOTION_TAG_REGEX = /\[emotion:(\w+)\]/g;

/** 情绪 → Live2D 表情映射（简化版，完整版在 action-map.ts） */
const EMOTION_TO_LIVE2D: Record<string, string> = {
  happy: 'smile',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  curious: 'curious',
  gentle: 'idle_blink',
  thinking: 'thinking',
  shy: 'shy',
  excited: 'excited',
  lonely: 'lonely',
  nostalgic: 'nostalgic',
};

// ── 核心函数 ──────────────────────────────────────────────────

/**
 * 从文本中抽取动作 tag
 *
 * 例：「你好呀～（铃铛轻响）」→ ['铃铛轻响']
 */
export function extractActionTags(text: string): string[] {
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(ACTION_TAG_REGEX);
  while ((match = regex.exec(text)) !== null) {
    const tag = match[1]?.trim();
    if (tag && tag.length > 0 && tag.length <= 20) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * 从文本中抽取情绪标签
 *
 * 例：「[emotion:happy] 今天天气真好～」→ 'happy'
 */
export function extractEmotion(text: string): NahidaEmotion | null {
  const match = EMOTION_TAG_REGEX.exec(text);
  if (match && match[1]) {
    return match[1] as NahidaEmotion;
  }
  return null;
}

/**
 * 清洗文本：去除动作 tag 和情绪标签
 *
 * 供 TTS 合成用，避免朗读「铃铛轻响」之类的动作描述。
 */
export function cleanTextForTTS(text: string): string {
  return text
    .replace(ACTION_TAG_REGEX, '')
    .replace(EMOTION_TAG_REGEX, '')
    .trim();
}

/**
 * 将情绪映射到 Live2D 表情
 */
export function emotionToLive2DExpression(emotion: NahidaEmotion | null): string | null {
  if (!emotion) return null;
  return EMOTION_TO_LIVE2D[emotion] ?? null;
}

/**
 * 构建完整的多模态输出
 *
 * 这是输出编排的入口：文本 → 抽取动作 → 抽取情绪 → 清洗 → 打包
 * TTS 和 Live2D 动作由调用方异步执行。
 */
export function buildMultimodalOutput(
  messageId: string,
  rawText: string,
  imagePaths?: string[],
): MultimodalOutput {
  const actionTags = extractActionTags(rawText);
  const emotion = extractEmotion(rawText);
  const cleanText = cleanTextForTTS(rawText);

  return {
    messageId,
    rawText,
    cleanText,
    actionTags,
    emotion,
    imagePaths,
  };
}

/**
 * 生成消息 ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
