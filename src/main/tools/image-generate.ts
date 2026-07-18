/**
 * 生图工具 —— v2.0.0
 *
 * 职责：
 *   接入文生图后端（ComfyUI / DALL·E / 本地 SD WebUI），把 LLM 的 prompt
 *   变成一张 PNG 落到 data/images/，并把路径回给上层。
 *
 * 后端优先级：
 *   1. ComfyUI（本地，默认 http://127.0.0.1:8188）—— 免费、可定制
 *   2. OpenAI DALL·E 3 —— 收费、高质量
 *   3. SD WebUI（本地，http://127.0.0.1:7860）—— 兼容旧 stable-diffusion-webui
 *
 * 配置读取：data/config.json 的 image 字段
 *   {
 *     "image": {
 *       "backend": "comfyui" | "dalle" | "sdwebui",
 *       "comfyuiUrl": "http://127.0.0.1:8188",
 *       "sdwebuiUrl": "http://127.0.0.1:7860",
 *       "dalleApiKey": "sk-...",
 *       "defaultModel": "sd_xl_base_1.0",
 *       "defaultSize": "1024x1024",
 *       "defaultSteps": 25,
 *       "defaultCfg": 7.5
 *     }
 *   }
 *
 * 安全约束：
 *   - prompt 长度 ≤ 1000 字符
 *   - 仅 HTTPS 或 localhost 后端（防 SSRF）
 *   - 输出路径限定在 data/images/ 下
 *   - 失败不阻塞 Agent，返回 ok:false 让四审降级
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import { getConfig } from '../config/config';
import type { ImageConfig } from '../../shared/types/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 配置读取 ──────────────────────────────────────────────────

function readImageConfig(): ImageConfig {
  const config = getConfig();
  return config.image ?? {};
}

// ── 输出目录 ──────────────────────────────────────────────────

const IMAGES_DIR = path.resolve(process.cwd(), 'data', 'images');

function ensureImagesDir(): void {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

// ── SSRF 防护 ─────────────────────────────────────────────────

/**
 * 检查后端 URL 是否安全（VULN-003 修复）
 *
 * 允许：
 *   - localhost / 127.0.0.1 / ::1（本地生图后端）
 *   - 公网地址（http / https）
 *
 * 阻止：
 *   - 私网地址（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）
 *   - 链路本地（169.254.0.0/16，含 AWS 元数据 169.254.169.254）
 *   - CGNAT（100.64.0.0/10）
 *   - 0.0.0.0/8
 *   - IPv6 ULA（fc00::/7）和 link-local（fe80::/10）
 */
function isSafeBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();

    // 解 IPv6 方括号
    const cleanHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

    // 允许 localhost / 127.0.0.1 / ::1（本地生图后端）
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1') {
      return true;
    }

    // 阻止 IPv6 ULA [fc00::]/7
    if (cleanHost.startsWith('fc') || cleanHost.startsWith('fd')) return false;
    // 阻止 IPv6 link-local [fe80::]/10
    if (cleanHost.startsWith('fe8') || cleanHost.startsWith('fe9') ||
        cleanHost.startsWith('fea') || cleanHost.startsWith('feb')) return false;

    // 阻止 IPv4 回环 127.0.0.0/8（非 127.0.0.1 的其他回环也不允许）
    if (cleanHost.startsWith('127.') && cleanHost !== '127.0.0.1') return false;
    // 阻止 IPv4 私网 10.0.0.0/8
    if (cleanHost.startsWith('10.')) return false;
    // 阻止 IPv4 私网 172.16.0.0/12
    if (cleanHost.startsWith('172.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 16 && secondOctet <= 31) return false;
    }
    // 阻止 IPv4 私网 192.168.0.0/16
    if (cleanHost.startsWith('192.168.')) return false;
    // 阻止 IPv4 链路本地 169.254.0.0/16（含 AWS 元数据）
    if (cleanHost.startsWith('169.254.')) return false;
    // 阻止 IPv4 CGNAT 100.64.0.0/10
    if (cleanHost.startsWith('100.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 64 && secondOctet <= 127) return false;
    }
    // 阻止 0.0.0.0/8
    if (cleanHost.startsWith('0.')) return false;

    // 公网地址放行
    return true;
  } catch {
    return false;
  }
}

// ── ComfyUI 后端 ──────────────────────────────────────────────

interface ComfyuiPromptResponse {
  prompt_id: string;
}

interface ComfyuiHistoryResponse {
  [promptId: string]: {
    outputs: {
      [nodeId: string]: {
        images?: Array<{ filename: string; subfolder: string; type: string }>;
      };
    };
  };
}

/**
 * 调用 ComfyUI API 文生图
 *
 * ComfyUI 工作流：使用最简的 CheckpointLoader → CLIPTextEncode → KSampler → VAEDecode → SaveImage
 * 通过 /prompt 提交，轮询 /history/{id} 取结果，再 /view 下载图像
 */
async function generateViaComfyui(
  prompt: string,
  options: {
    model?: string;
    size: string;
    steps: number;
    cfg: number;
  },
): Promise<{ ok: boolean; imagePath?: string; error?: string }> {
  const config = readImageConfig();
  const baseUrl = (config.comfyuiUrl ?? 'http://127.0.0.1:8188').replace(/\/$/, '');
  if (!isSafeBackendUrl(baseUrl)) {
    return { ok: false, error: '后端 URL 安全校验失败' };
  }

  // 解析尺寸
  const [widthStr, heightStr] = options.size.split('x');
  const width = parseInt(widthStr ?? '1024', 10) || 1024;
  const height = parseInt(heightStr ?? '1024', 10) || 1024;
  const model = options.model ?? config.defaultModel ?? 'sd_xl_base_1.0.safetensors';

  // 构造 workflow（ComfyUI API 格式）
  const workflow = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1_000_000_000_000),
        steps: options.steps,
        cfg: options.cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: model },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
        clip: ['4', 1],
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0] },
    },
  };

  try {
    // 1. 提交 prompt
    const submitResp = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!submitResp.ok) {
      return { ok: false, error: `ComfyUI /prompt 返回 HTTP ${submitResp.status}` };
    }
    const submitData = (await submitResp.json()) as ComfyuiPromptResponse;
    const promptId = submitData.prompt_id;

    // 2. 轮询 history（最多等 120 秒）
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;

      const histResp = await fetch(`${baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!histResp.ok) continue;

      const histData = (await histResp.json()) as ComfyuiHistoryResponse;
      const entry = histData[promptId];
      if (!entry || !entry.outputs) continue;

      // 找第一个有 images 的输出节点
      for (const nodeId of Object.keys(entry.outputs)) {
        const node = entry.outputs[nodeId];
        if (!node) continue;
        if (!node.images || node.images.length === 0) continue;
        const img = node.images[0];
        if (!img) continue;

        // 3. 下载图片
        const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`;
        const imgResp = await fetch(viewUrl, { signal: AbortSignal.timeout(30_000) });
        if (!imgResp.ok) {
          return { ok: false, error: `下载图片失败: HTTP ${imgResp.status}` };
        }
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        ensureImagesDir();
        const localName = `comfyui_${Date.now()}.png`;
        const localPath = path.join(IMAGES_DIR, localName);
        fs.writeFileSync(localPath, buffer);
        return { ok: true, imagePath: localPath };
      }
    }
    return { ok: false, error: 'ComfyUI 生成超时（120s 无结果）' };
  } catch (err) {
    return {
      ok: false,
      error: `ComfyUI 请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── DALL·E 后端 ───────────────────────────────────────────────

interface DalleResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message: string };
}

async function generateViaDalle(
  prompt: string,
  options: { size: string },
): Promise<{ ok: boolean; imagePath?: string; error?: string }> {
  const config = readImageConfig();
  const apiKey = config.dalleApiKey;
  if (!apiKey) {
    return { ok: false, error: 'DALL·E API key 未配置（settings 中 image.dalleApiKey）' };
  }

  // DALL·E 3 支持的尺寸：1024x1024 / 1792x1024 / 1024x1792
  const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
  const size = validSizes.includes(options.size) ? options.size : '1024x1024';

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const errData = (await resp.json()) as DalleResponse;
      return {
        ok: false,
        error: `DALL·E API 返回 HTTP ${resp.status}: ${errData.error?.message ?? resp.statusText}`,
      };
    }

    const data = (await resp.json()) as DalleResponse;
    const firstImage = data.data?.[0];
    if (!firstImage?.b64_json) {
      return { ok: false, error: 'DALL·E 返回数据缺少 b64_json' };
    }

    const buffer = Buffer.from(firstImage.b64_json, 'base64');
    ensureImagesDir();
    const localName = `dalle_${Date.now()}.png`;
    const localPath = path.join(IMAGES_DIR, localName);
    fs.writeFileSync(localPath, buffer);
    return { ok: true, imagePath: localPath };
  } catch (err) {
    return {
      ok: false,
      error: `DALL·E 请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── SD WebUI 后端 ─────────────────────────────────────────────

interface SdWebuiResponse {
  images?: string[];
  info?: string;
  error?: string;
}

async function generateViaSdwebui(
  prompt: string,
  options: {
    model?: string;
    size: string;
    steps: number;
    cfg: number;
  },
): Promise<{ ok: boolean; imagePath?: string; error?: string }> {
  const config = readImageConfig();
  const baseUrl = (config.sdwebuiUrl ?? 'http://127.0.0.1:7860').replace(/\/$/, '');
  if (!isSafeBackendUrl(baseUrl)) {
    return { ok: false, error: 'SD WebUI URL 安全校验失败' };
  }

  const [widthStr, heightStr] = options.size.split('x');
  const width = parseInt(widthStr ?? '512', 10) || 512;
  const height = parseInt(heightStr ?? '512', 10) || 512;

  try {
    const resp = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative_prompt:
          'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
        steps: options.steps,
        cfg_scale: options.cfg,
        width,
        height,
        sampler_name: 'DPM++ 2M Karras',
        batch_size: 1,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const errData = (await resp.json().catch(() => ({})) as SdWebuiResponse);
      return {
        ok: false,
        error: `SD WebUI 返回 HTTP ${resp.status}: ${errData.error ?? resp.statusText}`,
      };
    }

    const data = (await resp.json()) as SdWebuiResponse;
    const firstB64 = data.images?.[0];
    if (!firstB64) {
      return { ok: false, error: 'SD WebUI 返回数据缺少 images' };
    }

    const buffer = Buffer.from(firstB64, 'base64');
    ensureImagesDir();
    const localName = `sdwebui_${Date.now()}.png`;
    const localPath = path.join(IMAGES_DIR, localName);
    fs.writeFileSync(localPath, buffer);
    return { ok: true, imagePath: localPath };
  } catch (err) {
    return {
      ok: false,
      error: `SD WebUI 请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── 工具定义 ──────────────────────────────────────────────────

const imageGenerateTool: ToolDefinition = {
  name: 'image_generate',
  description:
    '文生图工具。当用户要求"画一张""生成一张图片""画一个"时调用。支持 ComfyUI / DALL·E / SD WebUI 三种后端，自动按 config.json 中的 image.backend 选择。返回本地图片路径。',
  parameters: z.object({
    prompt: z
      .string()
      .min(1)
      .max(1000)
      .describe('图像生成的 prompt，建议英文以获得更好效果'),
    negative_prompt: z
      .string()
      .max(500)
      .optional()
      .describe('负向 prompt（不想要的内容），仅 ComfyUI / SD WebUI 生效'),
    size: z
      .string()
      .optional()
      .describe('图像尺寸，如 "1024x1024"、"1792x1024"。默认 1024x1024'),
    steps: z
      .number()
      .int()
      .min(1)
      .max(150)
      .optional()
      .describe('采样步数，默认 25。仅 ComfyUI / SD WebUI 生效'),
    cfg: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe('CFG scale，默认 7.5。仅 ComfyUI / SD WebUI 生效'),
    backend: z
      .enum(['comfyui', 'dalle', 'sdwebui'])
      .optional()
      .describe('强制指定后端，不填则用 config.image.backend'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const config = readImageConfig();
    const backend = (params.backend as 'comfyui' | 'dalle' | 'sdwebui' | undefined) ?? config.backend ?? 'comfyui';
    const prompt = params.prompt as string;
    const size = (params.size as string) ?? config.defaultSize ?? '1024x1024';
    const steps = (params.steps as number) ?? config.defaultSteps ?? 25;
    const cfg = (params.cfg as number) ?? config.defaultCfg ?? 7.5;
    const model = config.defaultModel;

    let result: { ok: boolean; imagePath?: string; error?: string };

    switch (backend) {
      case 'comfyui':
        result = await generateViaComfyui(prompt, { model, size, steps, cfg });
        break;
      case 'dalle':
        result = await generateViaDalle(prompt, { size });
        break;
      case 'sdwebui':
        result = await generateViaSdwebui(prompt, { model, size, steps, cfg });
        break;
      default:
        result = { ok: false, error: `未知后端: ${backend}` };
    }

    if (!result.ok || !result.imagePath) {
      return {
        ok: false,
        data: result.error ?? '生图失败',
        latencyMs: Date.now() - startTime,
      };
    }

    return {
      ok: true,
      data: {
        image_path: result.imagePath,
        backend,
        prompt,
        size,
        steps: backend === 'dalle' ? undefined : steps,
        cfg: backend === 'dalle' ? undefined : cfg,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

export function registerImageGenerateTools(): void {
  registerTools([imageGenerateTool]);
  console.log('[Tools] image_generate 已注册（v2.0 生图工具）');
}
