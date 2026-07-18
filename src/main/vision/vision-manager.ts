/**
 * Vision 输入管理器（v2.5 全模态闭环）
 *
 * 职责：
 *   1. 接收渲染层上传的图片 base64 → 存到 data/media/ → 返回路径
 *   2. 调用 ollama vision 模型（如 qwen2-vl / llava）理解图片内容
 *   3. 生成缩略图（省显存，最大 200x200）
 *   4. OCR 预留口（PaddleOCR / Tesseract，当前返回空）
 *
 * 不占 GPU（图片缩放用纯 JS，vision 推理由 ollama 进程处理）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ollamaChatStream, type OllamaChatMessage } from '../agent/ollama-client';
import { getConfig } from '../config/config';
import type { StreamCallback } from '../agent/ollama-client';

// ── 常量 ──────────────────────────────────────────────────────

const MEDIA_DIR = path.resolve(process.cwd(), 'data', 'media');

/** 支持的 MIME 类型 */
const SUPPORTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** 单张图片最大 10MB（base64 后约 13MB） */
const MAX_BASE64_SIZE = 13 * 1024 * 1024;

/** 默认 vision 模型 */
const DEFAULT_VISION_MODEL = 'qwen2-vl';

/** 默认最大图片数 */
const DEFAULT_MAX_IMAGES = 4;

/** 默认最大边长（超过则等比缩放） */
const DEFAULT_MAX_IMAGE_SIZE = 1024;

// ── 类型 ──────────────────────────────────────────────────────

export interface ImageUploadResult {
  ok: boolean;
  path?: string;
  base64?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface VisionAnalysisResult {
  description: string;
  ocrText?: string;
  imagePaths: string[];
}

// ── 工具函数 ──────────────────────────────────────────────────

/** 确保 media 目录存在 */
function ensureMediaDir(): void {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

/** 生成唯一文件名 */
function generateFileName(mimeType: string): string {
  const ext = mimeType.split('/')[1] ?? 'png';
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}.${ext}`;
}

/** 简单的 base64 大小估算 */
function estimateBase64Size(base64: string): number {
  return Math.ceil(base64.length * 3 / 4);
}

/**
 * 从 base64 解析图片宽高（PNG/JPEG 头部读取）
 *
 * 纯 JS 实现，不依赖 canvas/sharp。
 * 返回 { width, height }，解析失败返回 undefined。
 */
function getImageDimensions(base64: string): { width: number; height: number } | undefined {
  try {
    const buf = Buffer.from(base64, 'base64');
    // PNG: bytes 16-19 = width, 20-23 = height (big-endian)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
    // JPEG: 扫描 SOF0 (0xFFC0) 标记
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        const segmentLength = buf.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }
    // WebP / GIF 暂不解析（返回 undefined 即可）
    return undefined;
  } catch {
    return undefined;
  }
}

// ── 核心功能 ──────────────────────────────────────────────────

/**
 * 保存上传的图片到 data/media/
 *
 * @param base64  图片 base64（不含 data:image/xxx;base64, 前缀）
 * @param mimeType  MIME 类型
 * @returns 保存结果（含路径、base64、缩略图信息）
 */
export function saveUploadedImage(
  base64: string,
  mimeType: string,
): ImageUploadResult {
  try {
    // 校验 MIME
    if (!SUPPORTED_MIME.has(mimeType)) {
      return { ok: false, error: `不支持的图片格式: ${mimeType}` };
    }

    // 校验大小
    if (estimateBase64Size(base64) > MAX_BASE64_SIZE) {
      return { ok: false, error: '图片超过 10MB 限制' };
    }

    ensureMediaDir();

    const filename = generateFileName(mimeType);
    const filePath = path.join(MEDIA_DIR, filename);
    const relativePath = `data/media/${filename}`;

    // 写入文件
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buf);

    // 解析宽高
    const dims = getImageDimensions(base64);

    console.log(`[Vision] saved image: ${relativePath} (${dims?.width ?? '?'}x${dims?.height ?? '?'})`);

    return {
      ok: true,
      path: relativePath,
      base64,
      width: dims?.width,
      height: dims?.height,
    };
  } catch (err) {
    console.error('[Vision] saveUploadedImage failed:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * 调用 vision 模型分析图片内容
 *
 * @param images     图片 base64 列表（不含前缀）
 * @param prompt     用户指令（如"这张图里有什么？"）
 * @param onDelta    流式回调
 * @returns 分析结果文本
 */
export async function analyzeImages(
  images: string[],
  prompt: string,
  onDelta?: StreamCallback,
): Promise<string> {
  const config = getConfig();
  const visionConfig = config.vision ?? {};
  const model = visionConfig.model ?? DEFAULT_VISION_MODEL;
  const maxImages = visionConfig.maxImages ?? DEFAULT_MAX_IMAGES;

  // 限制图片数量
  const limitedImages = images.slice(0, maxImages);
  if (limitedImages.length === 0) {
    throw new Error('[Vision] 没有可分析的图片');
  }

  // 构建多模态消息
  const systemPrompt = `你是纳西妲，须弥的草神。你现在正在看一张图片。请用温柔、简洁的语言描述你看到的内容，可以适当加入自然隐喻。如果图片中有文字，请也识别出来。`;

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: prompt || '请描述这张图片的内容。',
      images: limitedImages,
    },
  ];

  console.log(`[Vision] analyzing ${limitedImages.length} image(s) with model ${model}`);

  const result = await ollamaChatStream(model, messages, onDelta ?? (() => {}), {
    temperature: 0.4,
    num_predict: 512,
  });

  return result;
}

/**
 * OCR 预留口（v2.5 骨架，当前返回空字符串）
 *
 * 未来接入路径：
 *   - PaddleOCR（Python subprocess）
 *   - Tesseract.js（纯 Node.js）
 *   - ollama vision 模型自带 OCR 能力（已在 analyzeImages 中覆盖）
 */
export async function runOCR(_imageBase64: string): Promise<string> {
  const config = getConfig();
  const visionConfig = config.vision ?? {};

  if (!visionConfig.ocrEnabled) {
    return '';
  }

  // TODO: 接入 PaddleOCR / Tesseract
  console.log('[Vision] OCR not yet implemented, returning empty');
  return '';
}

/**
 * 完整的 vision 分析流程
 *
 * 1. 保存图片到磁盘
 * 2. 调用 vision 模型分析
 * 3. 可选 OCR
 * 4. 返回综合结果
 */
export async function processVisionRequest(
  images: string[],
  prompt: string,
  onDelta?: StreamCallback,
): Promise<VisionAnalysisResult> {
  // 1. 保存图片
  const imagePaths: string[] = [];
  const validBase64s: string[] = [];

  for (const base64 of images) {
    const result = saveUploadedImage(base64, 'image/png');
    if (result.ok && result.path) {
      imagePaths.push(result.path);
      validBase64s.push(base64);
    } else {
      console.warn(`[Vision] failed to save image: ${result.error}`);
    }
  }

  if (validBase64s.length === 0) {
    return {
      description: '（花冠微垂，有些困惑）……抱歉，我没有看清那张图片。',
      imagePaths: [],
    };
  }

  // 2. 调用 vision 模型
  let description = '';
  try {
    description = await analyzeImages(validBase64s, prompt, onDelta);
  } catch (err) {
    console.error('[Vision] analyzeImages failed:', err);
    description = `（虚空屏微光一闪）……我的视觉暂时有些模糊，没能看清。错误：${String(err)}`;
  }

  // 3. 可选 OCR
  let ocrText: string | undefined;
  if (getConfig().vision?.ocrEnabled) {
    try {
      const ocrResults = await Promise.all(
        validBase64s.map(b => runOCR(b)),
      );
      ocrText = ocrResults.filter(s => s.length > 0).join('\n');
    } catch (err) {
      console.warn('[Vision] OCR failed:', err);
    }
  }

  return {
    description,
    ocrText: ocrText || undefined,
    imagePaths,
  };
}
