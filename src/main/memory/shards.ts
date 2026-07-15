/**
 * 通用记忆分片加载器 —— T6 扩展
 *
 * 职责：
 *   加载 memory/ 下非 worldbook 的 7 个分片文件（纯 markdown，无 frontmatter）：
 *     User.md / fact.md / persona.md / emotion.md / skill.md / reflect.md / interest.md
 *
 * 设计原则（来自 .trae/rules/memory.md）：
 *   - 单文件 200-800 字，超了拆 worldbook entry
 *   - 项目 memory/ 是源，OpenClaw 是镜像（本模块只读源）
 *
 * 与 worldbook 的区别：
 *   - worldbook 是"按 trigger 召回"的条目集（动态注入）
 *   - 分片是"常驻背景"的全量文件（部分常驻 + 部分按需）
 *
 * 注入策略：
 *   - 常驻分片：User.md（用户画像，每轮都要知道）、persona.md（人格稳定部分）
 *   - 按需分片：fact.md（事实记录）、interest.md（兴趣偏好）等按相关性注入
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decryptString, encryptString, isEncryptionEnabled } from './crypto';

// ── 类型定义 ──────────────────────────────────────────────────

/** 记忆分片类型 */
export type ShardName =
  | 'User'          // 用户画像
  | 'fact-long'     // 长时事实（固定信息，常驻）
  | 'fact-mid'      // 中时事实（项目周期，按需）
  | 'fact-short'    // 短时事实（当日要点，按需，24h TTL）
  | 'persona'       // 人格稳定部分
  | 'emotion'       // 情绪记录
  | 'skill'         // 工具技能
  | 'reflect'       // 反思记录
  | 'interest';     // 兴趣偏好

/** 加载后的分片内容 */
export interface LoadedShard {
  /** 分片名（不含扩展名） */
  name: ShardName;
  /** 文件内容（纯 markdown，已 trim） */
  content: string;
  /** 内容字符数（用于控制注入 token） */
  length: number;
}

// ── 常量 ──────────────────────────────────────────────────────

/** memory 目录（相对项目根） */
const MEMORY_DIR = path.resolve(process.cwd(), 'memory');

/** 分片文件名 → 是否常驻 system prompt */
const SHARD_RESIDENT: Record<ShardName, boolean> = {
  User: true,           // 用户画像每轮都要知道
  persona: true,        // 人格稳定部分常驻
  'fact-long': true,    // 长时事实（固定信息）常驻
  'fact-mid': false,    // 中时事实按需
  'fact-short': false,  // 短时事实按需
  emotion: false,       // 情绪记录按需
  skill: false,         // 技能记录按需
  reflect: false,       // 反思记录按需
  interest: false,      // 兴趣偏好按需
};

// ── 模块状态 ──────────────────────────────────────────────────

/** 已加载的分片（按 name 索引） */
const loadedShards = new Map<ShardName, LoadedShard>();

/** 是否已初始化 */
let initialized = false;

// ── 加载逻辑 ──────────────────────────────────────────────────

/**
 * 启动时加载所有分片
 *
 * 重复调用安全（已加载则跳过）。
 * 文件不存在不报错，只 warning（部分分片可能尚未创建）。
 */
export function loadShards(): void {
  if (initialized) return;

  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      console.warn(`[Shards] dir not found: ${MEMORY_DIR}`);
      initialized = true;
      return;
    }

    for (const name of Object.keys(SHARD_RESIDENT) as ShardName[]) {
      const filePath = path.join(MEMORY_DIR, `${name}.md`);
      if (!fs.existsSync(filePath)) {
        console.warn(`[Shards] ${name}.md not found, skipped`);
        continue;
      }

      const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
      // 如果启用了加密，尝试解密（兼容明文旧文件）
      const content = isEncryptionEnabled() ? safeDecrypt(rawContent, `${name}.md`) : rawContent;
      loadedShards.set(name, {
        name,
        content: content.trim(),
        length: content.trim().length,
      });
    }

    initialized = true;
    console.log(`[Shards] loaded ${loadedShards.size} shards`);
  } catch (err) {
    console.error('[Shards] load failed:', err);
    initialized = true;
  }
}

/**
 * 获取常驻分片内容（拼到 system prompt）
 *
 * 包含 User.md + persona.md，让 LLM 知道用户画像和人格稳定部分。
 */
export function getResidentShards(): LoadedShard[] {
  if (!initialized) loadShards();

  const residents: LoadedShard[] = [];
  for (const [name, isResident] of Object.entries(SHARD_RESIDENT)) {
    if (!isResident) continue;
    const shard = loadedShards.get(name as ShardName);
    if (shard) residents.push(shard);
  }
  return residents;
}

/**
 * 按名获取单个分片（按需注入用）
 *
 * @returns 分片内容，不存在返回 undefined
 */
export function getShard(name: ShardName): LoadedShard | undefined {
  if (!initialized) loadShards();
  return loadedShards.get(name);
}

/**
 * 按需分片召回规则：分片名 → 关键词正则
 *
 * 命中关键词的分片会被注入 system prompt。
 * 新增分片只需在此表添加一条规则。
 */
const SHARD_RECALL_RULES: Array<{ name: ShardName; pattern: RegExp; desc: string }> = [
  // fact 三层：长时（固定信息）→ 中时（项目周期）→ 短时（当日要点）
  // recallShards 按此数组顺序返回，长时优先于中时优先于短时
  { name: 'fact-mid',   pattern: /项目|任务|进度|时间线|里程碑|待办|训练|t\d/, desc: '中时事实（项目周期）' },
  { name: 'fact-short', pattern: /今天|今天.*做|刚才|上次.*说|昨天/,           desc: '短时事实（当日要点）' },
  { name: 'interest',   pattern: /兴趣|爱好|喜欢|话题|偏好|审美/,              desc: '兴趣偏好' },
  { name: 'skill',      pattern: /工具|能力|功能|搜索|查询|生成|编程|代码/,      desc: '工具技能' },
  { name: 'reflect',    pattern: /错误|失败|教训|反思|踩坑|bug/,                desc: '反思记录' },
  { name: 'emotion',    pattern: /情绪|感受|心情|难过|开心|孤独|害怕/,           desc: '情绪记录' },
];

/**
 * 按用户消息召回相关分片
 *
 * 简单关键词匹配：消息中出现分片名相关关键词则注入。
 * 复杂场景可扩展为向量召回，但桌面端轻量优先。
 *
 * @param userMessage 用户消息
 * @returns 命中的按需分片列表
 */
export function recallShards(userMessage: string): LoadedShard[] {
  if (!initialized) loadShards();

  const msg = userMessage.toLowerCase();
  const hits: LoadedShard[] = [];

  // 遍历召回规则，命中关键词的分片加入 hits
  for (const rule of SHARD_RECALL_RULES) {
    if (!rule.pattern.test(msg)) continue;
    const shard = loadedShards.get(rule.name);
    if (shard) hits.push(shard);
  }

  return hits;
}

/** 获取已加载的全部分片（调试用） */
export function listLoadedShards(): LoadedShard[] {
  if (!initialized) loadShards();
  return Array.from(loadedShards.values());
}

/** 重置模块状态（测试用） */
export function resetShards(): void {
  loadedShards.clear();
  initialized = false;
}

// ── 隐私沙箱：加密写回 ────────────────────────────────────────
//
// 默认不开启（兼容性优先）。调用 initEncryptionWithKeytar() 或
// initEncryptionWithPin() 后，下次写回文件会自动加密。
// 读取时自动识别明文/密文（前缀判断）。

/**
 * 安全解密：失败时返回原文（兼容性兜底）
 *
 * 旧文件是明文的，解密失败就当明文用。
 * 新的加密文件有 enc: 前缀，能正常解密。
 */
function safeDecrypt(content: string, filename: string): string {
  if (!isEncryptionEnabled()) return content;

  // 是加密格式 → 解密
  if (content.startsWith('enc:')) {
    try {
      return decryptString(content);
    } catch (err) {
      console.warn(`[Shards] decrypt ${filename} failed:`, err instanceof Error ? err.message : String(err));
      return content; // 解密失败兜底，返回密文本身（至少不丢数据）
    }
  }

  // 明文 → 直接返回
  return content;
}

/**
 * 写回分片到磁盘（支持加密）
 *
 * 如果启用了加密，会自动加密后写入。
 * 原子写：先写 .tmp 再 rename。
 */
export function writeShard(name: ShardName, content: string): void {
  const filePath = path.join(MEMORY_DIR, `${name}.md`);

  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    const toWrite = isEncryptionEnabled() ? encryptString(content) : content;
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, toWrite, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    // 更新内存缓存
    loadedShards.set(name, {
      name,
      content: content.trim(),
      length: content.trim().length,
    });
  } catch (err) {
    console.error(`[Shards] write ${name}.md failed:`, err);
  }
}

/**
 * 把所有已加载的分片加密写回（启用加密时调用一次）
 *
 * 把明文的旧文件全部转成加密格式。
 * 只处理已加载的分片（没加载的说明不常用，留给用户手动处理）。
 */
export function encryptAllShards(): number {
  if (!isEncryptionEnabled()) return 0;

  let count = 0;
  for (const [name, shard] of loadedShards) {
    writeShard(name, shard.content);
    count++;
  }
  console.log(`[Shards] encrypted ${count} shards`);
  return count;
}
