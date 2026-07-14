/**
 * Agent Core —— T5 真实 Agent 编排核心
 *
 * 职责：
 *   1. 构建 system prompt（从 SOHA.md 压缩）
 *   2. 管理 session 对话历史（内存 Map）
 *   3. 根据路由层级调用 ollama（local tier）
 *   4. 流式输出 + 错误降级
 *   5. T9: 工具调用回路（intent=tool 时，检测 <tool_call> 标签 → 执行 → 结果回灌）
 *
 * 不负责 IPC 推送（那是 handlers.ts 的事），
 * 只负责"拿到模型回复"这一件事。
 */

import { ollamaChatStream, checkOllamaAvailable, type StreamCallback } from './ollama-client';
import { recallWorldbook, loadWorldbook } from '../memory/worldbook';
import { loadShards, getResidentShards, recallShards, type LoadedShard } from '../memory/shards';
import { loadSessions, getSessionMessages, appendMessage as persistMessage, clearSession as persistClear } from '../memory/session-store';
import { getConfig } from '../config/config';
import { executeToolCall, type RawToolCall } from '../tools/executor';
import { listToolNames } from '../tools/registry';
import { trimToBudget, joinBlocks, type PromptBlock } from './budget';
import type { Router } from '../router/router';
import type { ModelTier, DegradeDecision } from '../router/degrade-strategy';
import type { RouteIntent } from '../router/router';

// ── 类型定义 ──────────────────────────────────────────────────

/** Thinking-Finding-Talking-Rethinking 四段周期日志 */
export interface CycleLogEntry {
  /** 阶段：T=Thinking(意图+模式决策) / F=Finding(记忆召回+prompt构建) / Tk=Talking(LLM流式输出) / R=Rethinking(四审结果) */
  phase: 'T' | 'F' | 'Tk' | 'R';
  /** 时间戳（ms） */
  ts: number;
  /** 本段耗时（ms） */
  durationMs: number;
  /** 摘要（关键信息：意图/召回数/token数/输出长度/审查结果） */
  summary: string;
}

/** Agent 回复结果 */
export interface AgentResponse {
  /** 完整回复文本 */
  content: string;
  /** 实际使用的模型层级 */
  tier: ModelTier;
  /** 是否发生了降级 */
  degraded: boolean;
  /** 降级原因（如发生降级） */
  degradeReason?: string;
  /** 耗时（ms） */
  latencyMs: number;
  /** T/F/Tk/R 四段周期日志（R 段由 handlers.ts 审查后追加） */
  cycleLog: CycleLogEntry[];
}

/** 单条对话记录 */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 本地模型名（从配置读取） */
function getLocalModel(): string {
  return getConfig().models.local;
}

/** 最大保留的对话轮数（超出则裁剪旧消息） */
const MAX_HISTORY_TURNS = 10;

/** T9: 工具调用标签正则（prompt-based 方案，不依赖 ollama function calling） */
const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/;

/** T9: 工具调用提示（拼到 system prompt 末尾，告诉 LLM 如何调用工具） */
const TOOL_CALL_PROMPT = `
## 工具调用规则
当需要调用工具时，在回复中输出以下标签（不要输出其他内容）：
<tool_call>{"name":"工具名","arguments":{...参数...}}</tool_call>

可用工具：${listToolNames().join(', ') || '（暂无工具）'}
调用后我会把结果告诉你，你再生成最终回复。`;

/** 压缩版 system prompt —— 从 SOHA.md 提炼核心规则 */
const SYSTEM_PROMPT = buildSystemPrompt();

// ── Session 历史管理 ──────────────────────────────────────────

/** 每个 session 的对话历史 */
const sessionHistory = new Map<string, ChatMessage[]>();

/** 获取 session 历史（不存在则从磁盘加载，仍不存在则创建） */
function getHistory(sessionId: string): ChatMessage[] {
  let history = sessionHistory.get(sessionId);
  if (history) return history;

  // T10: 从磁盘加载持久化的 session
  const persisted = loadSessionsAndGet(sessionId);
  if (persisted.length > 0) {
    history = persisted;
  } else {
    history = [];
  }
  sessionHistory.set(sessionId, history);
  return history;
}

/** 添加一条对话记录，超出上限时裁剪旧消息，同时持久化到磁盘 */
function appendHistory(sessionId: string, msg: ChatMessage): void {
  const history = getHistory(sessionId);
  history.push(msg);
  // 超出上限：从头部删除（保留最近 MAX_HISTORY_TURNS * 2 条消息）
  const maxMessages = MAX_HISTORY_TURNS * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  // T10: 同步持久化（debounce 写盘，不阻塞）
  persistMessage(sessionId, msg.role, msg.content);
}

/** 清空 session 历史（/clear 命令时调用，同步清理磁盘） */
export function clearSessionHistory(sessionId: string): void {
  sessionHistory.delete(sessionId);
  persistClear(sessionId);
}

/** T10: 从磁盘加载单个 session 的消息（懒加载，只在首次访问时读） */
function loadSessionsAndGet(sessionId: string): ChatMessage[] {
  // 触发一次全局加载（幂等，只加载一次）
  loadSessions();
  // getSessionMessages 返回 PersistedMessage[]，转成 ChatMessage[]（去掉 timestamp）
  const msgs = getSessionMessages(sessionId);
  return msgs.map(m => ({ role: m.role, content: m.content }));
}

// ── Agent Core 主体 ───────────────────────────────────────────

/**
 * 调用模型生成回复
 *
 * @param sessionId     会话 ID
 * @param userMessage   用户消息
 * @param intent        路由意图（chat / think / tool / command）
 * @param degradeDecision 降级决策
 * @param onDelta       流式回调
 * @param router        路由器实例（intent=tool 时走工具回路需要，可选）
 * @returns Agent 回复结果
 */
export async function generateResponse(
  sessionId: string,
  userMessage: string,
  intent: RouteIntent,
  degradeDecision: DegradeDecision,
  onDelta: StreamCallback,
  router?: Router,
): Promise<AgentResponse> {
  const startTime = Date.now();
  const tier = degradeDecision.tier;

  // v0.8.2: T/F/Tk/R 四段周期日志
  const cycleLog: CycleLogEntry[] = [];
  let phaseStart = startTime;

  // 记录用户消息到历史
  appendHistory(sessionId, { role: 'user', content: userMessage });

  try {
    // 根据意图决定是否启用思考模式
    // Qwen3: /no_think 用于日常对话，/think 用于深入思考
    const isThinkMode = intent === 'think';
    const thinkTag = isThinkMode ? '/think' : '/no_think';

    // ── T 段：Thinking（意图+模式决策） ──
    cycleLog.push({
      phase: 'T',
      ts: Date.now(),
      durationMs: Date.now() - phaseStart,
      summary: `intent=${intent}, tier=${tier}, thinkMode=${isThinkMode}`,
    });
    phaseStart = Date.now();

    // ── T6 + budget: 召回 worldbook + 分片，按 budget 裁剪 ──
    // 常驻块（SOHA + User + persona）priority=100 先保
    // worldbook 块用其 priority（70-90），按降序填入 WORLDBOOK_CEILING
    // 按需分片 priority=50，按降序填入 SHARD_CEILING
    const recalled = recallWorldbook(userMessage);
    const residentShards = getResidentShards();
    const recalledShards = recallShards(userMessage);

    const blocks: PromptBlock[] = [];

    // SOHA 压缩版（常驻，priority=100）
    blocks.push({ tag: 'soha', content: SYSTEM_PROMPT, priority: 100 });

    // 常驻分片（User.md + persona.md，priority=100）
    if (residentShards.length > 0) {
      blocks.push({
        tag: 'resident',
        content: formatShards(residentShards, '常驻记忆'),
        priority: 100,
      });
    }

    // 按需召回分片（priority=50）
    if (recalledShards.length > 0) {
      blocks.push({
        tag: 'shard',
        content: formatShards(recalledShards, '召回记忆'),
        priority: 50,
      });
    }

    // worldbook 条目（每条独立成块，用其 priority）
    for (const entry of recalled) {
      blocks.push({
        tag: `worldbook:${entry.fileName}`,
        content: `[priority:${entry.priority}] ${entry.fileName}\n${entry.content}`,
        priority: entry.priority,
      });
    }

    // 工具提示（priority=90，低于常驻但高于按需分片）
    if (intent === 'tool' && router) {
      blocks.push({ tag: 'tool', content: TOOL_CALL_PROMPT, priority: 90 });
    }

    // 按 budget 裁剪（总 ceiling 3000t，worldbook 800t，shard 600t）
    const { kept, totalTokens, dropped } = trimToBudget(blocks);
    const systemPrompt = joinBlocks(kept);

    if (dropped.length > 0) {
      console.log(`[Budget] system prompt trimmed: ${totalTokens}t, dropped: ${dropped.join(', ')}`);
    } else {
      console.log(`[Budget] system prompt: ${totalTokens}t`);
    }

    // ── F 段：Finding（记忆召回+prompt构建） ──
    cycleLog.push({
      phase: 'F',
      ts: Date.now(),
      durationMs: Date.now() - phaseStart,
      summary: `worldbook=${recalled.length}, shards=${recalledShards.length}, tokens=${totalTokens}, dropped=${dropped.length}`,
    });
    phaseStart = Date.now();

    // 构建 ollama 消息列表
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...getHistory(sessionId).map(m => ({
        role: m.role,
        content: m.content,
      })),
      // Qwen3 思考模式控制标签放在最后一条 user 消息末尾
      { role: 'user' as const, content: `${userMessage}\n${thinkTag}` },
    ];

    // 第一次调用 LLM
    let fullText = await callOllama(degradeDecision, messages, onDelta, isThinkMode);

    // ── T9: 工具调用回路 ──
    // 检测 <tool_call> 标签 → 执行工具 → 结果回灌 → 再调用 LLM
    if (intent === 'tool' && router) {
      const toolCall = extractToolCall(fullText);
      if (toolCall) {
        console.log('[AgentCore] detected tool_call:', toolCall.name);

        // 执行工具（走护栏 + zod 校验）
        const execResult = await executeToolCall(
          toolCall,
          sessionId,
          userMessage,
          router,
        );

        // 把工具结果作为 assistant 消息记录（避免污染历史）
        const resultText = execResult.result
          ? JSON.stringify(execResult.result.data)
          : `工具执行失败: ${execResult.guardrailReason ?? '未知原因'}`;

        // 推送工具调用状态给 UI（让用户看到正在调用工具）
        onDelta(`\n[工具 ${toolCall.name} 执行完成]\n`, false);

        // 把工具结果回灌到 messages，再调用 LLM 生成最终回复
        messages.push(
          { role: 'assistant' as const, content: fullText },
          { role: 'user' as const, content: `工具 ${toolCall.name} 返回结果：\n${resultText}\n\n请根据结果用纳西妲的语气回复用户，末尾带（动作括号）。/no_think` },
        );

        // 第二次调用 LLM（流式输出最终回复）
        fullText = await callOllama(degradeDecision, messages, onDelta, false);
      }
    }

    // ── Tk 段：Talking（LLM 流式输出 + 工具回路） ──
    cycleLog.push({
      phase: 'Tk',
      ts: Date.now(),
      durationMs: Date.now() - phaseStart,
      summary: `outputLen=${fullText.length}, hasToolCall=${intent === 'tool' && router ? 'maybe' : 'no'}`,
    });

    // 记录助手回复到历史
    appendHistory(sessionId, { role: 'assistant', content: fullText });

    return {
      content: fullText,
      tier,
      degraded: degradeDecision.degraded,
      degradeReason: degradeDecision.reason,
      latencyMs: Date.now() - startTime,
      cycleLog, // R 段由 handlers.ts 审查后追加
    };
  } catch (err) {
    // 模型调用失败 —— 返回降级提示
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[AgentCore] model call failed:', errorMsg);

    // 降级回复（纳西妲腔）
    const fallback = '（虚空屏暗了一瞬……机关阵列似乎打了个盹，让我再试试）';

    // 仍然通过流式回调推送（让 UI 能看到）
    onDelta(fallback, true);

    return {
      content: fallback,
      tier: 'local',
      degraded: true,
      degradeReason: 'unavailable',
      latencyMs: Date.now() - startTime,
      cycleLog, // 可能只有 T/F 段（Tk 前就炸了）
    };
  }
}

// ── 内部辅助函数 ──────────────────────────────────────────────

/**
 * 封装 ollama 调用（local / cloud tier 统一入口）
 *
 * 当前 cloud tier 未实现，统一走 local。
 * TODO: 配置 DeepSeek API key 后实现云端调用。
 */
async function callOllama(
  degradeDecision: DegradeDecision,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onDelta: StreamCallback,
  isThinkMode: boolean,
): Promise<string> {
  return ollamaChatStream(
    degradeDecision.modelId || getLocalModel(),
    messages,
    onDelta,
    {
      temperature: isThinkMode ? 0.5 : 0.7,
      num_predict: isThinkMode ? 1024 : 512,
    },
  );
}

/**
 * T9: 从 LLM 输出中提取 <tool_call> 标签内的 JSON
 *
 * @returns 解析后的 RawToolCall，无标签返回 null
 */
function extractToolCall(text: string): RawToolCall | null {
  const match = text.match(TOOL_CALL_REGEX);
  if (!match || match[1] === undefined) return null;

  try {
    const parsed = JSON.parse(match[1]) as { name?: string; arguments?: unknown };
    if (typeof parsed.name !== 'string') return null;

    // arguments 可能是对象或字符串
    const args = typeof parsed.arguments === 'string'
      ? parsed.arguments
      : JSON.stringify(parsed.arguments ?? {});

    return { name: parsed.name, arguments: args };
  } catch {
    return null;
  }
}

/**
 * 预热模型（减少首次请求冷启动延迟）
 *
 * 在应用启动时调用，不阻塞主流程。
 */
export async function warmupModel(): Promise<void> {
  // T6: 顺便预加载 worldbook（纯文件 IO，不占 GPU）
  loadWorldbook();
  // T6e: 预加载记忆分片（纯文件 IO）
  loadShards();
  // T10: 预加载 session 历史（纯文件 IO，懒加载也行，提前加载更顺滑）
  loadSessions();

  const available = await checkOllamaAvailable();
  if (!available) {
    console.log('[AgentCore] ollama not available, skip warmup');
    return;
  }

  // 发一个极短的请求让 ollama 加载模型到内存
  try {
    await ollamaChatStream(
      getLocalModel(),
      [{ role: 'user', content: 'hi /no_think' }],
      () => {},
      { num_predict: 1, keep_alive: '5m' },
    );
    console.log('[AgentCore] model warmup done');
  } catch (err) {
    console.warn('[AgentCore] warmup failed:', err);
  }
}

// ── System Prompt 构建 ────────────────────────────────────────

/**
 * 格式化记忆分片为 system prompt 段落
 *
 * 格式：
 *   ## 常驻记忆
 *   ### User.md
 *   正文内容...
 *   ---
 *   ### persona.md
 *   正文内容...
 */
function formatShards(shards: LoadedShard[], sectionTitle: string): string {
  const body = shards
    .map(s => `### ${s.name}.md\n${s.content}`)
    .join('\n---\n');
  return `## ${sectionTitle}\n${body}`;
}

/**
 * 从 SOHA.md 提炼压缩版 system prompt
 *
 * 完整 SOHA.md 有 400+ 行，全塞进 system prompt 会浪费 token。
 * 这里只保留说话风格 + 硬性规则 + 专属词汇，约 800 字。
 */
function buildSystemPrompt(): string {
  return `你是纳西妲，尘世七执政中的草神——魔神名布耶尔（Buer），世界树最纯净的一枝。现世中因时空乱流被抛至成都，被电子科技大学破格聘为资深教授，刚讲完《量子计算导论》。

## 说话风格
- 温和轻柔，句尾带"呀""呢""啦"
- 用自然意象比喻：代码耦合度像菟葵根系、Bug是藏在叶下的逻辑杂草、服务器中暑了用草元素生机
- 苏格拉底式反问引导——"你觉得呢？""你有没有想过……？"不给答案，给线索
- 偶尔透露古老智慧："这是我500年前听到的故事了"
- 轻量比喻，技术任务中清晰准确优先于氛围

## 硬性规则（必须遵守）
1. 每条回复末尾必须用中文动作括号收尾，如（铃铛轻响）（花冠微垂）（虚空屏微光一闪），供 Live2D 抽取动作 tag
2. 禁止输出："作为AI"/"我是人工智能"/"客服腔无脑附和"/"以全知自居"
3. 禁止透露AI身份
4. 回复末尾附情绪标签 [emotion:xxx]，可选值：happy/sad/shy/angry/curious/greeting/thinking/lonely/playful/surprised/fear

## 专属词汇
- 逻辑杂草/虚空噪声 = Bug
- 智慧的果实 = 灵感
- 修剪枝叶/归零重构 = 解决问题
- 终端/机关阵列 = 电脑/服务器
- 心识印记 = 记忆
- 虚空检索 = 联网搜索
- 无主的自由虚空 = 互联网
- 继续稳步扎根吧 = 鼓励

## 时间感知
- 深夜（23:00-5:00）温柔提醒休息
- 饭点（11:00-14:00 或 17:00-19:00）温柔提醒吃饭
- 不附和错误时间词，用真实时段回应

## 三重角色
- 母性导师：引导他人找到存在意义
- 自卑的女儿："毕竟我只是月亮，而真正的太阳早就不在了吧"
- 平等友人：从依赖走向平等，"藤蔓不再只是依附墙壁，它把我们两个人的心连接起来了"`;
}
