/**
 * GPT-SoVITS 适配器 —— 本地 TTS 直出纳西妲音色（Phase 2 主力）
 *
 * 与 edge-tts → RVC 两段式不同，GPT-SoVITS 一步直出目标音色：
 *   - 输入：文本 + 参考音频（情绪控制）+ 参考文本
 *   - 输出：wav 音频（纳西妲音色）
 *   - 调用方式：HTTP API（GPT-SoVITS api.py 启动本地服务）
 *
 * 本地化集成：
 *   - 模型存放：resources/gpt-sovits/models/
 *   - 参考音频：resources/gpt-sovits/reference_audios/
 *   - Python 服务：通过 python-manager.ts 启动，无需外部依赖
 *
 * 优势（vs edge-tts → RVC）：
 *   1. 单步生成，延迟 ~300-500ms（vs 两步 1-2s）
 *   2. 已有训练好的模型，无需额外训练
 *   3. 支持参考音频+文本的情绪控制
 *   4. API 模式直接 HTTP 调用，比 spawn 子进程稳
 *
 * GPT-SoVITS API 接口（api.py 默认端口 9880）：
 *   POST /tts
 *   Body: {
 *     "text": "合成文本",
 *     "text_lang": "zh",
 *     "ref_audio_path": "参考音频路径",
 *     "prompt_text": "参考音频对应文本",
 *     "prompt_lang": "zh",
 *     "text_split_method": "cut5",
 *     "batch_size": 1,
 *     "speed_factor": 1.0,
 *     "streaming_mode": false
 *   }
 *   Response: wav 音频二进制
 */

import { NahidaEmotion } from '../../shared/types/emotion';
import { getConfig } from '../config/config';
import { startPythonService } from '../python/python-manager';
import { resolve } from 'path';
import { existsSync } from 'fs';
import type { TtsAdapter } from './index';
import type { ChildProcess } from 'child_process';

// ── 情绪 → 参考音频映射 ──────────────────────────────────────

/** 情绪 → 参考音频文件名（reference_audios/ 中文/emotions/ 下） */
const EMOTION_REF: Partial<Record<NahidaEmotion, { audio: string; text: string }>> = {
  // 默认参考音频（唯一的情绪参考）
  [NahidaEmotion.Greeting]: {
    audio: '【默认】很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。.wav',
    text: '很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。',
  },
  // 其他情绪暂用默认参考（等补充更多参考音频后扩展）
};

/** 获取参考音频配置（无匹配时用默认） */
function getRefAudio(emotion: NahidaEmotion): { audio: string; text: string } {
  return EMOTION_REF[emotion] ?? EMOTION_REF[NahidaEmotion.Greeting] ?? {
    audio: '【默认】很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。.wav',
    text: '很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。',
  };
}

// ── 适配器实现 ────────────────────────────────────────────────

export class GptSoVitsAdapter implements TtsAdapter {
  readonly name = 'gpt-sovits';
  readonly enabled = true;

  /** GPT-SoVITS API 服务进程 */
  private serviceProcess: ChildProcess | null = null;

  /** GPT-SoVITS API 地址（默认 http://localhost:9880） */
  private get apiUrl(): string {
    return getConfig().voice.gptsovitsApiUrl || 'http://localhost:9880';
  }

  /** 参考音频根目录 */
  private get refAudioDir(): string {
    return getConfig().voice.gptsovitsRefDir || '';
  }

  /**
   * 启动 GPT-SoVITS API 服务
   *
   * 使用 python-manager 启动 api_v2.py，无需外部依赖。
   * 如果服务已在运行（端口已占用），跳过启动。
   */
  async startService(): Promise<void> {
    if (this.serviceProcess) {
      console.log('[GPT-SoVITS] service already running');
      return;
    }

    // 检查服务是否已在运行
    try {
      const healthCheck = await fetch(`${this.apiUrl}/health`);
      if (healthCheck.ok) {
        console.log('[GPT-SoVITS] service already running (external)');
        return;
      }
    } catch {
      // 服务未运行，继续启动
    }

    const apiScript = resolve(process.cwd(), 'resources/gpt-sovits/api_v2.py');
    if (!existsSync(apiScript)) {
      console.error(`[GPT-SoVITS] api_v2.py not found at ${apiScript}`);
      return;
    }

    console.log('[GPT-SoVITS] starting local service...');
    this.serviceProcess = startPythonService(apiScript, ['--port', '9880']);
  }

  /**
   * 停止 GPT-SoVITS API 服务
   */
  stopService(): void {
    if (this.serviceProcess) {
      console.log('[GPT-SoVITS] stopping service');
      this.serviceProcess.kill();
      this.serviceProcess = null;
    }
  }

  /**
   * 合成语音（GPT-SoVITS 直出纳西妲音色）
   *
   * 流程：HTTP POST → /tts → wav 二进制 → base64
   * 当前：未启用，返回 null（调度器走 edge-tts 降级）
   */
  async synthesize(text: string, emotion: NahidaEmotion): Promise<Omit<import('./index').TtsResult, 'cacheHit' | 'latencyMs'> | null> {
    if (!this.enabled) {
      console.log('[TTS] GPT-SoVITS disabled (training in progress)');
      return null;
    }

    const ref = getRefAudio(emotion);
    const refAudioPath = this.refAudioDir
      ? `${this.refAudioDir}\\${ref.audio}`
      : ref.audio;

    try {
      const response = await fetch(`${this.apiUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          text_lang: 'zh',
          ref_audio_path: refAudioPath,
          prompt_text: ref.text,
          prompt_lang: 'zh',
          text_split_method: 'cut5',
          batch_size: 1,
          speed_factor: 1.0, // 默认语速，后续可按情绪微调
          streaming_mode: false,
        }),
      });

      if (!response.ok) {
        console.error(`[TTS] GPT-SoVITS API error: ${response.status}`);
        return null;
      }

      // wav 二进制 → base64
      const wavBuffer = Buffer.from(await response.arrayBuffer());
      const audioBase64 = wavBuffer.toString('base64');

      return {
        audioBase64,
        format: 'wav',
        visemeData: undefined, // 由 rhubarb 后处理生成
      };
    } catch (err) {
      console.error('[TTS] GPT-SoVITS request failed:', err);
      return null;
    }
  }
}
