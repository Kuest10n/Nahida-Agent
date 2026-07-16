/**
 * 语音唤醒引擎 —— Siri 式语音唤醒（v2.3.0）
 *
 * 职责：
 *   持续监听麦克风输入，检测唤醒词（"嘿，纳西妲""小纳西妲""纳西妲"），
 *   唤醒后触发对话流程——自动开始语音识别 → 发送消息给 Agent。
 *
 * 工作原理：
 *   1. 低功耗监听：持续录制短音频片段（2-3秒）
 *   2. 唤醒词检测：使用 Whisper tiny 模型快速识别片段内容
 *   3. 关键词匹配：检测是否包含唤醒词
 *   4. 触发对话：唤醒后切换到完整语音识别模式
 *
 * 唤醒词列表（可配置）：
 *   - "纳西妲"
 *   - "嘿，纳西妲"
 *   - "小纳西妲"
 *   - "娜娜"
 *   - "七神"（可选）
 *
 * 安全约束：
 *   - 默认关闭唤醒（需要用户手动开启）
 *   - 仅在应用处于前台时监听（或可选后台监听）
 *   - 音频片段不持久化（仅用于实时检测）
 *   - 唤醒后自动停止监听，避免重复触发
 *
 * IPC 通道：
 *   - wakeup:state —— 推送唤醒状态变化
 *   - wakeup:detected —— 检测到唤醒词
 */

import { BrowserWindow } from 'electron';
import { IpcChannel } from '../../shared/types/ipc';
import { runWhisperInfer, modelExists, WHISPER_MODELS } from './whisper-adapter';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────

export type WakeupState = 'disabled' | 'idle' | 'listening' | 'detected' | 'processing' | 'error';

export interface WakeupConfig {
  /** 是否启用语音唤醒 */
  enabled: boolean;
  /** 唤醒词列表 */
  keywords: string[];
  /** 监听间隔（毫秒），建议 2000-3000 */
  listenIntervalMs: number;
  /** 置信度阈值（0-1），低于此值忽略 */
  confidenceThreshold: number;
  /** 是否后台监听（应用最小化时仍监听） */
  backgroundListen: boolean;
  /** 使用的模型（tiny/base/small） */
  modelName: string;
  /** 语言代码 */
  lang: string;
}

// ── 默认配置 ──────────────────────────────────────────────────

const DEFAULT_CONFIG: WakeupConfig = {
  enabled: false,
  keywords: ['纳西妲', '嘿，纳西妲', '小纳西妲', '娜娜'],
  listenIntervalMs: 2000,
  confidenceThreshold: 0.5,
  backgroundListen: false,
  modelName: 'tiny',
  lang: 'zh',
};

// ── 模块状态 ──────────────────────────────────────────────────

let currentState: WakeupState = 'disabled';
let currentConfig: WakeupConfig = { ...DEFAULT_CONFIG };
let listenTimer: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;
let wakeupCounter = 0;

// ── 音频录制（简化版，使用 Python subprocess） ────────────────

/**
 * 录制短音频片段到临时文件
 */
async function recordAudio(durationMs: number): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  const tempDir = path.resolve(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(tempDir, `wakeup_${Date.now()}.wav`);
  const seconds = durationMs / 1000;

  return new Promise(resolve => {
    const pythonScript = `
import pyaudio
import wave
import sys

FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1024
RECORD_SECONDS = ${seconds}
WAVE_OUTPUT_FILENAME = "${filePath.replace(/\\/g, '\\\\')}"

try:
    p = pyaudio.PyAudio()
    stream = p.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
    frames = []
    for _ in range(int(RATE / CHUNK * RECORD_SECONDS)):
        data = stream.read(CHUNK)
        frames.append(data)
    stream.stop_stream()
    stream.close()
    p.terminate()
    wf = wave.open(WAVE_OUTPUT_FILENAME, 'wb')
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(p.get_sample_size(FORMAT))
    wf.setframerate(RATE)
    wf.writeframes(b''.join(frames))
    wf.close()
    print('RECORD_OK')
except Exception as e:
    print(f'RECORD_ERROR: {e}')
    sys.exit(1)
`;

    const proc = require('child_process').spawn('python', ['-c', pythonScript], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    proc.on('close', (code: number) => {
      if (code !== 0 || !stdout.includes('RECORD_OK')) {
        const errMsg = stderr || stdout || '录制失败';
        // 清理临时文件
        try { fs.unlinkSync(filePath); } catch {}
        resolve({ ok: false, error: errMsg });
        return;
      }

      if (!fs.existsSync(filePath)) {
        resolve({ ok: false, error: '录制文件未生成' });
        return;
      }

      resolve({ ok: true, filePath });
    });

    proc.on('error', (err: Error) => {
      try { fs.unlinkSync(filePath); } catch {}
      resolve({ ok: false, error: `启动录制失败: ${err.message}` });
    });
  });
}

// ── 唤醒词检测 ────────────────────────────────────────────────

/**
 * 检测音频中是否包含唤醒词
 */
async function detectWakeupWord(audioPath: string): Promise<{ detected: boolean; keyword?: string; text?: string; confidence?: number }> {
  const result = await runWhisperInfer({
    inputPath: audioPath,
    lang: currentConfig.lang,
    modelPath: path.resolve(process.cwd(), 'assets', 'whisper', `ggml-${currentConfig.modelName}.bin`),
    segments: true,
  });

  if (!result.ok || !result.text) {
    return { detected: false };
  }

  const text = result.text.toLowerCase().trim();
  const keywords = currentConfig.keywords.map(k => k.toLowerCase());

  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      const confidence = result.segments?.[0]?.confidence ?? 0.5;
      if (confidence >= currentConfig.confidenceThreshold) {
        return { detected: true, keyword, text, confidence };
      }
    }
  }

  return { detected: false, text };
}

// ── 主监听循环 ────────────────────────────────────────────────

/**
 * 单次监听循环：录制 → 检测 → 清理
 */
async function runListenCycle(): Promise<void> {
  if (currentState !== 'listening') return;

  // 检查是否应该后台监听
  if (!currentConfig.backgroundListen && mainWindow?.isMinimized()) {
    scheduleNextListen();
    return;
  }

  // 录制音频
  const recordResult = await recordAudio(currentConfig.listenIntervalMs);
  if (!recordResult.ok || !recordResult.filePath) {
    console.warn('[Wakeup] 录制失败:', recordResult.error);
    scheduleNextListen();
    return;
  }

  // 检测唤醒词
  const detectResult = await detectWakeupWord(recordResult.filePath);

  // 清理临时文件
  try {
    fs.unlinkSync(recordResult.filePath);
  } catch {}

  if (detectResult.detected && detectResult.keyword) {
    // 唤醒！
    handleWakeupDetected(detectResult.keyword, detectResult.text, detectResult.confidence);
  } else {
    // 未检测到，继续监听
    scheduleNextListen();
  }
}

/**
 * 调度下一次监听
 */
function scheduleNextListen(): void {
  if (currentState !== 'listening') return;
  listenTimer = setTimeout(runListenCycle, 500);
}

/**
 * 处理唤醒词检测到的情况
 */
function handleWakeupDetected(keyword: string, text?: string, confidence?: number): void {
  wakeupCounter++;
  currentState = 'detected';

  console.log(`[Wakeup] ✅ 检测到唤醒词 "${keyword}"，置信度: ${confidence?.toFixed(2) ?? 'N/A'}`);

  // 推送状态到渲染层
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
      type: 'wakeup',
      keyword,
      text,
      confidence,
      counter: wakeupCounter,
      timestamp: Date.now(),
    });

    // 推送唤醒事件（渲染层可响应）
    mainWindow.webContents.send('wakeup:detected', {
      keyword,
      text,
      confidence,
    });
  }

  // 自动停止监听（避免重复触发），等待用户操作后重新启动
  stopWakeup();

  // 可选：自动开始语音识别（交给渲染层处理）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stt:start', { lang: currentConfig.lang });
  }
}

// ── 对外接口 ──────────────────────────────────────────────────

/**
 * 初始化唤醒引擎
 */
export function initWakeup(window: BrowserWindow | null): void {
  mainWindow = window;
  console.log('[Wakeup] initialized');
}

/**
 * 启动语音唤醒监听
 */
export function startWakeup(config?: Partial<WakeupConfig>): { success: boolean; message: string } {
  if (currentState === 'listening') {
    return { success: false, message: '语音唤醒已在监听中' };
  }

  // 更新配置
  currentConfig = { ...DEFAULT_CONFIG, ...config };

  // 检查模型
  const modelPath = path.resolve(process.cwd(), 'assets', 'whisper', `ggml-${currentConfig.modelName}.bin`);
  if (!fs.existsSync(modelPath)) {
    const availableModels = WHISPER_MODELS.filter(m => modelExists(m.name)).map(m => m.name);
    const msg = availableModels.length > 0
      ? `模型不存在: ${modelPath}，可用模型: ${availableModels.join(', ')}`
      : `模型不存在: ${modelPath}，请下载模型到 assets/whisper/ 目录`;
    return { success: false, message: msg };
  }

  // 检查 pyaudio
  // （延迟到运行时检查，避免启动时阻塞）

  currentState = 'listening';
  pushStateChange('listening');

  console.log(`[Wakeup] 启动监听，唤醒词: ${currentConfig.keywords.join(', ')}`);

  // 立即开始第一次监听
  void runListenCycle();

  return {
    success: true,
    message: `语音唤醒已启动，正在监听关键词：${currentConfig.keywords.join('、')}。试着说"嘿，纳西妲"吧。`,
  };
}

/**
 * 停止语音唤醒监听
 */
export function stopWakeup(): { success: boolean; message: string } {
  if (currentState !== 'listening' && currentState !== 'detected') {
    return { success: false, message: '语音唤醒未在运行中' };
  }

  if (listenTimer) {
    clearTimeout(listenTimer);
    listenTimer = null;
  }

  currentState = 'idle';
  pushStateChange('idle');

  console.log('[Wakeup] 已停止监听');

  return { success: true, message: '语音唤醒已停止' };
}

/**
 * 切换语音唤醒状态（开/关）
 */
export function toggleWakeup(): { success: boolean; enabled: boolean; message: string } {
  if (currentState === 'listening') {
    const result = stopWakeup();
    return { ...result, enabled: false };
  } else {
    const result = startWakeup();
    return { ...result, enabled: result.success };
  }
}

/**
 * 获取当前唤醒状态
 */
export function getWakeupState(): { state: WakeupState; config: WakeupConfig; counter: number } {
  return { state: currentState, config: currentConfig, counter: wakeupCounter };
}

/**
 * 更新唤醒配置
 */
export function updateWakeupConfig(config: Partial<WakeupConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

// ── 内部函数 ──────────────────────────────────────────────────

function pushStateChange(state: WakeupState): void {
  if (!mainWindow) return;
  mainWindow.webContents.send(IpcChannel.AGENT_STATE_CHANGE, {
    type: 'wakeup_state',
    state,
    timestamp: Date.now(),
  });
}
