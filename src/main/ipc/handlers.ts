import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IpcChannel, type AgentChatPayload } from '../../shared/types/ipc';
import { registerValidatedHandler } from './validate';
import { Router, type CommandType } from '../router/router';
import { ReviewLayer } from '../agent/review-layer';
import { generateResponse, clearSessionHistory, type CycleLogEntry } from '../agent/agent-core';
import { resolveActionEmotion, resolveExpression, NahidaEmotion } from '../../shared/types/emotion';
import { TtsScheduler, EdgeTtsAdapter } from '../tts';
import { consumePendingReports } from '../agent/rand-error';

// 路由层 + 四审层 + TTS 调度器 实例（全局单例）
const router = new Router();
const reviewer = new ReviewLayer({ enabled: true });
// TTS：第一阶段用 edge-tts（纯 CPU），RVC 桥接训练完成后在 scheduler 内切换
const ttsScheduler = new TtsScheduler(new EdgeTtsAdapter());

// ── 命令意图的预设回复（不走模型，省 token） ──
const COMMAND_RESPONSES: Record<CommandType, string> = {
  '/clear': '（花冠微垂，指尖轻拂虚空屏）……心识印记已清空，新的对话开始啦。',
  '/help': '（指尖虚空拨动）……可用命令：/clear /help /switch-model /stats',
  '/switch-model': '（虚空屏微光一闪）……模型切换功能还在生长中，再等等吧。',
  '/stats': '（轻托腮）……统计功能还在生长中，再等等吧。',
};

// T5 Agent 编排：路由层 → generateResponse → 四审 → live2d action
export function setupIpcHandlers(mainWindow: BrowserWindow, live2dWindow: BrowserWindow): void {
  // agent:chat —— 收到消息后走路由层 → 真实模型流式推送 → 四审 → live2d action
  registerValidatedHandler(IpcChannel.AGENT_CHAT, async (_event: IpcMainInvokeEvent, payload: AgentChatPayload) => {
    const sessionId = payload.sessionId ?? 'test-session';
    const message = payload.message;

    // ── 挂点1：instruction-guard — 用户消息清洗 ──
    const routeResult = router.route({
      message,
      sessionId,
      timestamp: Date.now(),
    });

    console.log('[Router] intent:', routeResult.intent);
    console.log('[Router] degrade:', routeResult.degradeDecision.tier);
    console.log('[Router] injection:', routeResult.injectionFlagged);

    // ── 生成回复：命令走预设，其他意图走真实模型（T5） ──
    let fullOutput: string;
    // cycleLog：T/F/Tk 三段由 agent-core 内打点，R 段在此追加（审查在 handlers 调用）
    let cycleLog: CycleLogEntry[] = [];
    if (routeResult.intent === 'command') {
      // 命令意图：直接返回预设回复，不走模型（省 token）
      // /clear 额外清空 session 历史和护栏和 TTS 缓存
      if (routeResult.command === '/clear') {
        clearSessionHistory(sessionId);
        router.resetSessionGuardrails(sessionId);
        ttsScheduler.clearCache();
      }
      fullOutput = COMMAND_RESPONSES[routeResult.command ?? '/help'];
      // 一次性推送完整回复
      mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
        delta: fullOutput,
        finishReason: 'stop',
        sessionId,
        timestamp: Date.now(),
      });
    } else {
      // 非命令意图：调用 Agent Core 真实生成
      const agentResult = await generateResponse(
        sessionId,
        routeResult.sanitizedMessage,
        routeResult.intent,
        routeResult.degradeDecision,
        (delta, done) => {
          // onDelta 回调：每收到一段 delta 就推给渲染层
          mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
            delta,
            finishReason: done ? 'stop' : undefined,
            sessionId,
            timestamp: Date.now(),
          });
        },
        router, // T9: 传入 router 支持工具调用回路
      );
      fullOutput = agentResult.content;
      cycleLog = agentResult.cycleLog; // 取出 agent-core 内的 T/F/Tk 三段

      // 报告模型调用结果到 router（更新降级熔断器）
      if (agentResult.degraded) {
        router.reportModelFailure(routeResult.degradeDecision.tier, 'unavailable');
      } else {
        router.reportModelSuccess(routeResult.degradeDecision.tier);
      }
    }

    // ── 四审层：流式输出完成后审查 ──
    // 从 router intent 推导 routeTier：think 意图 → 'think' 触发 CoT 检查
    const routeTier = routeResult.intent === 'think' ? 'think' : 'nothink';
    const reviewStart = Date.now();
    const reviewResult = await reviewer.review(message, fullOutput, routeTier);
    const reviewEnd = Date.now();

    // ── cycleLog 追加 R 段（Rethinking） ──
    // R 段摘要：审查 pass / 各维度分 / latency / 触发的 Rand_error 类型
    cycleLog.push({
      phase: 'R',
      ts: reviewEnd,
      durationMs: reviewEnd - reviewStart,
      summary: `pass=${reviewResult.pass}, B=${reviewResult.output.score}, C=${reviewResult.emotion.actionTag ?? 'none'}, latency=${reviewResult.latencyMs}ms`,
    });
    console.log('[CycleLog]', cycleLog.map(c => `${c.phase}(${c.durationMs}ms)`).join(' → '));

    console.log('[Review] pass:', reviewResult.pass);
    console.log('[Review] B score:', reviewResult.output.score, 'bracket:', reviewResult.output.hasActionBracket);
    console.log('[Review] C tag:', reviewResult.emotion.actionTag, 'voice:', reviewResult.emotion.voiceType);
    console.log('[Review] latency:', reviewResult.latencyMs, 'ms');

    // ── Rand_error 消费：有报告则写盘 + 日志告警 ──
    // IPC 6 通道规范里无 rand-error 通道，暂用 console.warn 输出，待后续 IPC 扩展
    const randReports = consumePendingReports();
    if (randReports.length > 0) {
      for (const r of randReports) {
        console.warn(`[RandError] ${r.type} ×${r.count} threshold reached — report written to memory/rand_error.md`);
      }
    }

    // ── C 维 actionTag → 推 live2d:action + TTS 调度 ──
    // 从 actionTag 反查情绪枚举 → 解析 Cubism Expression → 推给渲染层
    const emotionEnum = reviewResult.emotion.actionTag
      ? resolveActionEmotion(reviewResult.emotion.actionTag) ?? NahidaEmotion.Greeting
      : NahidaEmotion.Greeting;

    if (reviewResult.emotion.actionTag) {
      const expression = resolveExpression(emotionEnum);
      live2dWindow.webContents.send(IpcChannel.LIVE2D_ACTION, {
        actionTag: reviewResult.emotion.actionTag,
        expression,
        priority: 0,
      });
      console.log('[Live2D] push actionTag:', reviewResult.emotion.actionTag, 'expression:', expression);
    }

    // ── TTS 调度：去掉动作括号后合成语音（异步，不阻塞返回） ──
    // 借鉴 xiaoda-agent：TTS 不朗读动作 tag / 情绪标签，只读正文
    const ttsText = stripActionTags(fullOutput);
    if (ttsText.trim()) {
      void ttsScheduler.enqueue({
        text: ttsText,
        emotion: emotionEnum,
        sessionId,
      }).then((result) => {
        if (!result) return;
        mainWindow.webContents.send(IpcChannel.TTS_CHUNK, {
          chunkIndex: 0,
          totalChunks: 1,
          audioBase64: result.audioBase64,
          voiceType: reviewResult.emotion.voiceType,
        });
        console.log('[TTS] pushed chunk, latency:', result.latencyMs, 'ms, cacheHit:', result.cacheHit);
      });
    }

    return {
      ok: true,
      echo: message,
      route: {
        intent: routeResult.intent,
        tier: routeResult.degradeDecision.tier,
        injected: routeResult.injectionFlagged,
      },
      review: {
        pass: reviewResult.pass,
        bScore: reviewResult.output.score,
        cTag: reviewResult.emotion.actionTag,
        latencyMs: reviewResult.latencyMs,
      },
    };
  });
}

// ── TTS 文本清洗工具 ────────────────────────────────────────

/**
 * 去掉动作括号和情绪标签，只留正文给 TTS 朗读
 *
 * 借鉴 xiaoda-agent tts_engine.py BUG-18 修复：
 *   TTS 不应朗读 [emotion:xxx] 标签和动作括号文本
 *
 * 示例：
 *   "嗯...（铃铛轻响）好的[emotion:happy]"
 *     → "嗯...好的"
 */
function stripActionTags(text: string): string {
  return text
    .replace(/（[^）]*）/g, '')   // 中文括号及内容
    .replace(/\[emotion:[^\]]*\]/g, '')  // 情绪标签
    .trim();
}
