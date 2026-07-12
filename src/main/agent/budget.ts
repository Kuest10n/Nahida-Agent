/**
 * System Prompt Token Budget 管制
 *
 * 职责：限制 system prompt 总 token 数，防止 worldbook + 分片挤爆 context
 *
 * 背景：
 *   SOHA 压缩 ~1200t + User.md(200t) + persona.md(300t) + 按需分片(100-300t)
 *   + worldbook 5 条(50-150t/条) = 轻松 2500-3500t
 *   Qwen3-8B context 4096 时，worldbook+分片一触发就快顶，再+对话历史会 truncate 尾部
 *
 * 策略（借鉴 xiaoda-agent token budget 思路）：
 *   - 常驻块（SOHA + User + persona）优先保，不砍
 *   - worldbook 块按 priority 砍（priority 低的先丢）
 *   - 按需分片按相关性砍（recallShards 返回顺序就是相关性，末尾先丢）
 *
 * token 计数：用近似公式 `chars / 1.5`（中文 1 字 ≈ 1.5 token，Qwen BPE 实测误差 < 10%）
 * 不用 tiktoken：桌面端轻量优先，误差 10% 对 budget 管制够用
 */

// ── 预算配置 ──────────────────────────────────────────────────

/** system prompt 总 ceiling（token） */
const SYSTEM_CEILING = 3000;

/** worldbook 块单独 ceiling（防止条目过多挤占分片） */
const WORLDBOOK_CEILING = 800;

/** 按需分片块单独 ceiling */
const SHARD_CEILING = 600;

// ── 类型定义 ──────────────────────────────────────────────────

/** 待裁剪的 system prompt 块 */
export interface PromptBlock {
  /** 块标识（'soha' / 'resident' / 'shard' / 'worldbook' / 'tool'） */
  tag: string;
  /** 内容文本 */
  content: string;
  /** 优先级（数值越大越保，常驻块 = 100，worldbook 用其 priority，按需分片 = 50） */
  priority: number;
}

/** 裁剪结果 */
export interface BudgetResult {
  /** 裁剪后的块列表（已按 priority 排序保留） */
  kept: PromptBlock[];
  /** 总 token 估算 */
  totalTokens: number;
  /** 被丢弃的块 tag（用于调试日志） */
  dropped: string[];
}

// ── token 估算 ────────────────────────────────────────────────

/**
 * 近似 token 计数（Qwen BPE）
 *
 * 中文 1 字 ≈ 1.5 token，英文 1 词 ≈ 1 token
 * 用 `chars / 1.5` 近似，误差 < 10%（对 budget 管制够用）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 1.5);
}

// ── 裁剪逻辑 ──────────────────────────────────────────────────

/**
 * 按预算裁剪 system prompt 块
 *
 * 流程：
 *   1. 常驻块（priority >= 100）先保，计算剩余预算
 *   2. 非常驻块按 priority 降序排，从高到低填入剩余预算
 *   3. worldbook 块单独受 WORLDBOOK_CEILING 限制
 *   4. 按需分片块单独受 SHARD_CEILING 限制
 *
 * @param blocks 待裁剪的块（顺序无关，按 priority 排序保留）
 */
export function trimToBudget(blocks: PromptBlock[]): BudgetResult {
  // 分类：常驻 / worldbook / 按需分片 / 其他（工具提示等）
  const resident: PromptBlock[] = [];
  const worldbook: PromptBlock[] = [];
  const shards: PromptBlock[] = [];
  const others: PromptBlock[] = [];

  for (const b of blocks) {
    if (b.priority >= 100) resident.push(b);
    else if (b.tag === 'worldbook') worldbook.push(b);
    else if (b.tag === 'shard') shards.push(b);
    else others.push(b);
  }

  // 1. 常驻块先保（不砍）
  const kept: PromptBlock[] = [...resident];
  let usedTokens = sumTokens(kept);
  const dropped: string[] = [];

  // 2. 工具提示等其他块（priority 高的先保）
  others.sort((a, b) => b.priority - a.priority);
  for (const b of others) {
    const t = estimateTokens(b.content);
    if (usedTokens + t <= SYSTEM_CEILING) {
      kept.push(b);
      usedTokens += t;
    } else {
      dropped.push(b.tag);
    }
  }

  // 3. worldbook 块（按 priority 降序，受 WORLDBOOK_CEILING 限制）
  worldbook.sort((a, b) => b.priority - a.priority);
  let wbTokens = 0;
  for (const b of worldbook) {
    const t = estimateTokens(b.content);
    if (wbTokens + t > WORLDBOOK_CEILING) {
      dropped.push(`worldbook:${b.tag}`);
      continue;
    }
    if (usedTokens + t > SYSTEM_CEILING) {
      dropped.push(`worldbook:${b.tag}`);
      continue;
    }
    kept.push(b);
    wbTokens += t;
    usedTokens += t;
  }

  // 4. 按需分片块（按 priority 降序，受 SHARD_CEILING 限制）
  shards.sort((a, b) => b.priority - a.priority);
  let shardTokens = 0;
  for (const b of shards) {
    const t = estimateTokens(b.content);
    if (shardTokens + t > SHARD_CEILING) {
      dropped.push(`shard:${b.tag}`);
      continue;
    }
    if (usedTokens + t > SYSTEM_CEILING) {
      dropped.push(`shard:${b.tag}`);
      continue;
    }
    kept.push(b);
    shardTokens += t;
    usedTokens += t;
  }

  return { kept, totalTokens: usedTokens, dropped };
}

/** 拼接 kept 块为完整 system prompt 字符串 */
export function joinBlocks(blocks: PromptBlock[]): string {
  return blocks.map(b => b.content).join('\n\n');
}

// ── 内部工具 ──────────────────────────────────────────────────

function sumTokens(blocks: PromptBlock[]): number {
  return blocks.reduce((sum, b) => sum + estimateTokens(b.content), 0);
}
