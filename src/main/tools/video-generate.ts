/**
 * 生视频工具 —— v2.1.0
 *
 * 职责：
 *   接入文生视频后端，把 LLM 的 prompt 变成一段 MP4 落到 data/videos/，
 *   并把路径回给上层。
 *
 * 后端优先级：
 *   1. 火山引擎 Seedance（字节系，国内可用，默认）
 *   2. Runway Gen-3 Alpha（国际主流）
 *   3. OpenAI Sora 2（预留口，API 状态未定）
 *
 * 通用流程（异步任务）：
 *   1. POST /v1/videos 提交任务 → 拿到 task_id
 *   2. GET /v1/videos/{task_id} 轮询任务状态
 *   3. 状态 success → 下载视频到 data/videos/
 *
 * 配置读取：data/config.json 的 video 字段
 *   {
 *     "video": {
 *       "backend": "volcano" | "runway" | "sora",
 *       "volcanoApiKey": "...",
 *       "runwayApiKey": "...",
 *       "soraApiKey": "...",
 *       "defaultModel": "seedance-v1-pro",
 *       "defaultResolution": "720p",
 *       "defaultDurationSeconds": 5,
 *       "defaultAspectRatio": "16:9"
 *     }
 *   }
 *
 * 安全约束：
 *   - prompt 长度 ≤ 2000 字符
 *   - 仅 HTTPS 后端（防 SSRF）
 *   - 输出路径限定在 data/videos/ 下
 *   - 轮询超时 5 分钟
 *   - 失败不阻塞 Agent，返回 ok:false 让四审降级
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import { getConfig } from '../config/config';
import { isSafeUrl } from '../safety/url-guard';
import type { VideoConfig } from '../../shared/types/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 配置读取 ──────────────────────────────────────────────────

function readVideoConfig(): VideoConfig {
  const config = getConfig();
  return config.video ?? {};
}

// ── 输出目录 ──────────────────────────────────────────────────

const VIDEOS_DIR = path.resolve(process.cwd(), 'data', 'videos');

function ensureVideosDir(): void {
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  }
}

// ── 通用类型 ──────────────────────────────────────────────────

type BackendName = 'volcano' | 'runway' | 'sora';

interface VideoGenerateOptions {
  prompt: string;
  model?: string;
  resolution?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  imageUrl?: string; // 图生视频模式（可选）
}

interface AdapterResult {
  ok: boolean;
  videoPath?: string;
  taskId?: string;
  error?: string;
}

// ── 火山引擎 Seedance 适配器 ──────────────────────────────────

/**
 * 火山引擎视频生成 API
 *
 * 文档：https://www.volcengine.com/docs/6791/1397048
 * 流程：POST 提交 → GET 轮询 → 下载视频
 *
 * 注：实际 API 路径和参数以火山官方文档为准，本实现按公开文档最佳实践编写
 */
async function generateViaVolcano(
  options: VideoGenerateOptions,
  config: VideoConfig,
): Promise<AdapterResult> {
  const apiKey = config.volcanoApiKey;
  if (!apiKey) {
    return { ok: false, error: '火山引擎 API Key 未配置（settings 中 video.volcanoApiKey）' };
  }

  const baseUrl = 'https://visual.volcengineapi.com';
  const model = options.model ?? config.defaultModel ?? 'seedance-v1-pro';
  const resolution = options.resolution ?? config.defaultResolution ?? '720p';
  const duration = options.durationSeconds ?? config.defaultDurationSeconds ?? 5;
  const ratio = options.aspectRatio ?? config.defaultAspectRatio ?? '16:9';

  // 1. 提交任务
  const submitBody: Record<string, unknown> = {
    model,
    content: [
      { type: 'text', text: options.prompt },
    ],
    duration,
    ratio,
    resolution,
    watermark: false,
  };

  // 图生视频模式
  if (options.imageUrl) {
    submitBody.content = [
      { type: 'text', text: options.prompt },
      { type: 'image_url', image_url: { url: options.imageUrl } },
    ];
  }

  try {
    const submitResp = await fetch(`${baseUrl}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(submitBody),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      return {
        ok: false,
        error: `火山 /v1/videos/generations 返回 HTTP ${submitResp.status}: ${errText.slice(0, 200)}`,
      };
    }

    const submitData = (await submitResp.json()) as { id?: string; data?: { id?: string } };
    const taskId = submitData.id ?? submitData.data?.id;
    if (!taskId) {
      return { ok: false, error: '火山返回数据缺少 task id' };
    }

    // 2. 轮询任务状态
    const videoUrl = await pollTaskStatus(
      `${baseUrl}/v1/videos/generations/${taskId}`,
      apiKey,
      'volcano',
      5 * 60 * 1000, // 5 分钟超时
    );

    if (!videoUrl) {
      return { ok: false, error: '火山任务轮询超时或失败', taskId };
    }

    // 3. 下载视频
    const downloaded = await downloadVideo(videoUrl, 'volcano');
    return downloaded;
  } catch (err) {
    return {
      ok: false,
      error: `火山请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Runway Gen-3 适配器 ───────────────────────────────────────

/**
 * Runway Gen-3 Alpha API
 *
 * 文档：https://docs.dev.runwayml.com/
 * 流程：POST /v1/image_to_video 或 /v1/text_to_video → 轮询 → 下载
 */
async function generateViaRunway(
  options: VideoGenerateOptions,
  config: VideoConfig,
): Promise<AdapterResult> {
  const apiKey = config.runwayApiKey;
  if (!apiKey) {
    return { ok: false, error: 'Runway API Key 未配置（settings 中 video.runwayApiKey）' };
  }

  const baseUrl = 'https://api.dev.runwayml.com/v1';
  const model = options.model ?? config.defaultModel ?? 'gen3a_turbo';
  const duration = options.durationSeconds ?? config.defaultDurationSeconds ?? 5;
  const ratio = options.aspectRatio ?? config.defaultAspectRatio ?? '16:9';

  // 端点选择：有 imageUrl 走 image_to_video，否则 text_to_video
  const endpoint = options.imageUrl ? 'image_to_video' : 'text_to_video';
  const url = `${baseUrl}/${endpoint}`;

  const body: Record<string, unknown> = {
    model,
    prompt_text: options.prompt,
    duration,
    ratio,
  };
  if (options.imageUrl) {
    body.prompt_image = options.imageUrl;
  }

  try {
    const submitResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      return {
        ok: false,
        error: `Runway /${endpoint} 返回 HTTP ${submitResp.status}: ${errText.slice(0, 200)}`,
      };
    }

    const submitData = (await submitResp.json()) as { id?: string };
    const taskId = submitData.id;
    if (!taskId) {
      return { ok: false, error: 'Runway 返回数据缺少 task id' };
    }

    // 2. 轮询
    const videoUrl = await pollTaskStatus(
      `${baseUrl}/tasks/${taskId}`,
      apiKey,
      'runway',
      5 * 60 * 1000,
    );

    if (!videoUrl) {
      return { ok: false, error: 'Runway 任务轮询超时或失败', taskId };
    }

    // 3. 下载
    return await downloadVideo(videoUrl, 'runway');
  } catch (err) {
    return {
      ok: false,
      error: `Runway 请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── OpenAI Sora 2 适配器（预留） ──────────────────────────────

/**
 * OpenAI Sora 2 API（预留口）
 *
 * 文档：https://platform.openai.com/docs/api-reference/videos
 * 注：Sora API 当前为受限访问，本适配器按 OpenAI 通用模式编写
 */
async function generateViaSora(
  options: VideoGenerateOptions,
  config: VideoConfig,
): Promise<AdapterResult> {
  const apiKey = config.soraApiKey;
  if (!apiKey) {
    return { ok: false, error: 'Sora API Key 未配置（settings 中 video.soraApiKey）' };
  }

  const baseUrl = 'https://api.openai.com/v1';
  const model = options.model ?? config.defaultModel ?? 'sora-2';
  const duration = options.durationSeconds ?? config.defaultDurationSeconds ?? 5;
  const size = options.aspectRatio ?? config.defaultAspectRatio ?? '16:9';

  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt,
    size,
    duration,
    n: 1,
  };

  try {
    const submitResp = await fetch(`${baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      return {
        ok: false,
        error: `Sora /videos/generations 返回 HTTP ${submitResp.status}: ${errText.slice(0, 200)}`,
      };
    }

    const submitData = (await submitResp.json()) as { data?: Array<{ url?: string }> };
    const videoUrl = submitData.data?.[0]?.url;
    if (!videoUrl) {
      return { ok: false, error: 'Sora 返回数据缺少 video url' };
    }

    return await downloadVideo(videoUrl, 'sora');
  } catch (err) {
    return {
      ok: false,
      error: `Sora 请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── 通用：轮询任务状态 ────────────────────────────────────────

interface PollResponse {
  status?: string;
  state?: string;
  output?: string | Array<{ url?: string }>;
  artifacts?: Array<{ url?: string }>;
  data?: Array<{ url?: string }>;
  error?: string | { message?: string };
  failure?: string;
}

/**
 * 轮询任务状态，返回视频下载 URL
 *
 * 不同后端的字段差异：
 *   - volcano: status='succeeded' | output=string(URL)
 *   - runway: status='SUCCEEDED' | output=array of {url}
 *   - sora: 直接返回 data，不走轮询（但保留函数兼容性）
 *
 * @param statusUrl 轮询 URL
 * @param apiKey API Key
 * @param backend 后端名（用于字段解析）
 * @param timeoutMs 超时毫秒
 * @returns 视频 URL 或 null
 */
async function pollTaskStatus(
  statusUrl: string,
  apiKey: string,
  backend: BackendName,
  timeoutMs: number,
): Promise<string | null> {
  const startTime = Date.now();
  const pollIntervalMs = 5000;
  let attempts = 0;
  const maxAttempts = Math.floor(timeoutMs / pollIntervalMs);

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    attempts++;

    if (Date.now() - startTime > timeoutMs) {
      return null;
    }

    try {
      const resp = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Runway-Version': backend === 'runway' ? '2024-11-06' : '',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) continue;
      const data = (await resp.json()) as PollResponse;

      // 检查失败状态
      const statusLower = (data.status ?? data.state ?? '').toLowerCase();
      if (statusLower.includes('fail') || statusLower.includes('error')) {
        const errMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message ?? data.failure ?? 'unknown error';
        console.error(`[VideoGenerate] ${backend} task failed: ${errMsg}`);
        return null;
      }

      // 检查成功状态
      const isSuccess = statusLower.includes('succ') || statusLower === 'completed';
      if (!isSuccess) continue;

      // 解析视频 URL
      const videoUrl = extractVideoUrl(data, backend);
      if (videoUrl) return videoUrl;
    } catch {
      // 单次轮询失败继续重试
    }
  }

  return null;
}

/**
 * 从轮询响应中提取视频 URL
 */
function extractVideoUrl(data: PollResponse, backend: BackendName): string | null {
  // volcano: output 是字符串 URL
  if (backend === 'volcano' && typeof data.output === 'string') {
    return data.output;
  }

  // runway: output 是数组，包含 {url}
  if (Array.isArray(data.output)) {
    const first = data.output[0];
    if (first?.url) return first.url;
  }

  // runway 备用：artifacts 字段
  if (Array.isArray(data.artifacts)) {
    const first = data.artifacts[0];
    if (first?.url) return first.url;
  }

  // sora: data 数组
  if (Array.isArray(data.data)) {
    const first = data.data[0];
    if (first?.url) return first.url;
  }

  return null;
}

// ── 通用：下载视频到本地 ──────────────────────────────────────

async function downloadVideo(
  videoUrl: string,
  backend: BackendName,
): Promise<AdapterResult> {
  // 第五关 SSRF-01：复用 isSafeUrl 拦截私网/回环/链路本地/CGNAT 等内网地址
  // 之前仅校验 'https://' 前缀，攻击者若控制后端返回值（如 'https://127.0.0.1/api/leak'）
  // 可让本进程 fetch 内网资源并写入 videos/ 目录导致信息泄露
  if (!isSafeUrl(videoUrl)) {
    return { ok: false, error: `视频 URL 安全校验失败（仅允许公网 HTTPS）: ${videoUrl.slice(0, 100)}` };
  }

  try {
    const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!resp.ok) {
      return { ok: false, error: `下载视频失败: HTTP ${resp.status}` };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    ensureVideosDir();
    const localName = `${backend}_${Date.now()}.mp4`;
    const localPath = path.join(VIDEOS_DIR, localName);
    fs.writeFileSync(localPath, buffer);
    return { ok: true, videoPath: localPath };
  } catch (err) {
    return {
      ok: false,
      error: `下载视频失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── 工具定义 ──────────────────────────────────────────────────

const videoGenerateTool: ToolDefinition = {
  name: 'video_generate',
  description:
    '文生视频工具。当用户要求"生成一段视频""做个短视频""生成动态画面"时调用。支持火山 Seedance / Runway Gen-3 / OpenAI Sora 三种后端，按 config.json 中 video.backend 选择。返回本地 MP4 路径。生成耗时较长（约 1-5 分钟）。',
  parameters: z.object({
    prompt: z
      .string()
      .min(1)
      .max(2000)
      .describe('视频生成的 prompt，描述画面内容、镜头运动、风格等'),
    model: z
      .string()
      .optional()
      .describe('模型标识，如 seedance-v1-pro / gen3a_turbo / sora-2。不填用默认'),
    resolution: z
      .string()
      .optional()
      .describe('分辨率，如 720p / 1080p。不填用默认'),
    duration_seconds: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe('视频时长（秒），默认 5。部分后端仅支持 5/10 秒'),
    aspect_ratio: z
      .string()
      .optional()
      .describe('宽高比，如 16:9 / 9:16 / 1:1。不填用默认'),
    image_url: z
      .string()
      .url()
      .optional()
      .describe('图生视频模式：提供起始图片 URL，视频将基于此图生成动态画面'),
    backend: z
      .enum(['volcano', 'runway', 'sora'])
      .optional()
      .describe('强制指定后端，不填则用 config.video.backend'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const config = readVideoConfig();
    const backend = (params.backend as BackendName | undefined) ?? config.backend ?? 'volcano';

    const options: VideoGenerateOptions = {
      prompt: params.prompt as string,
      model: params.model as string | undefined,
      resolution: params.resolution as string | undefined,
      durationSeconds: params.duration_seconds as number | undefined,
      aspectRatio: params.aspect_ratio as string | undefined,
      imageUrl: params.image_url as string | undefined,
    };

    let result: AdapterResult;
    switch (backend) {
      case 'volcano':
        result = await generateViaVolcano(options, config);
        break;
      case 'runway':
        result = await generateViaRunway(options, config);
        break;
      case 'sora':
        result = await generateViaSora(options, config);
        break;
      default:
        result = { ok: false, error: `未知后端: ${backend}` };
    }

    if (!result.ok || !result.videoPath) {
      return {
        ok: false,
        data: result.error ?? '生视频失败',
        latencyMs: Date.now() - startTime,
      };
    }

    return {
      ok: true,
      data: {
        video_path: result.videoPath,
        backend,
        prompt: options.prompt,
        model: options.model,
        resolution: options.resolution,
        duration_seconds: options.durationSeconds,
        aspect_ratio: options.aspectRatio,
        task_id: result.taskId,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

export function registerVideoGenerateTools(): void {
  registerTools([videoGenerateTool]);
  console.log('[Tools] video_generate 已注册（v2.1 生视频工具）');
}
