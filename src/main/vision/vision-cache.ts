/**
 * Vision 分析结果 LRU 缓存模块（v2.20.0 / v3.0.1 优化）
 *
 * 避免相同图片（MD5 hash 相同）重复发送给模型分析。
 * 典型场景：
 *   - 屏幕监控帧差较小时，前后两帧可能几乎相同
 *   - 用户对同一张图片反复提问
 *   - 多次截图画面未变化
 *
 * 设计原则：
 *   - LRU（Least Recently Used）淘汰策略
 *   - 缓存 key = MD5(base64) + prompt 的组合 hash
 *   - 默认容量 50 条（约 50 次分析结果，内存开销可控）
 *   - TTL 5 分钟（屏幕内容会变化，过期缓存无意义）
 *   - 单条目最大 500KB，总内存上限 10MB（防止内存膨胀）
 *   - 缓存命中时跳过模型调用，直接返回上次结果
 *   - 线程安全（单线程 Node.js，无需锁）
 *
 * 为什么用 MD5 而不是直接比较 base64：
 *   - base64 字符串可能非常大（几 MB），比较性能差
 *   - MD5 哈希固定 32 字符，Map 查找 O(1)
 *   - crypto.createHash('md5') 是 Node.js 内置，零依赖
 *
 * v3.0.1 优化：
 *   - 单条目大小限制（MAX_ENTRY_BYTES），避免单个超大结果占满缓存
 *   - 总内存估算 + 软上限（MAX_TOTAL_BYTES），防止内存膨胀
 *   - 惰性过期清理：每次 get 时顺便清理所有过期条目，而不是只清理当前 key
 *   - 用 TextEncoder 估算字符串字节大小（比 JSON.stringify 快）
 */

import { createHash } from 'node:crypto';

// ── 常量 ──────────────────────────────────────────────────────

/** 默认最大缓存条数 */
const DEFAULT_MAX_SIZE = 50;
/** 默认 TTL（ms） */
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟
/** 单条目最大字节数（默认 500KB） */
const DEFAULT_MAX_ENTRY_BYTES = 500 * 1024;
/** 总缓存最大字节数（默认 10MB） */
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** 惰性清理间隔：每 N 次 get 操作做一次全量过期清理 */
const CLEANUP_INTERVAL = 10;

const textEncoder = new TextEncoder();

// ── 类型 ──────────────────────────────────────────────────────

/** 缓存条目 */
interface CacheEntry<T> {
  /** 缓存结果 */
  result: T;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessedAt: number;
}

/** 缓存配置 */
export interface VisionCacheConfig {
  /** 最大缓存条数 */
  maxSize?: number;
  /** TTL（ms），超过此时间的条目自动失效 */
  ttlMs?: number;
  /** 是否启用缓存（默认 true） */
  enabled?: boolean;
  /** 单条目最大字节数，超过则不缓存（默认 500KB） */
  maxEntryBytes?: number;
  /** 总缓存最大字节数，超过则淘汰旧条目（默认 10MB） */
  maxTotalBytes?: number;
}

/** 缓存统计 */
export interface CacheStats {
  /** 当前缓存条数 */
  size: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率（0-1） */
  hitRate: number;
  /** 估算总内存占用（字节） */
  totalBytes: number;
  /** 因大小超限被拒绝的条目数 */
  rejectedBySize: number;
}

// ── LRU Cache 实现 ────────────────────────────────────────────

/**
 * 简单 LRU 缓存
 *
 * 用 Map 实现（Map 按插入顺序遍历，删除+重新插入可模拟 LRU）。
 * 不用第三方库（如 lru-cache），减少依赖。
 *
 * v3.0.1 优化：
 *   - 单条目大小限制，避免超大结果占满内存
 *   - 总内存软上限，超过则淘汰最旧条目
 *   - 惰性过期清理，每 CLEANUP_INTERVAL 次 get 做一次全量清理
 */
class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly maxEntryBytes: number;
  private readonly maxTotalBytes: number;
  private hits = 0;
  private misses = 0;
  private rejectedBySize = 0;
  private totalBytes = 0;
  private opsSinceCleanup = 0;

  constructor(maxSize: number, ttlMs: number, maxEntryBytes: number, maxTotalBytes: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.maxEntryBytes = maxEntryBytes;
    this.maxTotalBytes = maxTotalBytes;
  }

  /** 估算结果的字节大小（快速估算，不精确但足够） */
  private estimateSize(value: T): number {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16 估算
    }
    if (typeof value === 'object' && value !== null) {
      try {
        // 用 JSON 长度估算，比 textEncoder.encode(JSON.stringify(...)) 快
        return JSON.stringify(value).length * 1.5;
      } catch {
        return 1024; // 估算失败按 1KB 算
      }
    }
    return 64; // 简单类型
  }

  /** 惰性清理所有过期条目 */
  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        expiredKeys.push(key);
      } else {
        // Map 按插入顺序，第一个没过期的，后面都没过期
        break;
      }
    }

    for (const key of expiredKeys) {
      const entry = this.cache.get(key);
      if (entry) {
        this.totalBytes -= this.estimateSize(entry.result);
      }
      this.cache.delete(key);
    }
  }

  /** 获取缓存 */
  get(key: string): T | undefined {
    // 每隔 CLEANUP_INTERVAL 次操作做一次全量过期清理
    this.opsSinceCleanup++;
    if (this.opsSinceCleanup >= CLEANUP_INTERVAL) {
      this.opsSinceCleanup = 0;
      this.cleanupExpired();
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // TTL 检查
    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.totalBytes -= this.estimateSize(entry.result);
      this.misses++;
      return undefined;
    }

    // LRU：删除后重新插入，使其排到最后（最近使用）
    this.cache.delete(key);
    entry.lastAccessedAt = now;
    this.cache.set(key, entry);
    this.hits++;

    return entry.result;
  }

  /** 设置缓存 */
  set(key: string, result: T): void {
    const estimatedSize = this.estimateSize(result);

    // 单条目超限：直接不缓存
    if (estimatedSize > this.maxEntryBytes) {
      this.rejectedBySize++;
      return;
    }

    // 如果已存在，先删除（重新插入到末尾，并更新大小计数）
    const existing = this.cache.get(key);
    if (existing) {
      this.totalBytes -= this.estimateSize(existing.result);
      this.cache.delete(key);
    }

    // 淘汰最旧的条目（数量限制 + 总内存限制）
    while (
      this.cache.size >= this.maxSize ||
      (this.totalBytes + estimatedSize > this.maxTotalBytes && this.cache.size > 0)
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestEntry = this.cache.get(oldestKey);
        if (oldestEntry) {
          this.totalBytes -= this.estimateSize(oldestEntry.result);
        }
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    const now = Date.now();
    this.cache.set(key, {
      result,
      createdAt: now,
      lastAccessedAt: now,
    });
    this.totalBytes += estimatedSize;
  }

  /** 是否有缓存 */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.totalBytes -= this.estimateSize(entry.result);
      return false;
    }
    return true;
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.rejectedBySize = 0;
    this.totalBytes = 0;
    this.opsSinceCleanup = 0;
  }

  /** 当前大小 */
  get size(): number {
    return this.cache.size;
  }

  /** 获取统计 */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalBytes: this.totalBytes,
      rejectedBySize: this.rejectedBySize,
    };
  }
}

// ── Vision 缓存单例 ───────────────────────────────────────────

let cache: LRUCache<unknown> | null = null;
let cacheEnabled = true;

/**
 * 初始化缓存（应用启动时调用）
 */
export function initVisionCache(config?: VisionCacheConfig): void {
  cacheEnabled = config?.enabled ?? true;
  if (cacheEnabled) {
    const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
    const ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntryBytes = config?.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    const maxTotalBytes = config?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    cache = new LRUCache(maxSize, ttlMs, maxEntryBytes, maxTotalBytes);
    console.log(
      `[VisionCache] initialized: maxSize=${maxSize}, ttl=${ttlMs}ms, ` +
      `maxEntryBytes=${maxEntryBytes}, maxTotalBytes=${maxTotalBytes}`,
    );
  } else {
    cache = null;
    console.log('[VisionCache] disabled');
  }
}

/**
 * 计算缓存 key
 *
 * key = MD5(base64) + ":" + MD5(prompt)
 *
 * 这样相同图片 + 不同 prompt 会生成不同的 key（合理：
 * 用户对同一张图片问不同问题，不应返回旧答案）
 */
export function computeCacheKey(base64: string, prompt: string): string {
  const imageHash = createHash('md5').update(base64).digest('hex');
  const promptHash = createHash('md5').update(prompt).digest('hex');
  return `${imageHash}:${promptHash}`;
}

/**
 * 获取缓存结果
 *
 * @returns 缓存命中时返回结果，否则返回 undefined
 */
export function getVisionCache<T>(key: string): T | undefined {
  if (!cacheEnabled || !cache) return undefined;
  return cache.get(key) as T | undefined;
}

/**
 * 设置缓存结果
 */
export function setVisionCache<T>(key: string, result: T): void {
  if (!cacheEnabled || !cache) return;
  cache.set(key, result);
}

/**
 * 检查缓存是否存在
 */
export function hasVisionCache(key: string): boolean {
  if (!cacheEnabled || !cache) return false;
  return cache.has(key);
}

/**
 * 清空缓存（/clear 命令时调用）
 */
export function clearVisionCache(): void {
  if (cache) {
    cache.clear();
    console.log('[VisionCache] cleared');
  }
}

/**
 * 获取缓存统计
 */
export function getVisionCacheStats(): CacheStats {
  if (!cache) {
    return { size: 0, hits: 0, misses: 0, hitRate: 0, totalBytes: 0, rejectedBySize: 0 };
  }
  return cache.getStats();
}
