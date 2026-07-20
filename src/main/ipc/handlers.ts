import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel, type AgentChatPayload, type SttStartPayload, type VisionAnalyzePayload, type VideoUploadPayload } from '../../shared/types/ipc';
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
import { getCurrentPersonality, listPersonalities, setCurrentPersonality, createPersonality, deletePersonality } from '../memory/personality-manager';
import { getConfig, saveConfigToDisk } from '../config/config';
import { getTokenStatsSummary, getChartData } from '../agent/token-usage';
import { queryDeepSeekBalance, formatBalanceSummary } from '../api/balance';
import { recordInteraction } from '../soul/dream';
import { getForgettingStats } from '../soul/forgetting';
import { getDreamStatus } from '../soul/dream';
import { getMetacognitionStats, analyze as analyzeMetacognition, appendMetacognitionHint } from '../soul/metacognition';
import { getCoordinator } from '../agent/multi-agent';
import { requestReset, executeReset, getResetReport } from '../soul/reset';
import { startABTest, stopABTest, getABStats, formatABStats, switchGroup } from '../soul/persona-ab';
import { formatPluginList, enablePlugin, disablePlugin } from '../plugins/plugin-loader';
import { startSTT, stopSTT, receiveResult, switchBackend, getSTTState, type STTResult } from '../voice/stt';
import { startWakeup, stopWakeup, toggleWakeup, getWakeupState } from '../voice/voice-wakeup';
import { exportConversation, getDefaultExportPath, type ExportFormat } from '../memory/exporter';
import { appendMessage } from '../memory/session-store';
import { saveUploadedImage, processVisionRequest, processVideoRequest, startScreenMonitor, stopScreenMonitor, getScreenMonitorState, isSafeVideoPath } from '../vision/vision-manager';
import { captureScreen, captureAndAnalyze, captureRegion, listDisplays, formatDisplayList } from '../vision/screenshot';
import { showRegionOverlay } from '../vision/capture-overlay';
import { getPomodoroState } from '../tools/pomodoro';
import { getTool } from '../tools/registry';
import { buildPackage } from '../community/package-builder';
import {
  installPackage,
  listAvailablePackages,
  getPackageInfo,
} from '../community/package-installer';
import {
  initGroupChat,
  createGroup,
  listGroups,
  getGroup,
  deleteGroup,
  addAgent,
  removeAgent,
  setTokenLimit,
  broadcastMessage,
  getAvailablePersonalities,
} from '../agent/group-chat/group-chat';
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
  '/help': '（指尖虚空拨动）……可用命令：/clear /help /switch-model /stats /switch-persona /balance /hat /pomodoro /package /wakeup /group /multimodal /screenshot /video /monitor',
  '/switch-model': '（虚空屏微光一闪）……模型切换功能还在生长中，再等等吧。',
  '/stats': '（轻托腮）……统计功能已就绪，试试 `/stats` 查看 token 消耗、遗忘曲线、梦境状态和元认知统计吧。',
  '/switch-persona': '（花冠微颤）……人格切换功能已就绪，试试 /switch-persona nahida 或 /switch-persona ti-bao 吧。',
  '/balance': '（指尖轻点虚空屏）……余额查询正在路上。',
  '/hat': '（花冠轻转）……六顶帽模式已切换。',
  '/reset': '（花冠微垂，神情凝重）……重置请求已收到。',
  '/ab': '（花冠轻转）……A/B 测试模式已切换。',
  '/plugin': '（虚空屏微光一闪）……插件管理。',
  '/pomodoro': '（花冠轻转）……番茄钟专注模式。',
  '/package': '（指尖虚空拨动）……社区共享包管理。',
  '/wakeup': '（花冠轻转）……语音唤醒模式。',
  '/group': '（花冠轻转）……群聊模式。',
  '/multimodal': '（花冠轻转，虚空屏展开）……全模态闭环已就绪。在输入框旁边的📎按钮上传图片，或者直接粘贴/拖拽图片，我就能看到啦。需要配置 Vision 模型（如 qwen2-vl）才能使用图像理解功能哦。',
  '/screenshot': '（花冠轻转，虚空屏微光一闪）……屏幕截图模式已就绪。试试：\n`/screenshot` 截取主屏并分析\n`/screenshot region` 框选屏幕区域截图（支持多屏）\n`/screenshot list` 列出可用显示器\n`/screenshot <显示器ID>` 截取指定显示器\n`/screenshot 看看这个报错` 截屏 + 自定义提问',
  '/video': '（花冠微垂，凝神注视）……视频分析模式已就绪。试试：\n`/video` 上传视频文件并分析\n`/video 这个视频讲了什么` 上传视频 + 自定义提问',
  '/monitor': '（花冠微垂）……屏幕监控命令：\n`/monitor start` 开始监控（定时截图，画面变化超过 5% 时自动分析）\n`/monitor stop` 停止监控\n`/monitor status` 查询状态',
};

// T5 Agent 编排：路由层 → generateResponse → 四审 → live2d action
export function setupIpcHandlers(mainWindow: BrowserWindow, live2dWindow: BrowserWindow): void {
  // agent:chat —— 收到消息后走路由层 → 真实模型流式推送 → 四审 → live2d action
  registerValidatedHandler(IpcChannel.AGENT_CHAT, async (_event: IpcMainInvokeEvent, payload: AgentChatPayload) => {
    recordInteraction(); // 灵魂三维：记录用户交互（打断梦境）
    // 顶层 try-catch：任何 await 抛错（模型超时/工具异常/IPC 推送失败）都兜底，
    // 避免 IPC reject 导致渲染层"界面出错"，同时恢复托盘状态
    try {
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
    // commandOutputPushed: 命令分支内是否已推送完整输出（避免末尾重复推送）
    // 流式推送（如 /screenshot vision 分析）和一次性推送（如 /monitor status）都应置 true
    let commandOutputPushed = false;
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
      } else if (routeResult.command === '/balance') {
        // /balance：查询云端 API 余额（v1.2.x 补丁）
        // 失败语义：网络超时/API 拒绝时返回友好提示，不让 handler 崩溃
        try {
          const balanceResult = await queryDeepSeekBalance();
          fullOutput = formatBalanceSummary(balanceResult);
        } catch (err) {
          console.error('[Command] /balance failed:', err);
          fullOutput = '（花冠微垂）……余额查询失败了，可能是网络问题，稍后再试吧。';
        }
      } else if (routeResult.command === '/hat') {
        // /hat：切换六顶帽模式（v1.5 多 Agent 协作）
        const enabled = getCoordinator().toggleHatMode();
        fullOutput = enabled
          ? '（花冠轻转，六片花瓣依次亮起）……六顶帽思考模式已启用，从现在开始，每个回复都会经过多角度审视哦。'
          : '（花冠微垂，花瓣渐暗）……六顶帽思考模式已关闭，回归自然对话啦。';
      } else if (routeResult.command === '/reset') {
        // /reset：一键重置（v1.6 安全功能）
        if (message.trim() === '/reset confirm') {
          const resetResult = executeReset();
          fullOutput = getResetReport(resetResult);
        } else if (message.trim() === '/reset') {
          const resetRequest = requestReset();
          fullOutput = resetRequest.message;
        } else {
          fullOutput = '（花冠微垂）……请发送 `/reset` 请求重置，或 `/reset confirm` 确认重置。';
        }
      } else if (routeResult.command === '/ab') {
        // /ab：A/B 测试管理（v1.7 人格分叉）
        const trimmed = message.trim();
        if (trimmed === '/ab start') {
          const result = startABTest();
          fullOutput = result.message;
        } else if (trimmed === '/ab stop') {
          const result = stopABTest();
          fullOutput = result.message;
        } else if (trimmed === '/ab stats') {
          const stats = getABStats();
          fullOutput = formatABStats(stats);
        } else if (trimmed === '/ab switch') {
          const result = switchGroup();
          fullOutput = result.message;
        } else {
          fullOutput = '（花冠轻转）……A/B 测试命令：\n`/ab start` 启动测试\n`/ab stop` 停止测试\n`/ab stats` 查看统计\n`/ab switch` 切换分组';
        }
      } else if (routeResult.command === '/plugin') {
        // /plugin：插件管理（v1.7 插件系统）
        const trimmed = message.trim();
        if (trimmed === '/plugin list' || trimmed === '/plugin') {
          fullOutput = formatPluginList();
        } else if (trimmed.startsWith('/plugin enable ')) {
          const pluginId = trimmed.replace('/plugin enable ', '').trim();
          const success = enablePlugin(pluginId);
          fullOutput = success
            ? `（花冠轻转）……插件 ${pluginId} 已启用`
            : `（花冠微垂）……未找到插件 ${pluginId}`;
        } else if (trimmed.startsWith('/plugin disable ')) {
          const pluginId = trimmed.replace('/plugin disable ', '').trim();
          const success = disablePlugin(pluginId);
          fullOutput = success
            ? `（花冠微垂）……插件 ${pluginId} 已禁用`
            : `（花冠微垂）……未找到插件 ${pluginId}`;
        } else {
          fullOutput = '（虚空屏微光一闪）……插件命令：\n`/plugin list` 列出插件\n`/plugin enable <id>` 启用插件\n`/plugin disable <id>` 禁用插件';
        }
      } else if (routeResult.command === '/stats') {
        // /stats：返回真实统计摘要 + 灵魂三维统计
        fullOutput = `${getTokenStatsSummary()}\n\n${getForgettingStats()}\n\n${getDreamStatus()}\n\n${getMetacognitionStats()}`;
      } else if (routeResult.command === '/pomodoro') {
        // /pomodoro：番茄钟管理（v1.9 专注模式）
        const trimmed = message.trim();
        if (trimmed === '/pomodoro' || trimmed === '/pomodoro help') {
          fullOutput = '（花冠轻转）……番茄钟专注模式命令：\n`/pomodoro start [工作时长] [标签]` 启动番茄钟（默认 25 分钟）\n`/pomodoro stop` 停止当前番茄钟\n`/pomodoro stats` 查看今日专注统计\n`/pomodoro status` 查看当前状态';
        } else if (trimmed === '/pomodoro start' || trimmed.startsWith('/pomodoro start ')) {
          const state = getPomodoroState();
          if (state.running) {
            fullOutput = `（花冠微垂）……已有番茄钟在运行中，当前阶段：${state.phase}，剩余 ${Math.max(0, Math.floor((state.phaseEndsAt - Date.now()) / 60000))} 分钟。先 /pomodoro stop 再启动新的吧。`;
          } else {
            // 解析参数：/pomodoro start [工作时长] [标签...]
            const args = trimmed.replace('/pomodoro start', '').trim();
            let workMinutes = 25;
            let label: string | undefined;
            if (args) {
              const parts = args.split(/\s+/);
              const first = parts[0] ?? '';
              const maybeNum = parseInt(first, 10);
              if (!isNaN(maybeNum) && maybeNum > 0 && maybeNum <= 120) {
                workMinutes = maybeNum;
                label = parts.slice(1).join(' ') || undefined;
              } else {
                label = args;
              }
            }
            const tool = getTool('pomodoro_start');
            if (tool) {
              const r = await tool.execute({ work_minutes: workMinutes, label }, { sessionId, userMessage: message });
              if (r.ok) {
                const data = r.data as { message: string; config: { workMinutes: number; breakMinutes: number }; state: { phaseEndsAt: number } };
                fullOutput = `（花冠轻转，铃铛轻响）……${data.message}，专注「${label ?? '当前任务'}」吧。到点我会提醒你的。`;
              } else {
                fullOutput = '（花冠微垂）……番茄钟启动失败，请稍后再试。';
              }
            } else {
              fullOutput = '（花冠微垂）……番茄钟工具未就绪。';
            }
          }
        } else if (trimmed === '/pomodoro stop') {
          const tool = getTool('pomodoro_stop');
          if (tool) {
            const r = await tool.execute({}, { sessionId, userMessage: message });
            const data = r.data as { message: string; completedToday: number };
            fullOutput = `（花冠微垂）……${data.message}。今日已完成 ${data.completedToday} 个番茄钟，辛苦了。`;
          } else {
            fullOutput = '（花冠微垂）……番茄钟工具未就绪。';
          }
        } else if (trimmed === '/pomodoro stats') {
          const tool = getTool('pomodoro_stats');
          if (tool) {
            const r = await tool.execute({}, { sessionId, userMessage: message });
            const data = r.data as {
              today: { count: number; totalMinutes: number; totalHours: number; byLabel: Record<string, number> };
              allTime: { count: number; totalMinutes: number; totalHours: number };
              current: { running: boolean; phase: string; completedWorkSessions: number };
            };
            const labelLines = Object.entries(data.today.byLabel)
              .map(([l, c]) => `  · ${l}: ${c} 个`)
              .join('\n');
            fullOutput = `（指尖虚空拨动，心识印记浮现）……今日专注统计：\n` +
              `今日：${data.today.count} 个番茄钟，${data.today.totalMinutes} 分钟（约 ${data.today.totalHours} 小时）\n` +
              (labelLines ? `按标签：\n${labelLines}\n` : '') +
              `累计：${data.allTime.count} 个，${data.allTime.totalMinutes} 分钟（约 ${data.allTime.totalHours} 小时）\n` +
              (data.current.running ? `当前：${data.current.phase} 阶段，今日已累计 ${data.current.completedWorkSessions} 个` : '当前未在专注中');
          } else {
            fullOutput = '（花冠微垂）……番茄钟工具未就绪。';
          }
        } else if (trimmed === '/pomodoro status') {
          const state = getPomodoroState();
          if (state.running) {
            const remainingMin = Math.max(0, Math.floor((state.phaseEndsAt - Date.now()) / 60000));
            const phaseLabel = state.phase === 'work' ? '工作段' : state.phase === 'break' ? '短休息' : state.phase === 'long_break' ? '长休息' : '未知';
            fullOutput = `（指尖轻点虚空屏）……番茄钟运行中：${phaseLabel}，剩余约 ${remainingMin} 分钟${state.label ? `，专注「${state.label}」` : ''}。今日已累计 ${state.completedWorkSessions} 个。`;
          } else {
            fullOutput = '（花冠微垂）……当前没有运行中的番茄钟，发送 `/pomodoro start` 开始专注吧。';
          }
        } else {
          fullOutput = '（花冠轻转）……番茄钟命令：\n`/pomodoro start [工作时长] [标签]` 启动\n`/pomodoro stop` 停止\n`/pomodoro stats` 统计\n`/pomodoro status` 当前状态';
        }
      } else if (routeResult.command === '/package') {
          // /package：社区共享包管理（v2.0）
          const trimmed = message.trim();
          if (trimmed === '/package' || trimmed === '/package help') {
            fullOutput = '（指尖虚空拨动）……社区共享包命令：\n' +
              '`/package build <name> <display> [type=full|persona|worldbook]` 打包当前 memory/ 为 .nahida-package\n' +
              '`/package install <包名或路径>` 安装一个 .nahida-package（自动备份）\n' +
              '`/package list` 列举 packages/ 下的可用包\n' +
              '`/package info <包名或路径>` 查看包详细信息';
          } else if (trimmed.startsWith('/package list')) {
            const list = listAvailablePackages();
            if (list.length === 0) {
              fullOutput = '（花冠微垂）……packages/ 目录下暂无 .nahida-package。先 `/package build` 打一个吧。';
            } else {
              const lines = list.map(p =>
                `  · ${p.name} v${p.version} [${p.packageType}] - ${p.displayName}`,
              );
              fullOutput = `（指尖虚空拨动，心识印记浮现）……packages/ 下共 ${list.length} 个包：\n${lines.join('\n')}`;
            }
          } else if (trimmed.startsWith('/package info ')) {
            const target = trimmed.replace('/package info ', '').trim();
            const info = getPackageInfo(target);
            if (!info.ok || !info.manifest) {
              fullOutput = `（花冠微垂）……${info.error ?? '包信息读取失败'}`;
            } else {
              const m = info.manifest;
              const contentFlags = [
                m.contents.persona ? '人格分片' : '',
                m.contents.worldbook ? '世界书' : '',
                m.contents.modelfile ? '模型配置' : '',
              ].filter(Boolean).join(' / ');
              fullOutput = `（指尖虚空拨动）……包信息：\n` +
                `名称：${m.displayName} (${m.name})\n` +
                `版本：${m.version}（格式 v${m.formatVersion}）\n` +
                `类型：${m.packageType}\n` +
                `作者：${m.author}（${m.license}）\n` +
                `描述：${m.description}\n` +
                `包含：${contentFlags}\n` +
                `兼容：[${m.compatibility.minAppVersion}, ${m.compatibility.maxAppVersion ?? '∞'}]\n` +
                (m.tags.length > 0 ? `标签：${m.tags.join(', ')}` : '');
            }
          } else if (trimmed.startsWith('/package install ')) {
            const target = trimmed.replace('/package install ', '').trim();
            const installResult = installPackage({ packagePath: target });
            if (installResult.ok) {
              const backedUp = installResult.backedUpFiles.length > 0
                ? `已备份 ${installResult.backedUpFiles.length} 个文件到 ${installResult.backupDir ?? 'memory/backup/'}`
                : '无需备份（受保护文件未覆盖）';
              fullOutput = `（花冠轻转，铃铛轻响）……包 ${installResult.manifest?.name ?? target} 安装成功！\n` +
                `已安装文件：${installResult.installedFiles.length} 个\n` +
                backedUp;
            } else {
              fullOutput = `（花冠微垂）……安装失败：\n${installResult.errors.join('\n')}`;
            }
          } else if (trimmed.startsWith('/package build ')) {
            // /package build <name> <display> [type]
            const argsStr = trimmed.replace('/package build ', '').trim();
            const parts = argsStr.split(/\s+/);
            const name = parts[0];
            const typeRaw = parts[2] ?? 'full';
            if (!name) {
              fullOutput = '（花冠微垂）……用法：`/package build <name> <display> [type=full|persona|worldbook]`';
            } else {
              const displayName = parts[1] ?? name;
              const packageType = (typeRaw === 'persona' || typeRaw === 'worldbook' || typeRaw === 'full')
                ? typeRaw
                : 'full';
              const contents = packageType === 'persona'
                ? { persona: true, worldbook: false, modelfile: false }
                : packageType === 'worldbook'
                  ? { persona: false, worldbook: true, modelfile: false }
                  : { persona: true, worldbook: true, modelfile: false };
              const buildResult = buildPackage({
                name,
                displayName,
                description: `${displayName} - 由 Nahida Agent 打包`,
                version: '1.0.0',
                author: 'nahida-agent-user',
                packageType,
                contents,
                minAppVersion: '2.0.0',
                tags: [],
              });
              if (buildResult.ok && buildResult.packagePath) {
                const sizeKb = (buildResult.totalSize / 1024).toFixed(1);
                fullOutput = `（花冠轻转，铃铛轻响）……包 ${name} 打包成功！\n` +
                  `位置：${buildResult.packagePath}\n` +
                  `包含文件：${buildResult.includedFiles.length} 个（${sizeKb} KB）\n` +
                  `清单：${buildResult.includedFiles.join(', ')}`;
              } else {
                fullOutput = `（花冠微垂）……打包失败：\n${buildResult.errors.join('\n')}`;
              }
            }
          } else {
            fullOutput = '（指尖虚空拨动）……社区共享包命令：\n' +
              '`/package build <name> <display> [type]` 打包\n`/package install <包名>` 安装\n`/package list` 列举\n`/package info <包名>` 详情';
          }
        } else if (routeResult.command === '/wakeup') {
          // /wakeup：语音唤醒管理（v2.3）
          const trimmed = message.trim();
          if (trimmed === '/wakeup' || trimmed === '/wakeup help') {
            fullOutput = '（花冠轻转，铃铛轻响）……语音唤醒命令：\n' +
              '`/wakeup on` 开启语音唤醒（需要 Whisper 模型）\n' +
              '`/wakeup off` 关闭语音唤醒\n' +
              '`/wakeup toggle` 切换唤醒状态\n' +
              '`/wakeup status` 查看当前状态\n' +
              '`/wakeup backend <web-speech|openai-whisper|whisper-cpp>` 切换 STT 后端';
          } else if (trimmed === '/wakeup on') {
            const result = startWakeup();
            fullOutput = result.success
              ? `（花冠轻转，花冠花瓣微微颤动）……${result.message}`
              : `（花冠微垂）……${result.message}`;
          } else if (trimmed === '/wakeup off') {
            const result = stopWakeup();
            fullOutput = result.success
              ? `（花冠微垂）……${result.message}`
              : `（花冠微垂）……${result.message}`;
          } else if (trimmed === '/wakeup toggle') {
            const result = toggleWakeup();
            fullOutput = result.enabled
              ? `（花冠轻转，铃铛轻响）……${result.message}`
              : `（花冠微垂）……${result.message}`;
          } else if (trimmed === '/wakeup status') {
            const state = getWakeupState();
            const sttState = getSTTState();
            const statusLabel = state.state === 'listening' ? '监听中'
              : state.state === 'detected' ? '已唤醒'
              : state.state === 'idle' ? '已停止'
              : state.state === 'disabled' ? '未启用'
              : state.state;
            fullOutput = `（指尖轻点虚空屏）……语音唤醒状态：\n` +
              `唤醒：${statusLabel}（累计触发 ${state.counter} 次）\n` +
              `STT 后端：${sttState.backend}\n` +
              `监听间隔：${state.config.listenIntervalMs}ms\n` +
              `唤醒词：${state.config.keywords.join('、')}`;
          } else if (trimmed.startsWith('/wakeup backend ')) {
            const backendStr = trimmed.replace('/wakeup backend ', '').trim();
            if (backendStr === 'web-speech' || backendStr === 'openai-whisper' || backendStr === 'whisper-cpp') {
              const result = switchBackend(backendStr);
              fullOutput = result.success
                ? `（花冠轻转）……${result.message}`
                : `（花冠微垂）……${result.message}`;
            } else {
              fullOutput = '（花冠微垂）……后端类型有误，请选择：web-speech / openai-whisper / whisper-cpp';
            }
          } else {
            fullOutput = '（花冠轻转）……语音唤醒命令：\n`/wakeup on` 开启\n`/wakeup off` 关闭\n`/wakeup toggle` 切换\n`/wakeup status` 状态\n`/wakeup backend <类型>` 切换后端';
          }
        } else if (routeResult.command === '/group') {
          const trimmed = message.trim();
          if (trimmed === '/group' || trimmed === '/group help') {
            fullOutput = '（花冠轻转，铃铛轻响）……群聊模式命令：\n' +
              '`/group create <群名> [成员1,成员2,...]` 创建群聊\n' +
              '`/group list` 列出所有群聊\n' +
              '`/group info <群ID>` 查看群详情\n' +
              '`/group delete <群ID>` 删除群聊\n' +
              '`/group add <群ID> <人格ID>` 添加 Agent 成员\n' +
              '`/group remove <群ID> <成员ID>` 移除 Agent 成员\n' +
              '`/group token <群ID> [成员ID] <token数>` 设置 token 限制\n' +
              '`/group send <群ID> <消息>` 发送消息到群聊\n' +
              '`/group agents` 查看可用人格列表';
          } else if (trimmed === '/group agents') {
            const personalities = getAvailablePersonalities();
            if (personalities.length === 0) {
              fullOutput = '（花冠微垂）……暂无可用人格，先创建一个吧。';
            } else {
              const lines = personalities.map(p =>
                `  · ${p.id} - ${p.displayName}（${p.description}）`,
              );
              fullOutput = `（指尖虚空拨动，心识印记浮现）……可用人格共 ${personalities.length} 个：\n${lines.join('\n')}`;
            }
          } else if (trimmed.startsWith('/group create ')) {
            const argsStr = trimmed.replace('/group create ', '').trim();
            const parts = argsStr.split(/\s+/);
            const groupName = parts[0];
            if (!groupName) {
              fullOutput = '（花冠微垂）……用法：`/group create <群名> [成员1,成员2,...]`';
            } else {
              const membersStr = parts.slice(1).join(' ');
              const initialMembers = membersStr ? membersStr.split(',').map(m => m.trim()).filter(Boolean) : [];
              const group = createGroup(groupName, initialMembers);
              if (group) {
                const memberNames = group.members.filter(m => m.type === 'ai').map(m => m.name).join('、');
                fullOutput = `（花冠轻转，铃铛轻响）……群聊「${group.name}」创建成功！\n` +
                  `群 ID：${group.groupId}\n` +
                  `成员：旅行者 + ${memberNames || '暂无 AI 成员'}\n` +
                  `默认 token 限制：${group.defaultTokenLimit} token`;
              } else {
                fullOutput = '（花冠微垂）……群聊创建失败。';
              }
            }
          } else if (trimmed === '/group list') {
            const groupsList = listGroups();
            if (groupsList.length === 0) {
              fullOutput = '（花冠微垂）……暂无群聊，发送 `/group create <群名>` 创建一个吧。';
            } else {
              const lines = groupsList.map(g => {
                const aiCount = g.members.filter(m => m.type === 'ai').length;
                return `  · ${g.name}（${g.groupId}）- ${aiCount} 个 AI 成员，${g.messages.length} 条消息`;
              });
              fullOutput = `（指尖虚空拨动，心识印记浮现）……共 ${groupsList.length} 个群聊：\n${lines.join('\n')}`;
            }
          } else if (trimmed.startsWith('/group info ')) {
            const groupId = trimmed.replace('/group info ', '').trim();
            const group = getGroup(groupId);
            if (!group) {
              fullOutput = '（花冠微垂）……未找到该群聊。';
            } else {
              const memberLines = group.members.map(m => {
                const typeLabel = m.type === 'user' ? '（你）' : '（AI）';
                const tokenLabel = m.tokenLimit > 0 ? `，token限制：${m.tokenLimit}` : '';
                return `  · ${m.name}${typeLabel}${tokenLabel}`;
              });
              fullOutput = `（指尖虚空拨动）……群聊信息：\n` +
                `群名：${group.name}\n` +
                `群 ID：${group.groupId}\n` +
                `创建时间：${new Date(group.createdAt).toLocaleString()}\n` +
                `成员（${group.members.length}人）：\n${memberLines.join('\n')}\n` +
                `消息数：${group.messages.length} 条\n` +
                `默认 token 限制：${group.defaultTokenLimit}`;
            }
          } else if (trimmed.startsWith('/group delete ')) {
            const groupId = trimmed.replace('/group delete ', '').trim();
            const success = deleteGroup(groupId);
            fullOutput = success
              ? '（花冠微垂）……群聊已删除。'
              : '（花冠微垂）……未找到该群聊。';
          } else if (trimmed.startsWith('/group add ')) {
            const argsStr = trimmed.replace('/group add ', '').trim();
            const parts = argsStr.split(/\s+/);
            const groupId = parts[0];
            const personalityId = parts[1];
            if (!groupId || !personalityId) {
              fullOutput = '（花冠微垂）……用法：`/group add <群ID> <人格ID>`';
            } else {
              const success = addAgent(groupId, personalityId);
              const personality = getAvailablePersonalities().find(p => p.id === personalityId);
              fullOutput = success
                ? `（花冠轻转）……已添加 ${personality?.displayName ?? personalityId} 到群聊。`
                : '（花冠微垂）……添加失败，请检查群 ID 和人格 ID 是否正确。';
            }
          } else if (trimmed.startsWith('/group remove ')) {
            const argsStr = trimmed.replace('/group remove ', '').trim();
            const parts = argsStr.split(/\s+/);
            const groupId = parts[0];
            const memberId = parts[1];
            if (!groupId || !memberId) {
              fullOutput = '（花冠微垂）……用法：`/group remove <群ID> <成员ID>`';
            } else {
              const success = removeAgent(groupId, memberId);
              fullOutput = success
                ? '（花冠微垂）……已移除该成员。'
                : '（花冠微垂）……移除失败，请检查群 ID 和成员 ID 是否正确。';
            }
          } else if (trimmed.startsWith('/group token ')) {
            const argsStr = trimmed.replace('/group token ', '').trim();
            const parts = argsStr.split(/\s+/);
            if (parts.length < 2) {
              fullOutput = '（花冠微垂）……用法：`/group token <群ID> [成员ID] <token数>`';
            } else {
              const groupId = parts[0]!;
              const limitStr = parts[parts.length - 1]!;
              const limit = parseInt(limitStr, 10);
              const memberId = parts.length > 2 ? parts[1]! : null;

              if (isNaN(limit)) {
                fullOutput = '（花冠微垂）……token 数必须是数字。';
              } else {
                const success = setTokenLimit(groupId, memberId, limit);
                fullOutput = success
                  ? `（花冠轻转）……${memberId ? `${memberId} 的` : '默认'} token 限制已设为 ${limit}。`
                  : '（花冠微垂）……设置失败，请检查群 ID 是否正确。';
              }
            }
          } else if (trimmed.startsWith('/group send ')) {
            const argsStr = trimmed.replace('/group send ', '').trim();
            const firstSpace = argsStr.indexOf(' ');
            if (firstSpace === -1) {
              fullOutput = '（花冠微垂）……用法：`/group send <群ID> <消息>`';
            } else {
              const groupId = argsStr.slice(0, firstSpace);
              const sendContent = argsStr.slice(firstSpace + 1);
              const group = getGroup(groupId);
              if (!group) {
                fullOutput = '（花冠微垂）……未找到该群聊。';
              } else if (!sendContent.trim()) {
                fullOutput = '（花冠微垂）……消息内容不能为空。';
              } else {
                // 事务边界修复：先推送"正在广播"提示（不结束消息），再 await broadcastMessage
                // 避免先推 finishReason:'stop' 再覆盖 fullOutput 导致重复消息
                const pendingMsg = `（花冠轻转）……正在向群聊「${group.name}」广播消息，请稍候……`;
                mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                  delta: pendingMsg,
                  finishReason: undefined,
                  sessionId,
                  timestamp: Date.now(),
                });

                let replyText: string;
                try {
                  const replies = await broadcastMessage(
                    groupId,
                    sendContent,
                    routeResult.degradeDecision,
                  );

                  if (replies.length === 0) {
                    replyText = '（花冠微垂）……群聊中没有 AI 成员，无法回复。';
                  } else {
                    const replyLines = replies.map(r => {
                      const limitedTag = r.isTokenLimited ? '（已截断）' : '';
                      return `\n${r.memberName}${limitedTag}：\n${r.content}`;
                    });
                    replyText = `（铃铛轻响，心识印记交错）……群聊回复：${replyLines.join('\n')}`;
                  }
                } catch (err) {
                  console.error('[Command] /group send failed:', err);
                  replyText = '（花冠微垂）……群聊广播失败，请稍后再试。';
                }

                // 推送增量回复并结束消息
                mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                  delta: `\n${replyText}`,
                  finishReason: 'stop',
                  sessionId,
                  timestamp: Date.now(),
                });

                // fullOutput 记录完整消息（供 review/tts/appendMessage 使用）
                fullOutput = `${pendingMsg}\n${replyText}`;
                commandOutputPushed = true;
              }
            }
          } else {
            fullOutput = '（花冠轻转）……群聊命令：\n`/group create` 创建\n`/group list` 列表\n`/group info` 详情\n`/group add` 添加成员\n`/group remove` 移除成员\n`/group token` 设置限制\n`/group send` 发送消息';
          }
        } else if (routeResult.command === '/screenshot') {
          // /screenshot：屏幕截图 + vision 分析（v2.8.0 视觉感知深度）
          // 所有子分支都在内部推送输出（一次性或流式），末尾不再重复推送
          commandOutputPushed = true;
          const trimmed = message.trim();
          const argPart = trimmed.replace('/screenshot', '').trim();

          if (argPart === 'list') {
            // 列出所有显示器
            fullOutput = formatDisplayList();
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          } else if (argPart === 'region') {
            // v2.11: 区域截图模式 — 多屏版
            const displays = listDisplays();
            fullOutput = displays.length > 1
              ? `（花冠微垂）……检测到 ${displays.length} 个显示器，区域截图窗口已在所有屏幕打开。请在任意屏幕上拖动鼠标框选要分析的区域，按 ESC 取消。`
              : '（花冠微垂）……区域截图窗口已打开，请拖动鼠标框选要分析的屏幕区域，按 ESC 取消。';
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });

            // 显示覆盖窗口，等待用户选区
            const region = await showRegionOverlay();
            if (!region) {
              // 用户取消
              const cancelMsg = '（花冠微垂）……区域截图已取消。';
              mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                delta: cancelMsg,
                finishReason: 'stop',
                sessionId,
                timestamp: Date.now(),
              });
            } else {
              // 用户选好区域，按 displayId 截图 + 裁剪
              const regionResult = await captureRegion(
                { x: region.x, y: region.y, width: region.width, height: region.height },
                region.displayId,
              );
              if (!regionResult.ok || !regionResult.base64) {
                const errMsg = `（花冠微垂）……区域截图失败，${regionResult.error ?? '未知错误'}`;
                mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                  delta: errMsg,
                  finishReason: 'stop',
                  sessionId,
                  timestamp: Date.now(),
                });
              } else {
                // 流式推送 vision 分析
                const visionResult = await processVisionRequest(
                  [regionResult.base64],
                  '请描述这张截图的内容。',
                  (delta: string, done: boolean) => {
                    mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                      delta,
                      finishReason: done ? 'stop' : undefined,
                      sessionId,
                      timestamp: Date.now(),
                    });
                  },
                );
                fullOutput = visionResult.description;

                // 推送 vision 结果
                if (regionResult.path) {
                  mainWindow.webContents.send(IpcChannel.VISION_RESULT, {
                    sessionId,
                    description: visionResult.description,
                    ocrText: visionResult.ocrText,
                    imagePaths: [regionResult.path],
                    timestamp: Date.now(),
                  });
                  appendMessage(sessionId, 'user', '/screenshot region', undefined, [regionResult.path]);
                }
                appendMessage(sessionId, 'assistant', fullOutput, undefined);

                // Live2D + TTS 联动
                const emotionEnum = resolveActionEmotion(fullOutput) ?? NahidaEmotion.Greeting;
                const expression = resolveExpression(emotionEnum);
                live2dWindow.webContents.send(IpcChannel.LIVE2D_ACTION, {
                  actionTag: fullOutput.match(ACTION_BRACKET_RE)?.[0] ?? '',
                  expression,
                  priority: 0,
                });

                const ttsText = stripActionTags(fullOutput);
                if (ttsText.trim()) {
                  void ttsScheduler.enqueue({
                    text: ttsText,
                    emotion: emotionEnum,
                    sessionId,
                  }).then((ttsResult) => {
                    if (!ttsResult) return;
                    mainWindow.webContents.send(IpcChannel.TTS_CHUNK, {
                      chunkIndex: 0,
                      totalChunks: 1,
                      audioBase64: ttsResult.audioBase64,
                      voiceType: emotionEnum,
                    });
                    live2dWindow.webContents.send(IpcChannel.TTS_CHUNK, {
                      chunkIndex: 0,
                      totalChunks: 1,
                      audioBase64: ttsResult.audioBase64,
                      voiceType: emotionEnum,
                    });
                  }).catch((err: unknown) => {
                    console.error('[TTS] enqueue failed (/screenshot region):', err);
                  });
                }
              }
            }
          } else if (argPart === '' || argPart === 'help') {
            // 帮助
            fullOutput = COMMAND_RESPONSES['/screenshot'];
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          } else {
            // 判断参数是显示器 ID 还是自定义提问
            const displays = listDisplays();
            const matchedDisplay = displays.find(d => d.id === argPart);

            const customPrompt = matchedDisplay ? '请描述这张截图的内容。' : argPart;
            const displayId = matchedDisplay?.id;

            // 截屏 + vision 分析
            if (matchedDisplay) {
              // 指定显示器
              const screenshotResult = await captureScreen({ displayId });
              if (!screenshotResult.ok || !screenshotResult.base64) {
                fullOutput = `（花冠微垂）……截屏失败，${screenshotResult.error ?? '未知错误'}`;
                mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                  delta: fullOutput,
                  finishReason: 'stop',
                  sessionId,
                  timestamp: Date.now(),
                });
              } else {
                // 流式推送 vision 分析
                const visionResult = await processVisionRequest(
                  [screenshotResult.base64],
                  customPrompt,
                  (delta: string, done: boolean) => {
                    mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                      delta,
                      finishReason: done ? 'stop' : undefined,
                      sessionId,
                      timestamp: Date.now(),
                    });
                  },
                );
                fullOutput = visionResult.description;

                // 推送 vision 结果
                mainWindow.webContents.send(IpcChannel.VISION_RESULT, {
                  sessionId,
                  description: visionResult.description,
                  ocrText: visionResult.ocrText,
                  imagePaths: visionResult.imagePaths,
                  timestamp: Date.now(),
                });

                appendMessage(sessionId, 'user', trimmed, undefined, visionResult.imagePaths);
                appendMessage(sessionId, 'assistant', fullOutput, undefined);
              }
            } else {
              // 自定义提问，截主屏
              const result = await captureAndAnalyze(customPrompt, (delta: string, done: boolean) => {
                mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
                  delta,
                  finishReason: done ? 'stop' : undefined,
                  sessionId,
                  timestamp: Date.now(),
                });
              });
              fullOutput = result.description;

              if (result.screenshot.ok && result.screenshot.path) {
                // 推送 vision 结果
                mainWindow.webContents.send(IpcChannel.VISION_RESULT, {
                  sessionId,
                  description: result.description,
                  ocrText: result.ocrText,
                  imagePaths: [result.screenshot.path],
                  timestamp: Date.now(),
                });

                appendMessage(sessionId, 'user', trimmed, undefined, [result.screenshot.path]);
                appendMessage(sessionId, 'assistant', fullOutput, undefined);
              }
            }

            // Live2D 动作 + TTS（与 vision 路径一致）
            const emotionEnum = resolveActionEmotion(fullOutput) ?? NahidaEmotion.Greeting;
            const expression = resolveExpression(emotionEnum);
            live2dWindow.webContents.send(IpcChannel.LIVE2D_ACTION, {
              actionTag: fullOutput.match(ACTION_BRACKET_RE)?.[0] ?? '',
              expression,
              priority: 0,
            });

            const ttsText = stripActionTags(fullOutput);
            if (ttsText.trim()) {
              void ttsScheduler.enqueue({
                text: ttsText,
                emotion: emotionEnum,
                sessionId,
              }).then((ttsResult) => {
                if (!ttsResult) return;
                mainWindow.webContents.send(IpcChannel.TTS_CHUNK, {
                  chunkIndex: 0,
                  totalChunks: 1,
                  audioBase64: ttsResult.audioBase64,
                  voiceType: emotionEnum,
                });
                live2dWindow.webContents.send(IpcChannel.TTS_CHUNK, {
                  chunkIndex: 0,
                  totalChunks: 1,
                  audioBase64: ttsResult.audioBase64,
                  voiceType: emotionEnum,
                });
              }).catch((err: unknown) => {
                console.error('[TTS] enqueue failed (/screenshot default):', err);
              });
            }
          }
        } else if (routeResult.command === '/monitor') {
          // v2.16: 屏幕实时监控（定时截图 + 帧差检测 + 自动 vision 分析）
          // 所有子分支都在内部推送输出，末尾不再重复推送
          commandOutputPushed = true;
          const trimmed = message.trim();
          const argPart = trimmed.replace('/monitor', '').trim();

          if (argPart === 'start') {
            // 开始监控
            const state = startScreenMonitor();
            fullOutput = `（花冠轻转，虚空屏微光流转）……屏幕监控已启动。\n间隔：${state.config.intervalMs ?? 2000}ms\n帧差阈值：${state.config.threshold ?? 5}%\n自动分析：${state.config.autoAnalyze ?? true ? '开启' : '关闭'}\n\n画面变化超过阈值时，我会自动分析屏幕内容。用 \`/monitor stop\` 停止监控。`;
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          } else if (argPart === 'stop') {
            // 停止监控
            const state = stopScreenMonitor();
            fullOutput = `（花冠微垂）……屏幕监控已停止。\n共捕获 ${state.frameCount} 帧，检测到 ${state.changeCount} 次画面变化。`;
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          } else if (argPart === 'status') {
            // 查询状态
            const state = getScreenMonitorState();
            fullOutput = `（轻托腮）……屏幕监控${state.isActive ? '运行中' : '未运行'}。\n${state.isActive ? `已捕获 ${state.frameCount} 帧，检测到 ${state.changeCount} 次变化` : ''}`;
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          } else {
            // 帮助
            fullOutput = '（花冠微垂）……屏幕监控命令：\n`/monitor start` 开始监控（定时截图，画面变化超过 5% 时自动分析）\n`/monitor stop` 停止监控\n`/monitor status` 查询状态\n\n默认配置：间隔 2 秒，帧差阈值 5%，自动分析开启。';
            mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
              delta: fullOutput,
              finishReason: 'stop',
              sessionId,
              timestamp: Date.now(),
            });
          }
        } else {
          fullOutput = COMMAND_RESPONSES[routeResult.command ?? '/help'];
      }
      // 一次性推送完整回复（如果命令分支内未已推送）
      if (!commandOutputPushed) {
        mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta: fullOutput,
          finishReason: 'stop',
          sessionId,
          timestamp: Date.now(),
        });
      }
    } else if (payload.images && payload.images.length > 0) {
      // v2.5: 多模态输入 — 用户附带图片，走 vision 路径
      const visionResult = await processVisionRequest(
        payload.images,
        message,
        (delta: string, done: boolean) => {
          mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
            delta,
            finishReason: done ? 'stop' : undefined,
            sessionId,
            timestamp: Date.now(),
          });
        },
      );

      // 推送 vision 结果
      mainWindow.webContents.send(IpcChannel.VISION_RESULT, {
        sessionId,
        description: visionResult.description,
        ocrText: visionResult.ocrText,
        imagePaths: visionResult.imagePaths,
        timestamp: Date.now(),
      });

      fullOutput = visionResult.description;

      // 记录到 session（带图片路径）
      appendMessage(sessionId, 'user', message, undefined, visionResult.imagePaths);
      appendMessage(sessionId, 'assistant', fullOutput, undefined);

      // 后续走 TTS + Live2D 联动（与普通对话一致）
      const emotionEnum = resolveActionEmotion(fullOutput) ?? NahidaEmotion.Greeting;
      const expression = resolveExpression(emotionEnum);
      live2dWindow.webContents.send(IpcChannel.LIVE2D_ACTION, {
        actionTag: fullOutput.match(ACTION_BRACKET_RE)?.[0] ?? '',
        expression,
        priority: 0,
      });

      // TTS 合成（清洗动作 tag 后）
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
            voiceType: emotionEnum,
          });
          live2dWindow.webContents.send(IpcChannel.TTS_CHUNK, {
            chunkIndex: 0,
            totalChunks: 1,
            audioBase64: result.audioBase64,
            voiceType: emotionEnum,
          });
        }).catch((err: unknown) => {
          console.error('[TTS] enqueue failed (images):', err);
        });
      }
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

    // ── 灵魂三维：元认知分析 ──
    // 在流式输出完成后，分析置信度，必要时追加不确定性提示
    const metaResult = analyzeMetacognition(fullOutput, routeResult.degradeDecision.modelId);
    if (metaResult.shouldExpressUncertainty) {
      const hinted = appendMetacognitionHint(fullOutput, metaResult);
      // 如果追加了提示，通过 IPC 推送增量
      if (hinted !== fullOutput) {
        mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta: hinted.slice(fullOutput.length),
          finishReason: 'stop',
          sessionId,
          timestamp: Date.now(),
        });
        fullOutput = hinted;
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
      }).catch((err: unknown) => {
        console.error('[TTS] enqueue failed (main):', err);
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
    } catch (err) {
      // 兜底：恢复托盘状态 + 推送友好提示 + 返回错误响应
      console.error('[AGENT_CHAT] handler failed:', err);
      updateTrayStatus('online');
      const errSessionId = payload.sessionId ?? 'test-session';
      try {
        mainWindow.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta: '（花冠微垂）……心识流转受阻，刚刚那段没能完成，可以再说一次吗？',
          finishReason: 'stop',
          sessionId: errSessionId,
          timestamp: Date.now(),
        });
      } catch (sendErr) {
        console.error('[AGENT_CHAT] fallback send failed:', sendErr);
      }
      return {
        ok: false,
        echo: payload.message,
        error: String(err),
      };
    }
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

  // balance:get —— 获取 API 余额（渲染层 Sidebar 按钮用）
  registerValidatedHandler(IpcChannel.BALANCE_GET, async () => {
    const result = await queryDeepSeekBalance();
    return {
      ok: result.ok,
      summary: formatBalanceSummary(result),
      provider: result.provider,
      error: result.error,
    };
  });

  // v1.8: 语音输入 STT —— 开始识别
  registerValidatedHandler(IpcChannel.STT_START, async (_event, payload: SttStartPayload) => {
    const result = startSTT(payload);
    return result;
  });

  // v1.8: 语音输入 STT —— 停止识别
  registerValidatedHandler(IpcChannel.STT_STOP, async () => {
    const result = stopSTT();
    return result;
  });

  // v1.8: 语音输入 STT —— 接收识别结果（渲染层 → 主进程）
  registerValidatedHandler(IpcChannel.STT_RESULT, async (_event, payload) => {
    // payload 已经过 sttResultSchema 严格校验，字段与 STTResult 完全对齐
    receiveResult(payload as unknown as STTResult);
    return { ok: true };
  });

  // v1.8: 对话导出
  registerValidatedHandler(IpcChannel.EXPORT_CONVERSATION, async (_event, payload) => {
    const params = payload as { sessionId: string; format: ExportFormat; includeMetadata?: boolean };
    const filePath = getDefaultExportPath(params.sessionId, params.format);
    const result = exportConversation({
      sessionId: params.sessionId,
      format: params.format,
      filePath,
      includeMetadata: params.includeMetadata ?? true,
    });
    return result;
  });

  // v2.5: 图片上传
  registerValidatedHandler(IpcChannel.IMAGE_UPLOAD, async (_event, payload) => {
    const params = payload as { base64: string; mimeType: string; source?: string; filename?: string };
    const result = saveUploadedImage(params.base64, params.mimeType);
    return result;
  });

  // v2.5: Vision 分析
  registerValidatedHandler(IpcChannel.VISION_ANALYZE, async (event, payload: VisionAnalyzePayload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const sessionId = payload.sessionId ?? 'default';

    const result = await processVisionRequest(
      payload.images,
      payload.prompt,
      (delta: string, done: boolean) => {
        win?.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta,
          finishReason: done ? 'stop' : undefined,
          sessionId,
          timestamp: Date.now(),
        });
      },
    );

    // 推送结果到渲染层
    win?.webContents.send(IpcChannel.VISION_RESULT, {
      sessionId,
      description: result.description,
      ocrText: result.ocrText,
      ocrConfidence: result.ocrConfidence,
      imagePaths: result.imagePaths,
      timestamp: Date.now(),
    });

    return result;
  });

  // v2.12: 视频上传 + 分析
  registerValidatedHandler(IpcChannel.VIDEO_UPLOAD, async (event, payload: VideoUploadPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const sessionId = payload.sessionId;
    const prompt = payload.prompt?.trim() || '请描述这段视频的主要内容。';

    // 第五关 AUTH-02：filePath 入口安全校验
    // 防止渲染层被注入后直传恶意路径（如 ../../memory/SOHA.md）让 ffmpeg 读取并经 vision 描述回传
    const safePath = isSafeVideoPath(payload.filePath);
    if (!safePath) {
      console.error('[VIDEO_UPLOAD] rejected unsafe filePath:', payload.filePath.slice(0, 200));
      win?.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
        delta: '（花冠微垂）……这个视频路径不太对劲，没法直接读取哦。请通过附件按钮重新选择视频文件吧。',
        finishReason: 'stop',
        sessionId,
        timestamp: Date.now(),
      });
      return {
        ok: false,
        description: '视频路径安全校验失败',
        frameCount: 0,
        duration: 0,
        imagePaths: [],
        error: 'unsafe video path',
      };
    }

    // 先告诉用户正在处理
    win?.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
      delta: `（花冠微垂，凝神注视）……我正在看这段视频「${payload.fileName}」，稍等片刻哦~`,
      finishReason: undefined,
      sessionId,
      timestamp: Date.now(),
    });

    const result = await processVideoRequest(
      safePath,
      prompt,
      (delta: string, done: boolean) => {
        win?.webContents.send(IpcChannel.AGENT_MODEL_DELTA, {
          delta,
          finishReason: done ? 'stop' : undefined,
          sessionId,
          timestamp: Date.now(),
        });
      },
    );

    if (result.ok) {
      // 推送视频分析结果
      win?.webContents.send(IpcChannel.VIDEO_RESULT, {
        sessionId,
        description: result.description,
        frameCount: result.frameCount,
        duration: result.duration,
        imagePaths: result.imagePaths,
        strategy: result.strategy,
        ocrText: result.ocrText,
        ocrConfidence: result.ocrConfidence,
        timestamp: Date.now(),
      });

      // 持久化消息
      appendMessage(sessionId, 'user', `[视频] ${payload.fileName}：${prompt}`, undefined, result.imagePaths);
      appendMessage(sessionId, 'assistant', result.description, undefined);

      // Live2D + TTS 联动
      const emotionEnum = resolveActionEmotion(result.description) ?? NahidaEmotion.Greeting;
      const expression = resolveExpression(emotionEnum);
      live2dWindow.webContents.send(IpcChannel.LIVE2D_ACTION, {
        actionTag: result.description.match(ACTION_BRACKET_RE)?.[0] ?? '',
        expression,
        priority: 0,
      });

      const ttsText = stripActionTags(result.description);
      if (ttsText.trim()) {
        void ttsScheduler.enqueue({
          text: ttsText,
          emotion: emotionEnum,
          sessionId,
        }).then((ttsResult) => {
          if (!ttsResult) return;
          win?.webContents.send(IpcChannel.TTS_CHUNK, {
            chunkIndex: 0,
            totalChunks: 1,
            audioBase64: ttsResult.audioBase64,
            voiceType: emotionEnum,
          });
          live2dWindow.webContents.send(IpcChannel.TTS_CHUNK, {
            chunkIndex: 0,
            totalChunks: 1,
            audioBase64: ttsResult.audioBase64,
            voiceType: emotionEnum,
          });
        }).catch((err: unknown) => {
          console.error('[TTS] enqueue failed (video):', err);
        });
      }
    }

    return result;
  });

  // v2.16: 屏幕实时监控
  registerValidatedHandler(IpcChannel.MONITOR_START, async (event, payload) => {
    const params = payload as { intervalMs?: number; threshold?: number; autoAnalyze?: boolean };
    const win = BrowserWindow.fromWebContents(event.sender);

    const state = startScreenMonitor(
      {
        intervalMs: params.intervalMs,
        threshold: params.threshold,
        autoAnalyze: params.autoAnalyze,
      },
      (result) => {
        // 监控分析结果推送
        win?.webContents.send(IpcChannel.VISION_RESULT, {
          sessionId: 'monitor',
          description: result.description,
          ocrText: result.ocrText,
          ocrConfidence: result.ocrConfidence,
          imagePaths: result.imagePaths,
          timestamp: Date.now(),
        });
      },
    );

    win?.webContents.send(IpcChannel.MONITOR_FRAME, {
      type: 'started',
      state,
      timestamp: Date.now(),
    });

    return state;
  });

  registerValidatedHandler(IpcChannel.MONITOR_STOP, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const state = stopScreenMonitor();

    win?.webContents.send(IpcChannel.MONITOR_FRAME, {
      type: 'stopped',
      state,
      timestamp: Date.now(),
    });

    return state;
  });

  registerValidatedHandler(IpcChannel.MONITOR_STATE, async () => {
    return getScreenMonitorState();
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
// 预编译正则：动作括号提取（供 Live2D 驱动）
const ACTION_BRACKET_RE = /[（(]([^）)]{1,20})[）)]/;

// 预编译正则：TTS 文本清洗（去除动作括号和情绪标签）
const TTS_ACTION_RE = /（[^）]*）/g;
const TTS_EMOTION_RE = /\[emotion:[^\]]*\]/g;

function stripActionTags(text: string): string {
  return text
    .replace(TTS_ACTION_RE, '')   // 中文括号及内容
    .replace(TTS_EMOTION_RE, '')  // 情绪标签
    .trim();
}
