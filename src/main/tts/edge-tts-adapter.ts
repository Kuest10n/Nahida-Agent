/**
 * edge-tts 适配器（第一阶段默认）
 *
 * 调用方式：python -m edge_tts CLI 生成 mp3
 *   - 纯 CPU + 网络，不占 GPU（v3 训练期间安全）
 *   - voice 选 zh-CN-XiaoyiNeural（晓伊，年轻清亮女声，最接近纳西妲）
 *   - 情绪通过 rate/pitch 参数调整（借鉴 xiaoda-agent EMOTION_STYLE_MAP）
 *
 * 失败场景：网络断开 / edge-tts 服务不可达 → 返回 null，调度器走降级（静默）
 */

import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { NahidaEmotion } from '../../shared/types/emotion';
import type { TtsAdapter } from './index';
import { getConfig } from '../config/config';

// ── 配置 ────────────────────────────────────────────────────

/** Python 解释器路径（优先用环境变量，否则用项目 .venv） */
const PYTHON_PATH = process.env.NAHIDA_PYTHON_PATH || 'e:\\Nahida agent\\.venv\\Scripts\\python.exe';

/** 子进程超时（ms），edge-tts 一般 1-3 秒完成 */
const SYNTH_TIMEOUT_MS = 10_000;

// ── 情绪 → rate/pitch 映射 ──────────────────────────────────

/**
 * 情绪 → edge-tts rate/pitch 参数
 *
 * 借鉴 xiaoda-agent EMOTION_STYLE_MAP 的思路，
 * 但 edge-tts 不认中文风格描述，改用 rate/pitch 数值调整
 *
 * 依据 SOHA.md §4.2 语音风格指南 + emotion.ts ENUM_TO_TTS 风格描述
 */
const EMOTION_TO_PROSODY: Record<NahidaEmotion, { rate: string; pitch: string }> = {
  [NahidaEmotion.Happy]:     { rate: '+10%',  pitch: '+2Hz' },  // 明亮甜美
  [NahidaEmotion.Sad]:       { rate: '-15%',  pitch: '-3Hz' },  // 温柔低语
  [NahidaEmotion.Shy]:       { rate: '-10%',  pitch: '-1Hz' },  // 轻声细语
  [NahidaEmotion.Angry]:     { rate: '+5%',   pitch: '-2Hz' },  // 沉稳有力
  [NahidaEmotion.Curious]:   { rate: '+5%',   pitch: '+3Hz' },  // 上扬疑问
  [NahidaEmotion.Greeting]:  { rate: '+0%',   pitch: '+0Hz' },  // 默认纳西妲腔
  [NahidaEmotion.Thinking]:  { rate: '-20%',  pitch: '+0Hz' },  // 放缓沉吟
  [NahidaEmotion.Lonely]:    { rate: '-20%',  pitch: '-4Hz' },  // 空灵低回
  [NahidaEmotion.Playful]:   { rate: '+15%',  pitch: '+3Hz' },  // 俏皮轻盈
  [NahidaEmotion.Surprised]: { rate: '+20%',  pitch: '+4Hz' },  // 清亮短促
  [NahidaEmotion.Fear]:      { rate: '-10%',  pitch: '-2Hz' },  // 低沉紧张
};

// ── 适配器实现 ──────────────────────────────────────────────

export class EdgeTtsAdapter implements TtsAdapter {
  readonly name = 'edge-tts';
  readonly enabled = true;

  /**
   * 合成语音
   *
   * 流程：
   *   1. 写文本到临时 .txt 文件（避免命令行参数过长 + 中文转义问题）
   *   2. spawn python -m edge_tts 生成 mp3
   *   3. 读 mp3 → base64
   *   4. 删临时文件
   */
  async synthesize(text: string, emotion: NahidaEmotion): Promise<Omit<import('./index').TtsResult, 'cacheHit' | 'latencyMs'> | null> {
    const prosody = EMOTION_TO_PROSODY[emotion] ?? EMOTION_TO_PROSODY[NahidaEmotion.Greeting];

    // 临时文件：用随机串避免并发冲突
    const tmpId = randomBytes(6).toString('hex');
    const textPath = join(tmpdir(), `nahida-tts-${tmpId}.txt`);
    const audioPath = join(tmpdir(), `nahida-tts-${tmpId}.mp3`);

    try {
      // 写入文本（UTF-8 BOM 避免 edge-tts 编码问题）
      await writeFile(textPath, `\uFEFF${text}`, 'utf-8');

      // 调用 edge-tts（用 -f 读文件，避免命令行中文转义）
      await this.runEdgeTts(textPath, audioPath, prosody);

      // 读音频 → base64
      const audioBytes = await readFile(audioPath);
      if (audioBytes.length === 0) {
        console.error('[TTS] edge-tts produced empty audio');
        return null;
      }

      return {
        audioBase64: audioBytes.toString('base64'),
        format: 'mp3',
      };
    } catch (err) {
      console.error('[TTS] edge-tts failed:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      // 清理临时文件（失败也清，避免残留）
      void this.safeUnlink(textPath);
      void this.safeUnlink(audioPath);
    }
  }

  /**
   * spawn 调用 edge-tts CLI
   * 命令：python -m edge_tts -f text.txt -v voice --rate=+10% --pitch=+2Hz --write-media out.mp3
   */
  private runEdgeTts(
    textPath: string,
    audioPath: string,
    prosody: { rate: string; pitch: string },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', 'edge_tts',
        '-f', textPath,
        '-v', getConfig().voice.edgeVoice,
        '--rate', prosody.rate,
        '--pitch', prosody.pitch,
        '--write-media', audioPath,
      ];

      const proc = spawn(PYTHON_PATH, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 超时保护
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`edge-tts timeout (${SYNTH_TIMEOUT_MS}ms)`));
      }, SYNTH_TIMEOUT_MS);

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`spawn failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`edge-tts exit ${code}: ${stderr.slice(0, 200)}`));
        }
      });
    });
  }

  /** 安全删除临时文件（失败忽略） */
  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // 文件不存在或其他错误，忽略
    }
  }
}
