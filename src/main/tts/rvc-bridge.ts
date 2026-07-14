/**
 * RVC 语音转换桥接 —— AI 翻唱独立模块
 *
 * 职责：把输入音频（歌曲/基础语音）转换为纳西妲音色
 *   - 输入：任意音频文件路径 或 edge-tts 生成的音频
 *   - 输出：RVC 转换后的 wav
 *   - 调用方式：spawn <rvcRoot>/tools/infer_cli.py
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
 * 当前状态：接口预留，enabled = false
 * 启用步骤（v3 训练完成后）：
 *   1. 把 enabled 改为 true
 *   2. 配置 NAHIDA_VOICE_RVC_ROOT 环境变量指向 RVC WebUI 目录
 *   3. 实现 synthesize()：写输入文件 → spawn infer_cli.py → 读输出 wav
 */

import { resolve } from 'node:path';
import { NahidaEmotion } from '../../shared/types/emotion';
import type { TtsAdapter, TtsResult } from './index';

/** RVC 桥接配置 */
export interface RvcConfig {
  /** RVC WebUI 根目录（外部依赖，如 F:\\RVC20240604Nvidia） */
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
  rvcRoot: '',
  modelName: 'nahida_v0.3_100e.pth',
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

  /** 配置 RVC（启用时调用） */
  configure(config: Partial<RvcConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 获取项目内 RVC 模型路径
   */
  get modelPath(): string {
    return resolve(process.cwd(), 'assets', 'rvc', this.config.modelName);
  }

  /** 获取模型版本 */
  get version(): string {
    return this.config.modelVersion;
  }

  /**
   * 合成语音（AI 翻唱场景）
   *
   * 当前：未启用，直接返回 null
   * TODO：实现 infer_cli.py 调用流程
   */
  async synthesize(_text: string, _emotion: NahidaEmotion): Promise<Omit<TtsResult, 'cacheHit' | 'latencyMs'> | null> {
    if (!this.enabled) {
      console.log('[RVC] bridge disabled (training in progress)');
      return null;
    }

    if (!this.config.rvcRoot) {
      console.error('[RVC] root not configured (set NAHIDA_VOICE_RVC_ROOT)');
      return null;
    }

    console.error('[RVC] synthesize not implemented yet');
    return null;
  }

  /**
   * AI 翻唱：将歌曲音频转换为纳西妲音色
   *
   * @param inputPath 输入音频路径（歌曲文件）
   * @param outputPath 输出音频路径
   * @returns 是否成功
   */
  async convertVoice(inputPath: string, outputPath: string): Promise<boolean> {
    if (!this.enabled) {
      console.log('[RVC] bridge disabled');
      return false;
    }

    if (!this.config.rvcRoot) {
      console.error('[RVC] root not configured');
      return false;
    }

    // TODO: spawn infer_cli.py 实现
    console.error('[RVC] convertVoice not implemented yet');
    return false;
  }
}
