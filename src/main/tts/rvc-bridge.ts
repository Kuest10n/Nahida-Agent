/**
 * RVC 语音转换桥接（第二阶段，训练完成后启用）
 *
 * 职责：把 edge-tts 的基础女声转换为纳西妲音色
 *   - 输入：edge-tts 生成的 mp3
 *   - 输出：RVC 转换后的 wav
 *   - 调用方式：spawn <rvcRoot>/tools/infer_cli.py
 *
 * 模型版本管理：
 *   - V0.2: nahida_v0.2_20e.pth（20 轮，初始版本）
 *   - V0.3: nahida_v0.3_100e.pth（100 轮，1200 条数据，当前主力）
 *   - 模型存放在 assets/rvc/ 目录（随项目发布）
 *
 * 当前状态：接口预留，enabled = false
 * 启用步骤（v3 训练完成后）：
 *   1. 把 enabled 改为 true
 *   2. 实现 synthesize()：先调 edge-tts 生成基础音频 → 再调 RVC 转换
 *   3. 在 scheduler 里把 RVC 设为后置处理器（edge-tts → RVC 两段式）
 *
 * RVC 推理参数（来自 infer_cli.py）：
 *   --model_name   模型文件名（assets/weights/ 下）
 *   --input_path   输入音频路径
 *   --opt_path     输出音频路径
 *   --f0up_key     音高调整（0=不变）
 *   --f0method     f0 提取算法（harvest/pm）
 *   --index_path   检索索引（可选，提升音色相似度）
 *   --index_rate   索引混合率（0-1，默认 0.66）
 *   --device       cuda/cpu
 *   --is_half      半精度推理
 */

import { resolve } from 'node:path';
import { NahidaEmotion } from '../../shared/types/emotion';
import type { TtsAdapter, TtsResult } from './index';

/** RVC 桥接配置（第二阶段启用时填入） */
export interface RvcConfig {
  /** RVC WebUI 根目录（外部依赖，如 F:\RVC20240604Nvidia） */
  rvcRoot: string;
  /** 模型文件名（项目 assets/rvc/ 下，如 nahida_v0.3_100e.pth） */
  modelName: string;
  /** 模型版本标识（如 V0.3） */
  modelVersion: string;
  /** 检索索引路径（可选，无 index 仍可推理，音色相似度略低） */
  indexPath?: string;
  /** 音高调整（半音数，0=不变） */
  f0upKey: number;
  /** f0 提取算法 */
  f0method: 'harvest' | 'pm';
  /** 索引混合率（0-1） */
  indexRate: number;
  /** 设备 */
  device: 'cuda' | 'cpu';
  /** 半精度推理 */
  isHalf: boolean;
}

/** 默认 RVC 配置（对应 assets/rvc/nahida_v0.3_100e.pth） */
const DEFAULT_RVC_CONFIG: RvcConfig = {
  rvcRoot: '',                          // 需用户配置 RVC WebUI 安装路径
  modelName: 'nahida_v0.3_100e.pth',    // 项目 assets/rvc/ 下
  modelVersion: 'V0.3',
  f0upKey: 0,
  f0method: 'harvest',
  indexRate: 0.66,
  device: 'cuda',
  isHalf: true,
};

export class RvcBridge implements TtsAdapter {
  readonly name = 'rvc-bridge';
  /** 训练期间禁用，v3 完成后改为 true */
  readonly enabled = false;

  private config: RvcConfig;

  constructor() {
    this.config = { ...DEFAULT_RVC_CONFIG };
  }

  /** 配置 RVC（第二阶段启用时调用） */
  configure(config: Partial<RvcConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 获取项目内 RVC 模型路径
   *
   * 模型存放在 assets/rvc/ 目录，随项目发布，
   * 其他用户不需要额外安装 RVC WebUI 也能获取模型文件
   */
  get modelPath(): string {
    // 项目根目录/assets/rvc/<modelName>
    return resolve(process.cwd(), 'assets', 'rvc', this.config.modelName);
  }

  /** 获取模型版本 */
  get version(): string {
    return this.config.modelVersion;
  }

  /**
   * 合成语音（第二阶段实现）
   *
   * 计划流程：
   *   1. 先用 edge-tts 生成基础 mp3
   *   2. 调 RVC infer_cli.py 把 mp3 → wav（纳西妲音色）
   *   3. 返回 wav base64
   *
   * 当前：未启用，直接返回 null（调度器走 edge-tts 单段式）
   */
  async synthesize(_text: string, _emotion: NahidaEmotion): Promise<Omit<TtsResult, 'cacheHit' | 'latencyMs'> | null> {
    if (!this.enabled) {
      console.log('[TTS] RVC bridge disabled (training in progress)');
      return null;
    }

    if (!this.config.rvcRoot) {
      console.error('[TTS] RVC root not configured (set NAHIDA_VOICE_RVC_ROOT)');
      return null;
    }

    // TODO 第二阶段实现：
    //   const inputMp3 = await edgeTtsAdapter.synthesize(text, emotion);
    //   if (!inputMp3) return null;
    //   await this.runRvcInfer(inputMp3Path, outputWavPath);
    //   return { audioBase64: wavBase64, format: 'wav' };

    console.error('[TTS] RVC synthesize not implemented yet');
    return null;
  }
}
