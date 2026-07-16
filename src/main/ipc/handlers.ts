import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IpcChannel, type AgentChatPayload } from '../../shared/types/ipc';
import { registerValidatedHandler } from './validate';
import { Router, type CommandType } from '../router/router';
import { ReviewLayer } from '../agent/review-layer';
import { generateResponse, clearSessionHistory, type CycleLogEntry } from '../agent/agent-core';
import { sanitizeOutput } from '../agent/stream-sanitizer';
import { resolveActionEmotion, resolveExpression, NahidaEmotion } from '../../shared/types/emotion';
import { TtsScheduler, GptSoVitsAdapter } from '../tts';
import { consumePendingReports } from '../agent/rand-error';
import { setAutoStart, isAutoStartEnabled } from '../tray/autostart';
import { updateTrayStatus } from '../tray/tray-manager';
import { getCurrentPersonality, listPersonalities, setCurrentPersonality, createPersonality, deletePersonality, initPersonalityManager } from '../memory/personality-manager';
import { getConfig, saveConfigToDisk } from '../config/config';
import { getTokenStatsSummary, getChartData } from '../agent/token-usage';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 路由层 + 四审层 + TTS 调度器 实例（全局单例）
const router = new Router();
const reviewer = new ReviewLayer({ enabled: true });
// TTS：GPT-SoVITS 直出纳西妲音色（已替代 edge-tts + RVC 两步流程）
const ttsScheduler = new TtsScheduler(new GptSoVitsAdapter());

// ── 命令意图的预设回复（不走模型，省 token） ──
const COMMAND_RESPONSES: Record<CommandType, string> = {
  '/clear': '（花冠微垂，指尖轻拂虚空屏）……心识印记已清空，新的对话开始啦。',
  '/help': '（指尖虚空拨动）……可用命令：/clear /help /switch-model /stats /switch-persona',
  '/switch-model': '（虚空屏微光一闪）……模型切换功能还在生长中，再等等吧。',
  '/stats': '（轻托腮）……统计功能还在生长中，再等等吧。',
  '/switch-persona': '（花冠微颤）……人格切换功能已就绪，试试 /switch-persona nahida 或 /switch-persona ti-bao 吧。',
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

    // ── 托盘状态：进入 thinking ──
    updateTrayStatus('busy');

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
      
      if (routeResult.command === '/switch-persona') {
        const match = message.match(/\/switch-persona\s+(\S+)/);
        if (match && match[1]) {
          const personalityId = match[1];
          const success = setCurrentPersonality(personalityId);
          const personality = getCurrentPersonality();
          if (success && personality) {
            fullOutput = `（花冠轻转）……已切换至 ${personality.displayName}，开始新的对话吧。`;
          } else {
            fullOutput = '（花冠微垂）……人格切换失败，试试 /switch-persona nahida 或 /switch-persona ti-bao 吧。';
          }
        } else {
          fullOutput = COMMAND_RESPONSES['/switch-persona'];
        }
      } else {
        fullOutput = COMMAND_RESPONSES[routeResult.command ?? '/help'];
      }
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
          // 流式输出清洗：实时剥离 <think> / [emotion:xxx] / 
          const cleanedDelta = sanitizeOutput(delta);
          mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
            delta: cleanedDelta,
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

    // ── Rand_error 消费：有报告则写盘 + IPC 推送渲染层 ──
    const randReports = consumePendingReports();
    if (randReports.length > 0) {
      for (const r of randReports) {
        console.warn(`[RandError] ${r.type} ×${r.count} threshold reached — report written to memory/rand_error.md`);
        // 通过 IPC 推送给渲染层
        mainWindow.webContents.send(IpcChannel.RAND_ERROR_REPORT, {
          type: r.type,
          count: r.count,
          threshold: r.threshold,
          recentSamples: r.recentSamples,
          suggestion: r.suggestion,
          generatedAt: r.generatedAt,
        });
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
        live2dWindow.webContents.send(IpcChannel.TTS_CHUNK, {
          chunkIndex: 0,
          totalChunks: 1,
          audioBase64: result.audioBase64,
          voiceType: reviewResult.emotion.voiceType,
        });
        console.log('[TTS] pushed chunk, latency:', result.latencyMs, 'ms, cacheHit:', result.cacheHit);
      });
    }

    // ── 托盘状态：恢复 online ──
    updateTrayStatus('online');

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

  registerValidatedHandler(IpcChannel.AUTOSTART_SET, (_event: IpcMainInvokeEvent, payload: { enabled: boolean }) => {
    setAutoStart(payload.enabled);
    return { ok: true, enabled: payload.enabled };
  });

  registerValidatedHandler(IpcChannel.AUTOSTART_GET, () => {
    const enabled = isAutoStartEnabled();
    return { ok: true, enabled };
  });

  registerValidatedHandler(IpcChannel.LIVE2D_PENETRATE, (_event: IpcMainInvokeEvent, payload: { enable: boolean }) => {
    live2dWindow.setIgnoreMouseEvents(payload.enable);
    return { ok: true };
  });

  registerValidatedHandler(IpcChannel.PERSONALITY_GET, () => {
    const personality = getCurrentPersonality();
    return { ok: true, personality };
  });

  registerValidatedHandler(IpcChannel.PERSONALITY_LIST, () => {
    const personalities = listPersonalities();
    return { ok: true, personalities };
  });

  registerValidatedHandler(IpcChannel.PERSONALITY_SWITCH, (_event: IpcMainInvokeEvent, payload: { personalityId: string }) => {
    const success = setCurrentPersonality(payload.personalityId);
    const personality = getCurrentPersonality();
    return {
      ok: success,
      personalityId: success ? payload.personalityId : '',
      displayName: personality?.displayName ?? '',
    };
  });

  registerValidatedHandler(IpcChannel.PERSONALITY_CREATE, (_event: IpcMainInvokeEvent, payload: { id: string; name: string; displayName: string; description: string }) => {
    const personality = createPersonality(payload);
    return { ok: !!personality, personality };
  });

  registerValidatedHandler(IpcChannel.PERSONALITY_DELETE, (_event: IpcMainInvokeEvent, payload: { personalityId: string }) => {
    const success = deletePersonality(payload.personalityId);
    return { ok: success };
  });

  // config:get —— 获取当前配置
  registerValidatedHandler(IpcChannel.CONFIG_GET, () => {
    const cfg = getConfig();
    return { ok: true, config: cfg };
  });

  // config:set —— 保存配置（部分更新）
  registerValidatedHandler(IpcChannel.CONFIG_SET, (_event: IpcMainInvokeEvent, payload: { config: Record<string, unknown> }) => {
    try {
      saveConfigToDisk(payload.config as Parameters<typeof saveConfigToDisk>[0]);
      return { ok: true };
    } catch (err) {
      console.error('[IPC] config:set failed:', err);
      return { ok: false };
    }
  });

  // feedback:submit —— 用户反馈写入磁盘
  registerValidatedHandler(IpcChannel.FEEDBACK_SUBMIT, (_event: IpcMainInvokeEvent, payload: { type: string; title: string; content: string }) => {
    try {
      const feedbackDir = path.resolve(process.cwd(), 'feedback');
      if (!fs.existsSync(feedbackDir)) {
        fs.mkdirSync(feedbackDir, { recursive: true });
      }

      // 文件名：YYYYMMDD_HHMMSS_{type}.md
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
      const filename = `${timestamp}_${payload.type}.md`;
      const filepath = path.join(feedbackDir, filename);

      // Markdown 内容
      const content = `# ${payload.title}

**类型**: ${payload.type}
**时间**: ${now.toISOString()}

---

${payload.content}
`;

      fs.writeFileSync(filepath, content, 'utf-8');
      console.log('[Feedback] saved to', filepath);

      return { ok: true, filepath };
    } catch (err) {
      console.error('[IPC] feedback:submit failed:', err);
      return { ok: false };
    }
  });

  // stats:get —— 获取统计摘要（/stats 命令用）
  registerValidatedHandler(IpcChannel.STATS_GET, () => {
    const summary = getTokenStatsSummary();
    return { ok: true, summary };
  });

  // stats:get-chart —— 获取折线图数据
  registerValidatedHandler(IpcChannel.STATS_GET_CHART, () => {
    const chartData = getChartData();
    return { ok: true, chartData };
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
