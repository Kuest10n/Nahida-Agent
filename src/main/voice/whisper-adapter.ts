/**
 * Whisper.cpp 本地离线语音识别适配器 —— v2.3.0
 *
 * 职责：
 *   封装本地 Whisper 模型推理，提供离线语音识别能力。
 *   支持两种模式：
 *   - 模式 A：Python subprocess（openai-whisper 库）
 *   - 模式 B：Whisper.cpp 原生 CLI（whisper.cpp 可执行文件）
 *
 * 与 Web Speech API 的区别：
 *   - Web Speech API：在线，依赖 Google 服务器，延迟低但需网络
 *   - Whisper：本地离线，无需网络，支持多语言，延迟较高（2-5秒）
 *
 * 模型管理：
 *   - 默认使用 tiny 模型（快速，适合唤醒词检测）
 *   - 支持 base / small / medium / large 模型
 *   - 模型文件存放在 assets/whisper/ 目录
 *
 * 配置来源：data/config.json 的 voice 字段
 *   {
 *     "voice": {
 *       "sttBackend": "whisper-cpp" | "openai-whisper" | "web-speech",
 *       "whisperModelPath": "assets/whisper/ggml-tiny.bin",
 *       "whisperLang": "zh",
 *       "whisperDevice": "cpu"
 *     }
 *   }
 */

import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { getConfig } from '../config/config';
import type { VoiceConfig } from '../../shared/types/config';

// ── 类型 ──────────────────────────────────────────────────────

export type WhisperBackend = 'whisper-cpp' | 'openai-whisper';

export interface WhisperResult {
  ok: boolean;
  text?: string;
  segments?: Array<{ text: string; start: number; end: number; confidence: number }>;
  error?: string;
  latencyMs: number;
}

export interface WhisperInferOptions {
  /** 输入音频路径（wav，16kHz） */
  inputPath: string;
  /** 语言代码（如 zh / en / ja） */
  lang?: string;
  /** 模型路径 */
  modelPath?: string;
  /** 是否返回分段结果 */
  segments?: boolean;
  /** 是否启用 VAD（语音活动检测） */
  vad?: boolean;
}

// ── 配置读取 ──────────────────────────────────────────────────

function readVoiceConfig(): Partial<VoiceConfig> {
  const config = getConfig();
  return config.voice ?? {};
}

function getDefaultModelPath(): string {
  const cfg = readVoiceConfig();
  return cfg.whisperModelPath?.trim() ?? resolve(process.cwd(), 'assets', 'whisper', 'ggml-tiny.bin');
}

// ── 核心推理 ──────────────────────────────────────────────────

export async function runWhisperInfer(
  options: WhisperInferOptions,
  backend?: WhisperBackend,
): Promise<WhisperResult> {
  const startTime = Date.now();
  const resolvedBackend = backend ?? (readVoiceConfig().sttBackend as WhisperBackend) ?? 'openai-whisper';

  if (!existsSync(options.inputPath)) {
    return {
      ok: false,
      error: `输入音频不存在: ${options.inputPath}`,
      latencyMs: Date.now() - startTime,
    };
  }

  const modelPath = options.modelPath ?? getDefaultModelPath();
  if (!existsSync(modelPath)) {
    return {
      ok: false,
      error: `Whisper 模型不存在: ${modelPath}，请下载模型到 assets/whisper/ 目录`,
      latencyMs: Date.now() - startTime,
    };
  }

  switch (resolvedBackend) {
    case 'whisper-cpp':
      return runWhisperCpp({ ...options, modelPath, startTime });
    case 'openai-whisper':
    default:
      return runOpenaiWhisper({ ...options, modelPath, startTime });
  }
}

// ── 模式 A：openai-whisper Python 库 ─────────────────────────

interface OpenaiWhisperOptions {
  inputPath: string;
  lang?: string;
  modelPath?: string;
  segments?: boolean;
  startTime: number;
}

function runOpenaiWhisper(opts: OpenaiWhisperOptions): Promise<WhisperResult> {
  const pythonScript = `
import sys
import json

try:
    import whisper
except ImportError:
    print(json.dumps({"ok": false, "error": "openai-whisper 未安装，请执行: pip install openai-whisper"}))
    sys.exit(1)

model_path = "${opts.modelPath?.replace(/\\/g, '\\\\')}"
audio_path = "${opts.inputPath.replace(/\\/g, '\\\\')}"
lang = "${opts.lang ?? 'zh'}"

model = whisper.load_model(model_path)
result = model.transcribe(audio_path, language=lang)

output = {
    "ok": true,
    "text": result["text"],
    "segments": []
}

if "${opts.segments}" == "true" and result.get("segments"):
    output["segments"] = [
        {
            "text": seg["text"],
            "start": seg["start"],
            "end": seg["end"],
            "confidence": seg.get("confidence", 0.0)
        }
        for seg in result["segments"]
    ]

print(json.dumps(output, ensure_ascii=False))
`;

  return spawnPython(['-c', pythonScript], opts.startTime);
}

// ── 模式 B：Whisper.cpp 原生 CLI ────────────────────────────

interface WhisperCppOptions {
  inputPath: string;
  lang?: string;
  modelPath: string;
  segments?: boolean;
  startTime: number;
}

function runWhisperCpp(opts: WhisperCppOptions): Promise<WhisperResult> {
  const binaryPath = resolve(process.cwd(), 'assets', 'whisper', 'main.exe');
  if (!existsSync(binaryPath)) {
    return Promise.resolve({
      ok: false,
      error: `Whisper.cpp 可执行文件不存在: ${binaryPath}，请编译并放置到 assets/whisper/ 目录`,
      latencyMs: Date.now() - opts.startTime,
    });
  }

  const args: string[] = [
    '-m', opts.modelPath,
    '-f', opts.inputPath,
    '-l', opts.lang ?? 'zh',
    '-oj',
  ];

  if (opts.segments) {
    args.push('--segments');
  }

  return spawnPython([binaryPath, ...args], opts.startTime);
}

// ── 通用：spawn 子进程 ──────────────────────────────────────

function spawnPython(args: string[], startTime: number): Promise<WhisperResult> {
  return new Promise(resolve => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonExe, args, {
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

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `进程退出码 ${code}: ${stderr.slice(0, 500)}`,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      try {
        const jsonStr = stdout.trim();
        if (!jsonStr) {
          resolve({
            ok: false,
            error: '无输出',
            latencyMs: Date.now() - startTime,
          });
          return;
        }
        const data = JSON.parse(jsonStr) as WhisperResult;
        data.latencyMs = Date.now() - startTime;
        resolve(data);
      } catch (err) {
        resolve({
          ok: false,
          error: `解析输出失败: ${err instanceof Error ? err.message : String(err)}，输出: ${stdout.slice(0, 200)}`,
          latencyMs: Date.now() - startTime,
        });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({
        ok: false,
        error: `启动进程失败: ${err.message}`,
        latencyMs: Date.now() - startTime,
      });
    });
  });
}

// ── 便捷封装 ──────────────────────────────────────────────────

export async function recognizeSpeech(
  inputPath: string,
  options?: Partial<WhisperInferOptions>,
): Promise<WhisperResult> {
  return runWhisperInfer({ inputPath, segments: true, ...options });
}

// ── 模型下载辅助 ──────────────────────────────────────────────

export const WHISPER_MODELS: Array<{ name: string; sizeMb: number; url: string }> = [
  { name: 'tiny', sizeMb: 75, url: 'https://ggml.ggerganov.com/ggml-model-whisper-tiny.bin' },
  { name: 'base', sizeMb: 142, url: 'https://ggml.ggerganov.com/ggml-model-whisper-base.bin' },
  { name: 'small', sizeMb: 466, url: 'https://ggml.ggerganov.com/ggml-model-whisper-small.bin' },
  { name: 'medium', sizeMb: 1550, url: 'https://ggml.ggerganov.com/ggml-model-whisper-medium.bin' },
  { name: 'large', sizeMb: 2900, url: 'https://ggml.ggerganov.com/ggml-model-whisper-large.bin' },
];

export function getModelPath(modelName: string): string {
  return resolve(process.cwd(), 'assets', 'whisper', `ggml-${modelName}.bin`);
}

export function modelExists(modelName: string): boolean {
  return existsSync(getModelPath(modelName));
}

export function ensureWhisperDir(): string {
  const dir = resolve(process.cwd(), 'assets', 'whisper');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
