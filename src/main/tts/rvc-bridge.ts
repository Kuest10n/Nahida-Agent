/**
 * RVC 语音转换桥接 —— AI 翻唱模块（v2.2.0 实装）
 *
 * 职责：把输入音频（歌曲/基础语音）转换为纳西妲音色
 *   - 输入：任意音频文件路径（wav/mp3/flac）
 *   - 输出：RVC 转换后的 wav
 *   - 调用方式：child_process spawn Python 推理脚本
 *
 * 与 GPT-SoVITS 的区别：
 *   - GPT-SoVITS：TTS 专用，文本→语音，日常对话主力
 *   - RVC：音色转换专用，音频→音频，AI 翻唱/实时变声用
 *
 * 模型版本管理：
 *   - V0.2: nahida_v0.2_20e.pth（20 轮，初始版本）
 *   - V0.3: nahida_v0.3_100e.pth（100 轮，1200 条数据，当前主力）
 *   - 模型存放在 assets/rvc/ 目录（随项目发布）
 *
 * 配置来源：data/config.json 的 voice 字段
 *   {
 *     "voice": {
 *       "rvcRoot": "F:/RVC20240604Nvidia",
 *       "rvcModelName": "nahida_v0.3_100e.pth",
 *       "rvcModelVersion": "V0.3",
 *       "rvcF0UpKey": 0,
 *       "rvcF0Method": "harvest",
 *       "rvcIndexRate": 0.66,
 *       "rvcDevice": "cuda",
 *       "rvcIsHalf": true
 *     }
 *   }
 */

import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getConfig } from '../config/config';
import type { VoiceConfig } from '../../shared/types/config';

// ── 类型 ──────────────────────────────────────────────────────

/** RVC 推理结果 */
export interface RvcResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 推理耗时（毫秒） */
  latencyMs: number;
}

/** RVC 推理参数 */
export interface RvcInferParams {
  /** 输入音频路径 */
  inputPath: string;
  /** 输出音频路径（可选，默认 data/rvc/ 下） */
  outputPath?: string;
  /** 音高调整（半音数，0=不变，正数=升调） */
  f0upKey?: number;
  /** f0 提取算法 */
  f0method?: 'harvest' | 'pm' | 'crepe';
  /** 索引混合率（0-1） */
  indexRate?: number;
  /** 保护程度（0-0.5） */
  protect?: number;
  /** 滤波半径 */
  filterRadius?: number;
  /** 响度因子 */
  rmsMixRate?: number;
}

// ── 配置读取 ──────────────────────────────────────────────────

function readRvcConfig(): Partial<VoiceConfig> {
  const config = getConfig();
  return config.voice ?? {};
}

// ── 核心推理 ──────────────────────────────────────────────────

/**
 * 执行 RVC 推理：音频 → 纳西妲音色
 *
 * 调用链：
 *   1. 检查 RVC 根目录和模型是否存在
 *   2. 构造 Python 推理命令
 *   3. spawn Python 子进程
 *   4. 等待完成 → 返回输出路径
 *
 * Python 脚本：优先使用用户自定义的 infer_cli.py，
 * 回退到内置的极简推理脚本（内联在 child_process 中）。
 */
export async function runRvcInfer(params: RvcInferParams): Promise<RvcResult> {
  const startTime = Date.now();
  const voiceConfig = readRvcConfig();

  // 1. 检查 RVC 根目录
  const rvcRoot = voiceConfig.rvcRoot?.trim() ?? '';
  if (!rvcRoot) {
    return {
      ok: false,
      error: 'RVC 根目录未配置（settings 中 voice.rvcRoot，如 F:/RVC20240604Nvidia）',
      latencyMs: Date.now() - startTime,
    };
  }
  if (!existsSync(rvcRoot)) {
    return {
      ok: false,
      error: `RVC 根目录不存在: ${rvcRoot}`,
      latencyMs: Date.now() - startTime,
    };
  }

  // 2. 检查模型文件
  const modelName = voiceConfig.rvcModelName?.trim() ?? 'nahida_v0.3_100e.pth';
  const modelPath = resolve(process.cwd(), 'assets', 'rvc', modelName);
  if (!existsSync(modelPath)) {
    return {
      ok: false,
      error: `RVC 模型不存在: ${modelPath}，请检查 assets/rvc/ 目录`,
      latencyMs: Date.now() - startTime,
    };
  }

  // 3. 检查输入文件
  if (!existsSync(params.inputPath)) {
    return {
      ok: false,
      error: `输入音频不存在: ${params.inputPath}`,
      latencyMs: Date.now() - startTime,
    };
  }

  // 4. 构造输出路径
  const outputPath = params.outputPath ?? join(
    resolve(process.cwd(), 'data', 'rvc'),
    `rvc_${Date.now()}.wav`,
  );

  // 5. 构造参数
  const f0upKey = params.f0upKey ?? voiceConfig.rvcF0UpKey ?? 0;
  const f0method = params.f0method ?? (voiceConfig.rvcF0Method as 'harvest' | 'pm' | 'crepe' | undefined) ?? 'harvest';
  const indexRate = params.indexRate ?? voiceConfig.rvcIndexRate ?? 0.66;
  const protect = params.protect ?? 0.33;
  const filterRadius = params.filterRadius ?? 3;
  const rmsMixRate = params.rmsMixRate ?? 0.25;
  const device = voiceConfig.rvcDevice ?? 'cuda';
  const isHalf = voiceConfig.rvcIsHalf ?? true;

  // 6. 索引路径（可选）
  const indexPath = voiceConfig.rvcIndexPath?.trim() ?? '';

  // 7. 尝试调用用户的 infer_cli.py（如果存在）
  const inferCliPath = join(rvcRoot, 'infer_cli.py');
  if (existsSync(inferCliPath)) {
    return runInferCli({
      inferCliPath,
      inputPath: params.inputPath,
      outputPath,
      modelPath,
      indexPath,
      f0upKey,
      f0method,
      indexRate,
      protect,
      filterRadius,
      rmsMixRate,
      device,
      isHalf,
      startTime,
    });
  }

  // 8. 回退：内联 Python 推理脚本
  return runInlineInfer({
    rvcRoot,
    inputPath: params.inputPath,
    outputPath,
    modelPath,
    indexPath,
    f0upKey,
    f0method,
    indexRate,
    protect,
    filterRadius,
    rmsMixRate,
    device,
    isHalf,
    startTime,
  });
}

// ── 模式 A：调用用户 infer_cli.py ────────────────────────────

interface InferCliOptions {
  inferCliPath: string;
  inputPath: string;
  outputPath: string;
  modelPath: string;
  indexPath: string;
  f0upKey: number;
  f0method: string;
  indexRate: number;
  protect: number;
  filterRadius: number;
  rmsMixRate: number;
  device: string;
  isHalf: boolean;
  startTime: number;
}

function runInferCli(opts: InferCliOptions): Promise<RvcResult> {
  const args: string[] = [
    opts.inferCliPath,
    '--input', opts.inputPath,
    '--output', opts.outputPath,
    '--model', opts.modelPath,
    '--f0up_key', String(opts.f0upKey),
    '--f0method', opts.f0method,
    '--index_rate', String(opts.indexRate),
    '--protect', String(opts.protect),
    '--filter_radius', String(opts.filterRadius),
    '--rms_mix_rate', String(opts.rmsMixRate),
    '--device', opts.device,
  ];
  if (opts.indexPath) {
    args.push('--index', opts.indexPath);
  }
  if (!opts.isHalf) {
    args.push('--is_half', 'False');
  }

  return spawnPython(args, opts.outputPath, opts.startTime);
}

// ── 模式 B：内联 Python 推理 ──────────────────────────────────

interface InlineInferOptions {
  rvcRoot: string;
  inputPath: string;
  outputPath: string;
  modelPath: string;
  indexPath: string;
  f0upKey: number;
  f0method: string;
  indexRate: number;
  protect: number;
  filterRadius: number;
  rmsMixRate: number;
  device: string;
  isHalf: boolean;
  startTime: number;
}

function runInlineInfer(opts: InlineInferOptions): Promise<RvcResult> {
  // 内联 Python 脚本：通过 -c 参数直接执行 RVC 推理
  // 这个脚本兼容大部分 RVC 仓库的结构
  const pythonScript = `
import sys
sys.path.insert(0, '${opts.rvcRoot.replace(/\\/g, '\\\\')}')
import os
os.chdir('${opts.rvcRoot.replace(/\\/g, '\\\\')}')

import torch
import numpy as np
import soundfile as sf
import librosa

try:
    from infer.modules.vc.modules import VC
except ImportError:
    from vc_infer_pipeline import VC

device = '${opts.device}'
is_half = ${opts.isHalf}

vc = VC(device, is_half)

# 加载模型
model_path = '${opts.modelPath.replace(/\\/g, '\\\\')}'
if '${opts.indexPath.replace(/\\/g, '\\\\')}' and os.path.exists('${opts.indexPath.replace(/\\/g, '\\\\')}'):
    file_index = '${opts.indexPath.replace(/\\/g, '\\\\')}'
else:
    file_index = ''

sid = 0
protect = ${opts.protect}

# 加载音频
audio, sr = librosa.load('${opts.inputPath.replace(/\\/g, '\\\\')}', sr=16000)

# 推理
f0_up_key = ${opts.f0upKey}
f0_file = None
f0_method = '${opts.f0method}'
file_index2 = file_index
filter_radius = ${opts.filterRadius}
resample_sr = 0
rms_mix_rate = ${opts.rmsMixRate}

if hasattr(vc, 'vc_single'):
    # 新版 RVC
    _, wav_opt = vc.vc_single(
        sid, audio, f0_up_key, f0_file,
        f0_method, file_index, file_index2,
        filter_radius, None, resample_sr, rms_mix_rate, protect
    )
else:
    # 旧版
    _, wav_opt = vc.pipeline(
        model_path, sid, audio, f0_up_key,
        f0_file, f0_method, file_index, file_index2,
        filter_radius, resample_sr, rms_mix_rate, protect
    )

# 保存
sf.write('${opts.outputPath.replace(/\\/g, '\\\\')}', wav_opt, sr)
print('RVC_OK')
`;

  return spawnPython(['-c', pythonScript], opts.outputPath, opts.startTime);
}

// ── 通用：spawn Python 子进程 ─────────────────────────────────

function spawnPython(
  args: string[],
  expectedOutputPath: string,
  startTime: number,
): Promise<RvcResult> {
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
          error: `Python 进程退出码 ${code}: ${stderr.slice(0, 500)}`,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      if (!existsSync(expectedOutputPath)) {
        resolve({
          ok: false,
          error: `Python 进程成功但输出文件未生成: ${expectedOutputPath}，stderr: ${stderr.slice(0, 300)}`,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      resolve({
        ok: true,
        outputPath: expectedOutputPath,
        latencyMs: Date.now() - startTime,
      });
    });

    proc.on('error', (err: Error) => {
      resolve({
        ok: false,
        error: `启动 Python 失败: ${err.message}（请确认 Python 已安装且 PATH 包含 python 命令）`,
        latencyMs: Date.now() - startTime,
      });
    });
  });
}

// ── 便捷封装：AI 翻唱 ────────────────────────────────────────

/**
 * AI 翻唱：将歌曲音频转换为纳西妲音色
 *
 * @param inputPath 输入音频路径（歌曲文件 wav/mp3/flac）
 * @param options 可选参数覆盖
 * @returns RVC 推理结果
 */
export async function convertVoice(
  inputPath: string,
  options?: Partial<RvcInferParams>,
): Promise<RvcResult> {
  const outputPath = join(
    resolve(process.cwd(), 'data', 'rvc'),
    `cover_${Date.now()}.wav`,
  );
  return runRvcInfer({ inputPath, outputPath, ...options });
}

// ── 旧类包装（保持向后兼容） ──────────────────────────────────

import { NahidaEmotion } from '../../shared/types/emotion';
import type { TtsAdapter, TtsResult } from './index';

/** 兼容旧 RvcBridge 类 */
export class RvcBridge implements TtsAdapter {
  readonly name = 'rvc-bridge';
  /** 如果 rvcRoot 已配置且模型存在，则自动启用 */
  get enabled(): boolean {
    const cfg = readRvcConfig();
    const root = cfg.rvcRoot?.trim() ?? '';
    if (!root) return false;
    const model = cfg.rvcModelName?.trim() ?? 'nahida_v0.3_100e.pth';
    return existsSync(root) && existsSync(resolve(process.cwd(), 'assets', 'rvc', model));
  }

  async synthesize(_text: string, _emotion: NahidaEmotion): Promise<Omit<TtsResult, 'cacheHit' | 'latencyMs'> | null> {
    // RVC 不支持文本直接合成，需先走 TTS 再转换
    console.log('[RVC] synthesize() 不适用于 RVC（音频→音频），请先用 edge-tts/gpt-sovits 生成音频，再调用 convertVoice()');
    return null;
  }
}
