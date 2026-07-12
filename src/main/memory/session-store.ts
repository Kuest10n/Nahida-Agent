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

// ── 模块状态 ──────────────────────────────────────────────────

/** 内存中的 session 数据（与 agent-core 的 sessionHistory 同步） */
const store = new Map<string, PersistedSession>();

/** 每个 session 的写盘定时器（debounce） */
const saveTimers = new Map<string, NodeJS.Timeout>();

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
 */
export function listSessions(): PersistedSession[] {
  if (!initialized) loadSessions();
  return Array.from(store.values())
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

// ── 写接口 ────────────────────────────────────────────────────

/**
 * 追加一条消息到 session（debounce 写盘）
 *
 * @param sessionId 会话 ID
 * @param role      消息角色
 * @param content   消息内容
 */
export function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  if (!initialized) loadSessions();

  const now = Date.now();
  let session = store.get(sessionId);

  if (!session) {
    session = { sessionId, lastActivity: now, messages: [] };
    store.set(sessionId, session);
  }

  session.lastActivity = now;
  session.messages.push({ role, content, timestamp: now });

  // debounce 写盘
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

  const now = Date.now();
  for (const [sessionId, session] of store) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      store.delete(sessionId);
      safeUnlink(path.join(SESSIONS_DIR, `${sessionId}.json`));
      console.log(`[SessionStore] cleaned expired session: ${sessionId}`);
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
 */
function scheduleSave(sessionId: string): void {
  const existing = saveTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    saveSession(sessionId);
    saveTimers.delete(sessionId);
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
}
