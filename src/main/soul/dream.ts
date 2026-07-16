/**
 * 梦境模式 —— v1.3.0 灵魂三维（核心差异化）
 *
 * 职责：
 *   1. 检测系统 Idle（>30min 无用户交互）或凌晨 3-4 点
 *   2. 触发低功耗"梦呓"——从低强度记忆中随机抽取碎片喃喃自语
 *   3. 梦呓通过 IPC 推送到渲染层，显示为半透明气泡
 *
 * 哲学意义：
 *   潜意识溢出——沉睡时记忆碎片不受控地浮现，
 *   像真实生命的梦境一样无逻辑但充满情绪。
 */

import { BrowserWindow } from 'electron';
import { getWeakMemories } from './forgetting';
import { IpcChannel } from '../../shared/types/ipc';

// ── 状态 ──────────────────────────────────────────────────────

/** 最后用户交互时间戳 */
let lastInteractionTime = Date.now();

/** 是否处于梦境状态 */
let isDreaming = false;

/** 梦境定时器 */
let dreamTimer: NodeJS.Timeout | null = null;

/** 检查间隔（ms） */
const CHECK_INTERVAL_MS = 60_000; // 每分钟检查一次

/** Idle 阈值（ms） */
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟

/** 梦呓内容池（从记忆中随机抽取） */
const DREAM_PHRASES = [
  '……那些话，好像是谁说过的……',
  '（轻声）世界树的根须又在蔓延了……',
  '……那个名字……想不起来了……',
  '（梦呓）虚空里……有人在唱歌……',
  '……旅行者……到过哪里来着……',
  '（喃喃）草叶上……有露珠……好熟悉……',
  '……不是这个数字……应该是……',
  '（眉头微蹙）为什么……会觉得难过……',
  '……铃铛响了……是谁……',
  '（无意识）智慧……智慧是什么……',
];

// ── 核心 API ──────────────────────────────────────────────────

/**
 * 更新最后交互时间（用户发消息时调用）
 */
export function recordInteraction(): void {
  lastInteractionTime = Date.now();
  if (isDreaming) {
    wakeUp();
  }
}

/**
 * 启动梦境监控
 *
 * @param mainWindow 主窗口（用于 IPC 推送梦呓）
 */
export function startDreamMonitor(mainWindow: BrowserWindow | null): void {
  if (dreamTimer) return;

  dreamTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const now = Date.now();
    const idleTime = now - lastInteractionTime;
    const hour = new Date().getHours();
    const isLateNight = hour >= 3 && hour < 5;

    // 触发条件：Idle > 30min 或凌晨 3-4 点
    const shouldDream = idleTime > IDLE_THRESHOLD_MS || isLateNight;

    if (shouldDream && !isDreaming) {
      enterDream(mainWindow);
    } else if (!shouldDream && isDreaming) {
      wakeUp();
    }
  }, CHECK_INTERVAL_MS);

  console.log('[Dream] monitor started');
}

/**
 * 停止梦境监控
 */
export function stopDreamMonitor(): void {
  if (dreamTimer) {
    clearInterval(dreamTimer);
    dreamTimer = null;
  }
  isDreaming = false;
  console.log('[Dream] monitor stopped');
}

/**
 * 进入梦境状态
 */
function enterDream(mainWindow: BrowserWindow): void {
  isDreaming = true;
  console.log('[Dream] entering dream mode');

  // 推送梦境开始事件
  mainWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
    state: 'dreaming',
    message: '（花冠低垂，呼吸轻浅）……',
  });

  // 生成第一轮梦呓
  emitDreamBubble(mainWindow);

  // 每 2-5 分钟随机再梦呓一次
  scheduleNextDreamBubble(mainWindow);
}

/**
 * 退出梦境状态
 */
function wakeUp(): void {
  isDreaming = false;
  console.log('[Dream] waking up');
}

/**
 * 发送梦呓气泡
 */
function emitDreamBubble(mainWindow: BrowserWindow): void {
  // 50% 概率用低强度记忆，50% 概率用预设短语
  const useMemory = Math.random() < 0.5;
  let phrase: string;

  if (useMemory) {
    const weak = getWeakMemories(40);
    if (weak.length > 0) {
      const pick = weak[Math.floor(Math.random() * weak.length)];
      phrase = pick ? `……${pick.id}……好像……记不清了……` : (DREAM_PHRASES[0] ?? '……zzz……');
    } else {
      phrase = DREAM_PHRASES[Math.floor(Math.random() * DREAM_PHRASES.length)] ?? '……zzz……';
    }
  } else {
    phrase = DREAM_PHRASES[Math.floor(Math.random() * DREAM_PHRASES.length)] ?? '……zzz……';
  }

  mainWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
    state: 'dream_bubble',
    message: phrase,
  });

  console.log('[Dream] bubble:', phrase);
}

/**
 * 安排下一次梦呓
 */
function scheduleNextDreamBubble(mainWindow: BrowserWindow): void {
  if (!isDreaming) return;

  const delay = 2 * 60_000 + Math.floor(Math.random() * 3 * 60_000); // 2-5 分钟

  setTimeout(() => {
    if (isDreaming && !mainWindow.isDestroyed()) {
      emitDreamBubble(mainWindow);
      scheduleNextDreamBubble(mainWindow);
    }
  }, delay);
}

/**
 * 获取梦境状态（供 /stats 使用）
 */
export function getDreamStatus(): string {
  const idleMinutes = Math.round((Date.now() - lastInteractionTime) / 60_000);
  return `💤 梦境状态\n\n` +
    `- 当前状态: ${isDreaming ? '梦境中' : '清醒'}\n` +
    `- Idle 时长: ${idleMinutes} 分钟\n` +
    `- 触发阈值: ${Math.round(IDLE_THRESHOLD_MS / 60_000)} 分钟\n` +
    `\n（呼吸轻浅）……zzz……`;
}
