/**
 * 歌曲翻唱工具 —— AI 翻唱 / RVC 音色转换（v2.2.0）
 *
 * 职责：
 *   把任意音频（歌曲、人声）转换为纳西妲音色。
 *   底层调用 RVC 推理桥（rvc-bridge.ts）。
 *
 * 使用场景：
 *   - 用户上传一首歌 → 返回纳西妲翻唱版
 *   - 用户说"把这首歌变成纳西妲唱的" → 调用此工具
 *   - 与 GPT-SoVITS 配合：GPT-SoVITS 生成日常对话语音，RVC 做 AI 翻唱
 *
 * 安全约束：
 *   - 输入路径白名单（只允许项目目录内）
 *   - 输出限定 data/rvc/ 目录
 *   - 文件大小 ≤ 100MB（防 DOS）
 *   - 推理超时 10 分钟
 *   - 失败不阻塞 Agent
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import { convertVoice } from '../tts/rvc-bridge';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 安全配置 ──────────────────────────────────────────────────

const MAX_FILE_SIZE_MB = 100;

function getAllowedDirs(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd),
    path.resolve(cwd, 'data'),
    path.resolve(cwd, 'assets'),
    path.resolve(cwd, 'memory'),
    path.resolve(cwd, 'feedback'),
  ];
}

function safeResolvePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const allowedDirs = getAllowedDirs();
  const isAllowed = allowedDirs.some(
    dir => resolved === dir || resolved.startsWith(dir + path.sep),
  );
  return isAllowed ? resolved : null;
}

function checkFileSize(filePath: string): { ok: boolean; error?: string } {
  try {
    const stats = fs.statSync(filePath);
    const sizeMb = stats.size / (1024 * 1024);
    if (sizeMb > MAX_FILE_SIZE_MB) {
      return { ok: false, error: `文件过大: ${sizeMb.toFixed(1)}MB（上限 ${MAX_FILE_SIZE_MB}MB）` };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // 无法获取大小则跳过检查
  }
}

// ── 工具定义 ──────────────────────────────────────────────────

const audioCoverTool: ToolDefinition = {
  name: 'audio_cover',
  description:
    'AI 翻唱 / 音色转换工具。当用户要求"把这首歌变成纳西妲唱的""翻唱这首歌""转换这段音频的音色"时调用。输入音频文件路径，输出纳西妲音色的 wav 文件。需要用户本地已安装 RVC 并配置 voice.rvcRoot。',
  parameters: z.object({
    input_audio_path: z
      .string()
      .min(1)
      .describe('输入音频文件的绝对路径（wav/mp3/flac）'),
    f0up_key: z
      .number()
      .int()
      .min(-24)
      .max(24)
      .optional()
      .describe('音高调整（半音数），0=不变。女声翻唱男歌可设 +6~+12'),
    f0method: z
      .enum(['harvest', 'pm', 'crepe'])
      .optional()
      .describe('f0 提取算法，harvest 最准但慢，pm 快但精度低，crepe 居中'),
    index_rate: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('索引混合率（0-1），越高音色越像训练集但可能失真。默认 0.66'),
    protect: z
      .number()
      .min(0)
      .max(0.5)
      .optional()
      .describe('保护程度（0-0.5），保护清辅音和呼吸声。默认 0.33'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const inputPath = params.input_audio_path as string;

    // 1. 路径白名单
    const safePath = safeResolvePath(inputPath);
    if (!safePath) {
      return {
        ok: false,
        data: '安全限制：只能访问项目目录内的音频文件',
        latencyMs: Date.now() - startTime,
      };
    }

    // 2. 文件存在性
    if (!fs.existsSync(safePath)) {
      return {
        ok: false,
        data: `音频文件不存在: ${safePath}`,
        latencyMs: Date.now() - startTime,
      };
    }

    // 3. 文件大小
    const sizeCheck = checkFileSize(safePath);
    if (!sizeCheck.ok) {
      return {
        ok: false,
        data: sizeCheck.error ?? '文件大小检查失败',
        latencyMs: Date.now() - startTime,
      };
    }

    // 4. 调用 RVC 推理
    const result = await convertVoice(safePath, {
      f0upKey: params.f0up_key as number | undefined,
      f0method: params.f0method as 'harvest' | 'pm' | 'crepe' | undefined,
      indexRate: params.index_rate as number | undefined,
      protect: params.protect as number | undefined,
    });

    if (!result.ok || !result.outputPath) {
      return {
        ok: false,
        data: result.error ?? 'RVC 推理失败',
        latencyMs: Date.now() - startTime,
      };
    }

    return {
      ok: true,
      data: {
        output_audio_path: result.outputPath,
        input_path: safePath,
        latency_ms: result.latencyMs,
        f0up_key: params.f0up_key,
        f0method: params.f0method,
        index_rate: params.index_rate,
        protect: params.protect,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

export function registerAudioCoverTools(): void {
  registerTools([audioCoverTool]);
  console.log('[Tools] audio_cover 已注册（v2.2 AI 翻唱）');
}
