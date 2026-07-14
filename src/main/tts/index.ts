/**
 * T8 TTS 调度模块入口
 *
 * 职责：
 *   - 接收四审层 C 维 voiceType，调度适配器合成语音
 *   - LRU 缓存避免重复合成
 *   - 队列串行避免并发卡顿
 *   - 适配器可切换：edge-tts（CPU 默认）/ GPT-SoVITS（GPU，Phase 2 主力）/ RVC（GPU，备选）
 *
 * 数据流：
 *   reviewLayer.emotion.voiceType
 *     → scheduler.enqueue(text, emotion)
 *     → adapter.synthesize(text, emotion)
 *     → { audioBase64, format, visemeData? }
 *     → IPC tts:chunk → 渲染层播放
 */

import { NahidaEmotion } from '../../shared/types/emotion';

// ── 类型定义 ────────────────────────────────────────────────

/** TTS 请求（调度器入参） */
export interface TtsRequest {
  /** 待合成文本（已清洗，无 actionTag/emotion 标签） */
  text: string;
  /** 情绪枚举（来自四审层 C 维） */
  emotion: NahidaEmotion;
  /** 会话 ID（用于日志追踪） */
  sessionId: string;
}

/** TTS 合成结果（调度器出参） */
export interface TtsResult {
  /** 音频 base64（不含 data: 前缀，渲染层自加） */
  audioBase64: string;
  /** 音频格式，如 'mp3' / 'wav' */
  format: string;
  /** viseme 口型数据（rhubarb 生成，无则为 undefined） */
  visemeData?: number[];
  /** 合成耗时（ms，用于性能监控） */
  latencyMs: number;
  /** 命中缓存标志 */
  cacheHit: boolean;
}

/** TTS 适配器接口（edge-tts / RVC 都实现这个接口） */
export interface TtsAdapter {
  /** 适配器名（用于日志） */
  readonly name: string;
  /** 是否启用（RVC 在训练期间禁用） */
  readonly enabled: boolean;
  /**
   * 合成语音
   * @returns 成功返回 TtsResult（不含 cacheHit 字段，由调度器填）；
   *          失败返回 null，调度器走降级
   */
  synthesize(text: string, emotion: NahidaEmotion): Promise<Omit<TtsResult, 'cacheHit' | 'latencyMs'> | null>;
}

// ── 统一导出 ────────────────────────────────────────────────

export { VoiceCache } from './voice-cache';
export { EdgeTtsAdapter } from './edge-tts-adapter';
export { GptSoVitsAdapter } from './gpt-sovits-adapter';
export { TtsScheduler } from './scheduler';
