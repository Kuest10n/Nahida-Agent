/**
 * TTS 调度器
 *
 * 职责：
 *   - 串行队列避免并发卡顿（edge-tts 单次 1-3 秒，并发会堆积）
 *   - LRU 缓存避免重复合成（同一句话不重复请求）
 *   - 失败降级（适配器失败 → 返回 null → 调用方静默，不阻塞主流程）
 *
 * 借鉴 xiaoda-agent tts_engine.py：
 *   - hash key 缓存（VoiceCache.makeKey）
 *   - 失败不抛异常，返回 null 让上层决定
 *
 * 使用方式：
 *   const scheduler = new TtsScheduler();
 *   const result = await scheduler.enqueue({ text, emotion, sessionId });
 *   if (result) { mainWindow.send(TTS_CHUNK, { audioBase64: result.audioBase64, ... }) }
 */

import { NahidaEmotion } from '../../shared/types/emotion';
import type { TtsRequest, TtsResult, TtsAdapter } from './index';
import { VoiceCache } from './voice-cache';

export class TtsScheduler {
  private readonly adapter: TtsAdapter;
  private readonly cache: VoiceCache;

  /** 串行队列：用 Promise 链保证一次只处理一个合成任务 */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(adapter: TtsAdapter, cacheMaxSize = 100) {
    this.adapter = adapter;
    this.cache = new VoiceCache(cacheMaxSize);
  }

  /**
   * 入队合成请求
   *
   * @returns 合成结果；失败或适配器禁用时返回 null
   */
  enqueue(request: TtsRequest): Promise<TtsResult | null> {
    // 串行：把任务接到队列末尾
    const result = this.queueTail.then(() => this.process(request));
    // 无论成功失败，都更新队列尾部（避免一次失败卡死后续所有任务）
    this.queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 清空缓存（/clear 命令时调用） */
  clearCache(): void {
    this.cache.clear();
  }

  // ── 内部处理 ────────────────────────────────────────────

  private async process(request: TtsRequest): Promise<TtsResult | null> {
    const { text, emotion, sessionId } = request;

    // 空文本直接返回（避免无意义合成）
    if (!text.trim()) {
      return null;
    }

    // 适配器未启用 → 静默跳过
    if (!this.adapter.enabled) {
      return null;
    }

    const startedAt = Date.now();

    // 1. 查缓存
    const cacheKey = VoiceCache.makeKey(text, emotion);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[TTS] cache hit (session=${sessionId}, emotion=${emotion})`);
      return {
        audioBase64: cached.audioBase64,
        format: cached.format,
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
      };
    }

    // 2. 调适配器合成
    const synthesized = await this.adapter.synthesize(text, emotion);
    if (synthesized === null) {
      console.log(`[TTS] adapter failed, fallback to silent (session=${sessionId})`);
      return null;
    }

    // 3. 写缓存
    this.cache.set(cacheKey, {
      audioBase64: synthesized.audioBase64,
      format: synthesized.format,
    });

    const latencyMs = Date.now() - startedAt;
    console.log(`[TTS] synthesized (session=${sessionId}, emotion=${emotion}, ${latencyMs}ms, ${synthesized.format})`);

    return {
      audioBase64: synthesized.audioBase64,
      format: synthesized.format,
      visemeData: synthesized.visemeData,
      latencyMs,
      cacheHit: false,
    };
  }
}
