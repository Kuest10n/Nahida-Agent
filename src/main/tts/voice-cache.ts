/**
 * TTS 语音缓存（LRU）
 *
 * 借鉴 xiaoda-agent tts_engine.py 的缓存设计：
 *   - hash key = md5(emotion + text)，避免长文本做 key
 *   - LRU 淘汰策略，限制内存占用
 *
 * 第一阶段只做内存缓存，不持久化到磁盘（避免文件 IO，简化逻辑）；
 * 后续如需跨会话复用，再加 cache_index.json 持久化
 */

import { createHash } from 'node:crypto';
import { NahidaEmotion } from '../../shared/types/emotion';

/** 缓存条目：音频 base64 + 格式 */
export interface CacheEntry {
  audioBase64: string;
  format: string;
}

const DEFAULT_MAX_SIZE = 100;

export class VoiceCache {
  /** Map 的插入顺序即 LRU 顺序（最近用的在末尾） */
  private readonly cache: Map<string, CacheEntry>;
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * 生成缓存 key
   * 用 md5(emotion + text) 保证唯一性，避免长文本做 key 浪费内存
   */
  static makeKey(text: string, emotion: NahidaEmotion): string {
    return createHash('md5')
      .update(`${emotion}:${text}`)
      .digest('hex');
  }

  /** 查缓存：命中返回条目并移到末尾（LRU），未命中返回 undefined */
  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    // 移到末尾表示最近使用
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  /** 写缓存：超过上限淘汰最旧（Map 的第一个 key） */
  set(key: string, entry: CacheEntry): void {
    // 已存在则先删，确保移到末尾
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧（Map 迭代器第一个 key）
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, entry);
  }

  /** 当前缓存条目数（用于监控） */
  get size(): number {
    return this.cache.size;
  }

  /** 清空缓存（/clear 命令时调用） */
  clear(): void {
    this.cache.clear();
  }
}
