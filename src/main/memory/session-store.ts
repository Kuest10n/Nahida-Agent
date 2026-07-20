/**
 * Session 持久化存储 —— T10
 *
 * 职责：
 *   把 agent-core 的 sessionHistory 从纯内存落到磁盘，重启后可恢复。
 *
 * 设计：
 *   - 每个 session 一个 JSON 文件，放在 data/sessions/{sessionId}.json
 *   - debounce 批量写（500ms），避免每条消息都触发 IO
 *   - 启动时扫描目录加载所有 session（按 lastActivity 排序）
 *   - 过期 session 自动清理（30分钟无活动，与 router 一致）
 *
 * 纯文件 IO，不占 GPU。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

/** 持久化的 session 数据（文件格式） */
export interface PersistedSession {
  /** session ID */
  sessionId: string;
  /** 最后活动时间戳（ms） */
  lastActivity: number;
  /** 对话消息列表（user + assistant 交替） */
  messages: PersistedMessage[];
}

/** 持久化的单条消息 */
export interface PersistedMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 消息时间戳（ms） */
  timestamp: number;
  /** 循环日志（T/F/Tk/R 四段，仅 assistant 消息有） */
  cycleLog?: CycleLogEntry[];
  /** v2.5: 附带的图片路径列表（存 data/media/ 下的相对路径） */
  images?: string[];
}

/** 循环日志条目（与 agent-core 的 CycleLogEntry 对齐） */
export interface CycleLogEntry {
  phase: 'T' | 'F' | 'Tk' | 'R';
  ts: number;
  durationMs: number;
  summary: string;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 持久化目录（相对项目根） */
const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');

/** debounce 写盘延迟（ms） */
const SAVE_DEBOUNCE_MS = 500;

/** session 过期时间（ms），超过无活动则清理，与 router 保持一致 */
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟

/** 最大保留的 session 文件数（防磁盘爆炸） */
const MAX_SESSIONS_ON_DISK = 50;

/** 排序缓存：上次排序后的数组 + 版本号，避免每次 listSessions 都 O(n log n) */
let sortedCache: PersistedSession[] | null = null;
let sortedCacheVersion = 0;
let currentVersion = 0;

// ── 模块状态 ──────────────────────────────────────────────────

/** 内存中的 session 数据（与 agent-core 的 sessionHistory 同步） */
const store = new Map<string, PersistedSession>();

/** 每个 session 的写盘定时器（debounce） */
const saveTimers = new Map<string, NodeJS.Timeout>();

/** 每个 session 的写盘互斥锁（防止并发写入） */
const storeMutex = new Map<string, Promise<void>>();

/** 是否已初始化 */
let initialized = false;

// ── 初始化 ────────────────────────────────────────────────────

/**
 * 启动时从磁盘加载所有 session
 *
 * 重复调用安全（已初始化则跳过）。
 * 目录不存在会自动创建。
 * 过期的 session 不加载，直接删文件。
 */
export function loadSessions(): void {
  if (initialized) return;

  try {
    // 确保目录存在
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      initialized = true;
      return;
    }

    // 先从紧急备份恢复（上次崩了的话）
    recoverFromEmergency();

    const now = Date.now();
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(SESSIONS_DIR, f));

    // 读取所有 session 文件
    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(raw) as PersistedSession;

        // 过期则删文件，不加载
        if (now - session.lastActivity > SESSION_TTL_MS) {
          safeUnlink(filePath);
          continue;
        }

        store.set(session.sessionId, session);
      } catch {
        // 损坏的文件直接删
        safeUnlink(filePath);
      }
    }

    initialized = true;
    console.log(`[SessionStore] loaded ${store.size} sessions from disk`);
    markDirty();
  } catch (err) {
    console.error('[SessionStore] load failed:', err);
    initialized = true;
  }
}

// ── 读接口 ────────────────────────────────────────────────────

/**
 * 获取 session 的消息历史
 *
 * @returns 消息数组，不存在返回空数组
 */
export function getSessionMessages(sessionId: string): PersistedMessage[] {
  if (!initialized) loadSessions();
  const session = store.get(sessionId);
  return session ? session.messages : [];
}

/**
 * 获取最后活动时间
 */
export function getLastActivity(sessionId: string): number | undefined {
  if (!initialized) loadSessions();
  return store.get(sessionId)?.lastActivity;
}

/**
 * 列举所有 session（按 lastActivity 倒序）
 *
 * 优化：使用版本号缓存排序结果，数据不变时 O(1) 返回
 */
export function listSessions(): PersistedSession[] {
  if (!initialized) loadSessions();

  // 缓存命中：版本号一致时直接返回缓存
  if (sortedCache !== null && sortedCacheVersion === currentVersion) {
    return sortedCache;
  }

  // 缓存失效：重新排序
  const sorted = Array.from(store.values())
    .sort((a, b) => b.lastActivity - a.lastActivity);

  sortedCache = sorted;
  sortedCacheVersion = currentVersion;

  return sorted;
}

/**
 * 标记数据变更，使排序缓存失效
 * 每次修改 store 后调用，版本号 +1
 */
function markDirty(): void {
  currentVersion++;
  // 不立即清空缓存，等下次 listSessions 时再重算（延迟计算）
}

// ── 写接口 ────────────────────────────────────────────────────

/**
 * 追加一条消息到 session（debounce 写盘）
 *
 * @param sessionId 会话 ID
 * @param role      消息角色
 * @param content   消息内容
 * @param cycleLog  循环日志（仅 assistant 消息，可选）
 */
export function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  cycleLog?: CycleLogEntry[],
  /** v2.5: 附带的图片路径列表 */
  images?: string[],
): void {
  if (!initialized) loadSessions();

  const now = Date.now();
  let session = store.get(sessionId);

  if (!session) {
    session = { sessionId, lastActivity: now, messages: [] };
    store.set(sessionId, session);
    markDirty();
  }

  session.lastActivity = now;
  session.messages.push({ role, content, timestamp: now, cycleLog, images });
  // 注意：lastActivity 变化可能影响排序，但为了性能不每次都 markDirty
  // listSessions() 缓存可能短暂不一致，下次新增/删除 session 时会修正

  // debounce 写盘（scheduleSave 内部自己处理互斥锁）
  scheduleSave(sessionId);
}

/**
 * 清空指定 session 的历史（/clear 命令用）
 */
export function clearSession(sessionId: string): void {
  const session = store.get(sessionId);
  if (!session) return;

  session.messages = [];
  session.lastActivity = Date.now();
  scheduleSave(sessionId);
  markDirty();

  // 同时删磁盘文件
  safeUnlink(path.join(SESSIONS_DIR, `${sessionId}.json`));
}

/**
 * 清理过期 session（内存 + 磁盘）
 *
 * 可定期调用，或在每次写入时顺便检查。
 */
export function cleanupExpired(): void {
  if (!initialized) return;

  let changed = false;
  const now = Date.now();
  for (const [sessionId, session] of store) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      store.delete(sessionId);
      safeUnlink(path.join(SESSIONS_DIR, `${sessionId}.json`));
      console.log(`[SessionStore] cleaned expired session: ${sessionId}`);
      changed = true;
    }
  }

  // 超过最大数量时，删最旧的
  if (store.size > MAX_SESSIONS_ON_DISK) {
    const sorted = listSessions();
    const toDelete = sorted.slice(MAX_SESSIONS_ON_DISK);
    for (const session of toDelete) {
      store.delete(session.sessionId);
      safeUnlink(path.join(SESSIONS_DIR, `${session.sessionId}.json`));
    }
    changed = true;
  }

  if (changed) {
    markDirty();
  }
}

// ── 内部方法 ──────────────────────────────────────────────────

/**
 * 安全删除文件（吞掉异常，用于清理场景）
 */
function safeUnlink(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

/**
 * debounce 写盘：500ms 内多次追加合并为一次写入
 *
 * 注意：debounce 只负责"调度时机"，不负责"串行化"。
 * 串行化由 saveSession 内部的 storeMutex 保证。
 * 这样即使多个 appendMessage 并发，debounce 合并后只写一次，
 * 且写的是最终的内存状态（不会丢数据）。
 */
function scheduleSave(sessionId: string): void {
  const existing = saveTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    saveTimers.delete(sessionId);
    // 用互斥锁串行化写盘 IO
    const prev = storeMutex.get(sessionId) ?? Promise.resolve();
    const next = prev.finally(() => saveSession(sessionId))
      .finally(() => {
        // 只有这是最后一个 Promise 时才清掉互斥锁
        if (storeMutex.get(sessionId) === next) {
          storeMutex.delete(sessionId);
        }
      });
    storeMutex.set(sessionId, next);
  }, SAVE_DEBOUNCE_MS);

  saveTimers.set(sessionId, timer);
}

/**
 * 立即写盘单个 session（原子写，防崩机/断电导致 json 损坏）
 *
 * 原子写流程：写 .tmp → rename 到正式文件
 * rename 在同卷 NTFS/ext4 上是原子操作，崩机最多丢 .tmp 不影响主 json
 */
function saveSession(sessionId: string): void {
  const session = store.get(sessionId);
  if (!session) return;

  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    const tmpPath = `${filePath}.tmp`;

    // 1. 先写到 .tmp 文件
    fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
    // 2. rename 原子替换（同卷 NTFS 原子，跨卷不保证但 SESSIONS_DIR 在 process.cwd 下同卷）
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[SessionStore] save ${sessionId} failed:`, err);
    // 失败时清理 .tmp 残留（忽略错误）
    try { fs.unlinkSync(path.join(SESSIONS_DIR, `${sessionId}.json.tmp`)); } catch { /* ignore */ }
  }
}

/** 重置模块状态（测试用） */
export function resetSessionStore(): void {
  // 清所有定时器
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  store.clear();
  initialized = false;
  markDirty();
}

// ── 紧急写盘（崩溃自愈）────────────────────────────────────────
//
// 在渲染进程崩溃、主进程退出等紧急场景下调用。
// 跳过 debounce，立即把所有待写的 session 刷到磁盘。
// 同步执行，确保在进程退出前完成 IO。

/**
 * 紧急写盘：把所有内存中的 session 立即刷到磁盘
 *
 * 跳过 debounce 和互斥锁，同步写入，用于崩溃前最后一搏。
 * 只写 .tmp 文件（不 rename），避免中途崩了破坏主文件；
 * 下次启动时 loadSessions() 会自动恢复 .tmp 文件。
 */
export function emergencyFlush(): number {
  if (!initialized) return 0;

  let flushed = 0;

  // 清掉所有 pending 定时器（没用了）
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  storeMutex.clear();

  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    for (const [sessionId, session] of store) {
      try {
        const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
        const tmpPath = `${filePath}.emergency`;
        // 只写 .emergency，不 rename —— 崩一半也不破坏已有的好文件
        fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
        flushed++;
      } catch {
        // 单个失败不影响其他
      }
    }

    console.warn(`[SessionStore] emergencyFlush: flushed ${flushed} sessions (crash recovery)`);
  } catch (err) {
    console.error('[SessionStore] emergencyFlush failed:', err);
  }

  return flushed;
}

/**
 * 从紧急备份恢复：启动时扫描 .emergency 文件，与主文件对比取新的
 *
 * 在 loadSessions() 内部调用，外部不用关心。
 */
function recoverFromEmergency(): void {
  if (!fs.existsSync(SESSIONS_DIR)) return;

  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.emergency'));
    let recovered = 0;

    for (const tmpFile of files) {
      const tmpPath = path.join(SESSIONS_DIR, tmpFile);
      const mainPath = tmpPath.replace(/\.emergency$/, '');

      try {
        const tmpMtime = fs.statSync(tmpPath).mtimeMs;
        let mainMtime = 0;
        if (fs.existsSync(mainPath)) {
          mainMtime = fs.statSync(mainPath).mtimeMs;
        }

        // 紧急备份比主文件新 → 用备份替换主文件
        if (tmpMtime > mainMtime) {
          fs.renameSync(tmpPath, mainPath);
          recovered++;
        } else {
          // 主文件更新 → 删备份
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // 单个失败跳过
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    }

    if (recovered > 0) {
      console.warn(`[SessionStore] recovered ${recovered} sessions from emergency backup`);
    }
  } catch {
    // 恢复失败不影响启动
  }
}
