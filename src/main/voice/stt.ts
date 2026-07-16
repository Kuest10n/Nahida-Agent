/**
 * 语音输入模块（STT）—— v2.3，支持本地/在线双模式切换
 *
 * 职责：
 *   1. 封装 Web Speech API（在线模式）为 Electron 主进程可调用的接口
 *   2. 封装 Whisper.cpp（本地模式）实现离线语音识别
 *   3. 提供开始/停止/状态查询接口，支持模式切换
 *   4. 识别结果通过 IPC 推送到渲染层
 *
 * 架构说明：
 *   - Web Speech API：在线，依赖 Google 服务器，延迟低
 *   - Whisper.cpp：本地离线，无需网络，支持多语言，延迟较高（2-5秒）
 *   - 两种模式通过配置 sttBackend 切换
 *
 * IPC 通道：
 *   - stt:start —— 渲染层请求开始语音识别
 *   - stt:stop —— 渲染层请求停止语音识别
 *   - stt:result —— 主进程推送识别结果到渲染层
 *   - stt:state —— 推送语音识别状态变化
 */

import { BrowserWindow } from 'electron';
import { IpcChannel } from '../../shared/types/ipc';
import { runWhisperInfer } from './whisper-adapter';
import { getConfig } from '../config/config';
import type { STTBackend, VoiceConfig } from '../../shared/types/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────

export type STTState = 'idle' | 'listening' | 'processing' | 'error';

export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
  backend: STTBackend;
}

export interface STTConfig {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxDurationMs: number;
  /** STT 后端 */
  backend?: STTBackend;
}

// ── 默认配置 ──────────────────────────────────────────────────

const DEFAULT_CONFIG: STTConfig = {
  lang: 'zh-CN',
  continuous: false,
  interimResults: true,
  maxDurationMs: 30000,
  backend: 'web-speech',
};

// ── 模块状态 ──────────────────────────────────────────────────

let currentState: STTState = 'idle';
let currentConfig: STTConfig = { ...DEFAULT_CONFIG };
let sttTimer: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;

// ── 配置读取 ──────────────────────────────────────────────────

function readVoiceConfig(): Partial<VoiceConfig> {
  const config = getConfig();
  return config.voice ?? {};
}

function getEffectiveBackend(): STTBackend {
  return currentConfig.backend ?? readVoiceConfig().sttBackend ?? 'web-speech';
}

function getEffectiveLang(): string {
  return currentConfig.lang ?? readVoiceConfig().whisperLang ?? 'zh-CN';
}

function getWhisperModelPath(): string {
  const cfg = readVoiceConfig();
  return cfg.whisperModelPath?.trim() ?? path.resolve(process.cwd(), 'assets', 'whisper', 'ggml-tiny.bin');
}

// ── 核心逻辑 ──────────────────────────────────────────────────

export function initSTT(window: BrowserWindow | null): void {
  mainWindow = window;
  console.log('[STT] initialized');
}

export function startSTT(config?: Partial<STTConfig>): { success: boolean; config: STTConfig; message: string } {
  if (currentState === 'listening') {
    return { success: false, config: currentConfig, message: '已在识别中，请先停止' };
  }

  currentConfig = { ...DEFAULT_CONFIG, ...config };
  currentState = 'listening';

  pushStateChange('listening');

  if (currentConfig.maxDurationMs > 0) {
    sttTimer = setTimeout(() => {
      stopSTT();
    }, currentConfig.maxDurationMs);
  }

  const backend = getEffectiveBackend();
  console.log(`[STT] started, backend=${backend}, lang=${currentConfig.lang}`);

  let message: string;
  switch (backend) {
    case 'openai-whisper':
    case 'whisper-cpp':
      message = '语音识别已开始（本地模式），请说话……';
      break;
    case 'web-speech':
    default:
      message = '语音识别已开始（在线模式），请说话……';
      break;
  }

  return {
    success: true,
    config: currentConfig,
    message,
  };
}

export function stopSTT(): { success: boolean; message: string } {
  if (currentState !== 'listening') {
    return { success: false, message: '未在识别中' };
  }

  currentState = 'idle';

  if (sttTimer) {
    clearTimeout(sttTimer);
    sttTimer = null;
  }

  pushStateChange('idle');
  console.log('[STT] stopped');

  return { success: true, message: '语音识别已停止' };
}

/**
 * 本地模式：录制音频并调用 Whisper 识别
 */
export async function recognizeLocal(audioPath: string): Promise<{ ok: boolean; result?: STTResult; error?: string }> {
  if (!fs.existsSync(audioPath)) {
    return { ok: false, error: `音频文件不存在: ${audioPath}` };
  }

  const backend = getEffectiveBackend();
  if (backend === 'web-speech') {
    return { ok: false, error: '当前配置为在线模式，请切换到本地模式' };
  }

  currentState = 'processing';
  pushStateChange('processing');

  const result = await runWhisperInfer({
    inputPath: audioPath,
    lang: getEffectiveLang(),
    modelPath: getWhisperModelPath(),
    segments: true,
  });

  currentState = 'idle';
  pushStateChange('idle');

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? '识别失败' };
  }

  const sttResult: STTResult = {
    text: result.text.trim(),
    isFinal: true,
    confidence: result.segments?.[0]?.confidence ?? 0.5,
    timestamp: Date.now(),
    backend,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.STT_RESULT, sttResult);
  }

  return { ok: true, result: sttResult };
}

export function receiveResult(result: STTResult): void {
  if (!mainWindow) return;

  mainWindow.webContents.send(IpcChannel.STT_RESULT, result);

  if (result.isFinal && !currentConfig.continuous) {
    stopSTT();
  }
}

export function getSTTState(): { state: STTState; config: STTConfig; backend: STTBackend } {
  return { state: currentState, config: currentConfig, backend: getEffectiveBackend() };
}

export function updateSTTConfig(config: Partial<STTConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

export function switchBackend(backend: STTBackend): { success: boolean; message: string } {
  if (currentState === 'listening') {
    return { success: false, message: '请先停止语音识别再切换模式' };
  }

  currentConfig.backend = backend;

  let message: string;
  switch (backend) {
    case 'openai-whisper':
      message = '已切换到本地模式（openai-whisper），需安装 Python 依赖';
      break;
    case 'whisper-cpp':
      message = '已切换到本地模式（whisper.cpp），需编译可执行文件';
      break;
    case 'web-speech':
    default:
      message = '已切换到在线模式（Web Speech API）';
      break;
  }

  console.log(`[STT] backend switched to ${backend}`);
  return { success: true, message };
}

function pushStateChange(state: STTState): void {
  if (!mainWindow) return;
  mainWindow.webContents.send('stt:state', { state, backend: getEffectiveBackend(), timestamp: Date.now() });
}
