/**
 * Vision 输入管理器（v2.5 全模态闭环 / v2.7 OCR 实装）
 *
 * 职责：
 *   1. 接收渲染层上传的图片 base64 → 存到 data/media/ → 返回路径
 *   2. 调用 ollama vision 模型（如 qwen2-vl）理解图片内容
 *   3. 生成缩略图（省显存，最大 200x200）
 *   4. OCR 实装（v2.7：Tesseract.js，支持中英文）
 *
 * 不占 GPU（图片缩放用纯 JS，vision 推理由 ollama 进程处理）。
 * Tesseract.js 走 wasm + worker thread，主进程不阻塞。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ollamaChatStream, type OllamaChatMessage } from '../agent/ollama-client';
import { getConfig } from '../config/config';
import type { StreamCallback } from '../agent/ollama-client';

// v2.16: 屏幕实时监控
import * as ScreenMonitor from './screen-monitor.js';

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

/** 默认 OCR 语言（中英混合，Tesseract 语言代码） */
const DEFAULT_OCR_LANGUAGE = 'chi_sim+eng';

/** OCR 单张图片超时（ms），防止 worker 卡死 */
const OCR_TIMEOUT_MS = 30 * 1000;

/** OCR 重复调用间隔（ms），避免 worker 频繁创建 */
const OCR_DEBOUNCE_MS = 100;

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
  /** v2.14：OCR 置信度摘要（多图时取第一张的） */
  ocrConfidence?: {
    average: number;
    minimum: number;
    lowCount: number;
    totalLines: number;
  };
  /** v2.20：OCR 二次识别信息 */
  ocrRerecognize?: {
    rerecognizedCount: number;
    improvedCount: number;
  };
  /** v2.20：OCR 语言检测信息 */
  ocrLanguage?: {
    code: string;
    autoDetected: boolean;
  };
  /** v2.20：是否来自缓存命中 */
  fromCache?: boolean;
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
 * 判断 buffer 是否为 PNG（头部 8 字节签名）
 * PNG 签名：89 50 4E 47 0D 0A 1A 0A
 */
function isPng(buf: Buffer): boolean {
  return buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

/**
 * PNG 图片灰度化预处理（v2.7.1 OCR 准确度优化）
 *
 * 使用 ITU-R BT.601 加权平均：Y = 0.299R + 0.587G + 0.114B
 * （人眼对绿色更敏感，所以 G 权重最高）
 *
 * 灰度化对 OCR 的帮助：
 *   - 消除色彩干扰，让 Tesseract 聚焦于文字边缘
 *   - 减少颜色噪声，提升二值化效果
 *   - 文档/截图场景识别率显著提升
 *
 * 仅处理 PNG（截图最常见格式）。JPEG/WebP/GIF 保持原样让 Tesseract 内部处理。
 * 解码失败时返回原始 buffer，不阻塞 OCR 流程。
 *
 * 动态 import pngjs，未启用 OCR 时零开销。
 */
async function grayscalePng(buf: Buffer): Promise<Buffer> {
  try {
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const pixels = png.data; // RGBA Buffer
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      // BT.601 加权平均，等价于灰度值
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
      // alpha（pixels[i+3]）保持不变
    }
    return PNG.sync.write(png);
  } catch (err) {
    console.warn('[Vision] grayscalePng failed, using original:', err);
    return buf;
  }
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
 * OCR 实装（v2.7：Tesseract.js → v2.14：行级置信度）
 *
 * 使用 Tesseract.js 纯 JS OCR 库，走 wasm + worker thread。
 * 首次调用会下载语言包（缓存在 node_modules/tesseract.js/worker/）。
 * 后续调用复用 worker，速度更快。
 *
 * v2.14 新增：
 *   - 提取 Tesseract 行级置信度（result.data.lines / words）
 *   - 返回 OcrEnhancedResult，含置信度摘要
 *   - 旧的 runOCR() 字符串返回保留为简版包装
 *
 * 支持语言代码（Tesseract 标准）：
 *   - chi_sim 简体中文
 *   - chi_tra 繁体中文
 *   - eng     英文
 *   - jpn     日文
 *   - kor     韩文
 * 多语言用 + 连接，如 "chi_sim+eng"
 */

/** v2.14：OCR 增强返回类型 */
export interface OcrEnhancedResult {
  /** 清洗后的文本 */
  text: string;
  /** 原始文本 */
  raw: string;
  /** 行级置信度摘要 */
  confidence?: {
    average: number;
    minimum: number;
    lowCount: number;
    totalLines: number;
    /** 低置信度行（便于 UI 高亮） */
    lowConfidenceLines: Array<{ text: string; confidence: number }>;
  };
  /** v2.17：二次识别信息（有低置信度行被重识别时存在） */
  rerecognize?: {
    /** 二次识别的行数 */
    rerecognizedCount: number;
    /** 采纳（改进）的行数 */
    improvedCount: number;
  };
  /** v2.18：语言检测信息 */
  language?: {
    /** 使用的语言代码 */
    code: string;
    /** 是否自动检测 */
    autoDetected: boolean;
  };
}

/**
 * 提取 Tesseract 行级置信度数据（v2.14 置信度 + v2.17 bbox）
 *
 * Tesseract.js v5+ 的 result.data.lines 是行数组，每行有 text、confidence 和 bbox。
 * 某些版本可能用 result.data.words 或不返回 lines，做兼容处理。
 */
function extractTesseractLines(data: unknown): Array<{ text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> {
  const lines: Array<{ text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> = [];
  try {
    const d = data as {
      lines?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
      words?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
    };
    // 优先用 lines
    if (Array.isArray(d.lines) && d.lines.length > 0) {
      for (const line of d.lines) {
        if (line.text && typeof line.confidence === 'number') {
          lines.push({
            text: line.text,
            confidence: line.confidence,
            bbox: line.bbox,
          });
        }
      }
    }
    // lines 为空时，用 words 聚合成行（按空格拼接是近似，仅用于置信度参考）
    if (lines.length === 0 && Array.isArray(d.words) && d.words.length > 0) {
      // 简单聚合：每 5 个 word 一行（近似）
      const chunkSize = 5;
      for (let i = 0; i < d.words.length; i += chunkSize) {
        const chunk = d.words.slice(i, i + chunkSize);
        const text = chunk.map(w => w.text ?? '').join(' ');
        const confs = chunk.map(w => w.confidence ?? 0).filter(c => c > 0);
        const avgConf = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
        // words 没有 bbox 聚合（复杂度高，暂不做）
        if (text.trim() && avgConf > 0) {
          lines.push({ text, confidence: avgConf });
        }
      }
    }
  } catch {
    // 解析失败返回空数组，postProcessOcr 会用结构质量评分兜底
  }
  return lines;
}

/**
 * OCR 核心执行（v2.14：返回增强结果含置信度）
 *
 * @param imageBase64  图片 base64（不含 data:image/xxx;base64, 前缀）
 * @returns 增强结果（文本 + 置信度），识别失败或未启用返回空文本
 */
export async function runOCREnhanced(imageBase64: string, languageHint?: string): Promise<OcrEnhancedResult> {
  const config = getConfig();
  const visionConfig = config.vision ?? {};

  if (!visionConfig.ocrEnabled) {
    return { text: '', raw: '' };
  }

  // v2.18：多语言自动检测
  let language = visionConfig.ocrLanguage ?? DEFAULT_OCR_LANGUAGE;
  
  // 如果配置中未指定语言，尝试从提示或自动检测
  if (!visionConfig.ocrLanguage && languageHint) {
    const { hintToLanguage } = await import('./ocr-language-detect.js');
    const hinted = hintToLanguage(languageHint);
    if (hinted.length > 0) {
      language = hinted.join('+');
    }
  }

  // 动态 import 避免未启用 OCR 时也加载 wasm
  const { default: Tesseract } = await import('tesseract.js');

  console.log(`[Vision] OCR start: lang=${language}`);

  // v2.7.1: PNG 图片先灰度化预处理，提高识别准确度
  let imageBuffer: Buffer = Buffer.from(imageBase64, 'base64');
  if (isPng(imageBuffer)) {
    imageBuffer = await grayscalePng(imageBuffer) as Buffer;
    console.log('[Vision] PNG grayscale preprocessing applied');
  }

  // 用 Promise.race 实现超时保护
  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | undefined;
  try {
    worker = await Tesseract.createWorker(language, 1, {
      // 静默 logger，避免刷屏
      logger: () => { /* 静默 */ },
    });

    const recognizePromise = worker.recognize(imageBuffer);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS);
    });

    const result = await Promise.race([recognizePromise, timeoutPromise]);
    const rawText = (result?.data?.text ?? '').trim();

    // v2.14：提取 Tesseract 行级置信度（v2.17：含 bbox）
    const tesseractLines = extractTesseractLines(result?.data);

    // 简单 debounce，避免连续 OCR 时 worker 抢占
    await new Promise(resolve => setTimeout(resolve, OCR_DEBOUNCE_MS));

    // v2.10: OCR 后处理（清洗 + 结构分析 + 质量评分 + v2.14 置信度）
    const { postProcessOcr } = await import('./ocr-postprocess.js');
    const processed = postProcessOcr(rawText, tesseractLines);

    console.log(`[Vision] OCR done: raw=${rawText.length} chars, cleaned=${processed.cleaned.length} chars, quality=${processed.structure.qualityScore}/100, confidence=${processed.confidence?.average ?? 'N/A'}% (min=${processed.confidence?.minimum ?? 'N/A'}%, low=${processed.confidence?.lowCount ?? 0}/${processed.confidence?.totalLines ?? 0}), lang=${processed.structure.primaryLanguage}, corrections=${processed.corrections.length}`);

    // v2.17：低置信度行二次识别
    let finalText = processed.cleaned;
    let rerecognizeInfo: OcrEnhancedResult['rerecognize'] | undefined;

    if (processed.confidence && processed.confidence.lowCount > 0) {
      // 筛选有 bbox 的低置信度行
      const lowLinesWithBbox = processed.confidence.lines
        .filter(l => l.level === 'low' && l.bbox)
        .map(l => ({
          text: l.text,
          confidence: l.confidence,
          bbox: l.bbox as { x0: number; y0: number; x1: number; y1: number },
        }));

      if (lowLinesWithBbox.length > 0) {
        try {
          const { rerecognizeLowConfidenceLines } = await import('./ocr-rerecognize.js');
          const rerecognizeResult = await rerecognizeLowConfidenceLines(
            imageBuffer,
            lowLinesWithBbox,
            language,
          );

          if (rerecognizeResult.improvedCount > 0) {
            // 用二次识别结果替换 processed.cleaned 中的对应行
            // 简单策略：按行匹配替换（低置信度行的原始文本 → 改进后文本）
            let updatedText = finalText;
            for (const r of rerecognizeResult.results) {
              if (r.improved && r.originalText !== r.rerecognizedText) {
                updatedText = updatedText.replace(r.originalText, r.rerecognizedText);
              }
            }
            finalText = updatedText;
            rerecognizeInfo = {
              rerecognizedCount: rerecognizeResult.rerecognizedCount,
              improvedCount: rerecognizeResult.improvedCount,
            };
            console.log(`[Vision] rerecognize: ${rerecognizeResult.rerecognizedCount} lines re-recognized, ${rerecognizeResult.improvedCount} improved`);
          }
        } catch (err) {
          console.warn('[Vision] rerecognize failed (non-fatal):', err);
        }
      }
    }

    return {
      text: finalText,
      raw: rawText,
      confidence: processed.confidence
        ? {
            average: processed.confidence.average,
            minimum: processed.confidence.minimum,
            lowCount: processed.confidence.lowCount,
            totalLines: processed.confidence.totalLines,
            lowConfidenceLines: processed.confidence.lines
              .filter(l => l.level === 'low')
              .map(l => ({ text: l.text, confidence: l.confidence })),
          }
        : undefined,
      rerecognize: rerecognizeInfo,
      language: {
        code: language,
        autoDetected: !!languageHint && !visionConfig.ocrLanguage,
      },
    };
  } catch (err) {
    console.error('[Vision] OCR failed:', err);
    return { text: '', raw: '' };
  } finally {
    // 必须显式 terminate，否则 worker 线程不会退出
    try {
      await worker?.terminate();
    } catch {
      // ignore terminate error
    }
  }
}

/**
 * OCR 简版（保留字符串返回，向后兼容旧调用方）
 *
 * @param imageBase64  图片 base64（不含 data:image/xxx;base64, 前缀）
 * @returns 识别出的文本，识别失败或未启用返回空字符串
 */
export async function runOCR(imageBase64: string): Promise<string> {
  const result = await runOCREnhanced(imageBase64);
  return result.text;
}

// ── 视频分析（v2.12.0） ──────────────────────────────────────

export interface VideoAnalysisResult {
  ok: boolean;
  description: string;
  /** 抽取的帧数 */
  frameCount: number;
  /** 视频时长（秒） */
  duration: number;
  /** 帧图片路径列表 */
  imagePaths: string[];
  /** 抽帧策略：scene（场景切换）/ uniform（均匀）/ mixed（混合） */
  strategy?: 'scene' | 'uniform' | 'mixed';
  /** OCR 文字（从所有帧合并） */
  ocrText?: string;
  /** v2.14：OCR 置信度摘要（所有帧的平均） */
  ocrConfidence?: {
    average: number;
    minimum: number;
    lowCount: number;
    totalLines: number;
  };
  error?: string;
}

// ── 视频路径安全校验（v3.0.1 第五关 AUTH-02）──────────────────
//
// 用户通过 IPC VIDEO_UPLOAD 传入 filePath，理论上应由渲染层 dialog 选定，
// 但 IPC 入口不能信任渲染层——必须做服务端校验，防止恶意路径直传 ffmpeg 读取敏感文件。
//
// 防御点：
//   1. 必须绝对路径（拒绝相对路径，避免 process.cwd() 漂移导致读到非预期位置）
//   2. 扩展名白名单（.mp4/.mov/.avi/.mkv/.webm/.flv/.m4v），拒绝 .env/.json/.md 等敏感文件
//   3. realpathSync 解析符号链接，防止 memory/passwd_link → /etc/passwd 绕过
//   4. 拒绝项目内敏感目录（.trae/rules、memory/、config/、src/、modelfiles/、scripts/）
//      避免攻击者把项目内文件当视频读出来再通过 vision 描述回传

/** 视频文件扩展名白名单 */
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.wmv',
]);

/** 项目内禁止读取的敏感子目录（绝对路径前缀匹配） */
function getSensitiveProjectDirs(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, '.trae'),
    path.resolve(cwd, 'memory'),
    path.resolve(cwd, 'config'),
    path.resolve(cwd, 'src'),
    path.resolve(cwd, 'modelfiles'),
    path.resolve(cwd, 'scripts'),
    path.resolve(cwd, '.git'),
  ];
}

/**
 * 校验视频路径是否安全可读
 *
 * @returns 校验通过返回解析后的真实绝对路径，否则返回 null
 */
export function isSafeVideoPath(filePath: string): string | null {
  if (!filePath || typeof filePath !== 'string') return null;

  // 1. 必须是绝对路径
  if (!path.isAbsolute(filePath)) return null;

  // 2. 扩展名白名单（toLowerCase 防止 .MP4 绕过）
  const ext = path.extname(filePath).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) return null;

  // 3. 解析符号链接后的真实路径
  let realPath: string;
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    // 文件不存在或无权限访问
    return null;
  }

  // 4. 必须是文件（不是目录）
  try {
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  // 5. 真实路径不能落在项目内敏感目录
  const sensitiveDirs = getSensitiveProjectDirs();
  const inSensitive = sensitiveDirs.some(dir => {
    return realPath === dir || realPath.startsWith(dir + path.sep);
  });
  if (inSensitive) return null;

  return realPath;
}

/**
 * 视频分析完整流程（v2.12.0）
 *
 * 1. 调用 video-frame 抽取关键帧
 * 2. 把帧作为多图一起交给 vision 模型分析
 * 3. 可选 OCR（所有帧的 OCR 合并）
 * 4. 返回综合描述
 *
 * @param videoPath 视频文件绝对路径
 * @param prompt 用户提问
 * @param onDelta 流式回调
 */
export async function processVideoRequest(
  videoPath: string,
  prompt: string,
  onDelta?: (delta: string, done: boolean) => void,
): Promise<VideoAnalysisResult> {
  // 动态 import 避免未使用视频功能时加载 ffmpeg 检测
  const { extractFrames, isFFmpegAvailable } = await import('./video-frame.js');

  if (!isFFmpegAvailable()) {
    return {
      ok: false,
      description: '（花冠微垂）……还不能看视频哦。需要先安装 ffmpeg 才能分析视频。\nWindows 用户可以用 `scoop install ffmpeg` 或从官网下载后添加到 PATH。',
      frameCount: 0,
      duration: 0,
      imagePaths: [],
      error: 'ffmpeg not found',
    };
  }

  // 1. 抽取帧
  const extractResult = await extractFrames(videoPath);
  if (!extractResult.ok || !extractResult.frames || extractResult.frames.length === 0) {
    return {
      ok: false,
      description: `（花冠微垂）……视频帧抽取失败，${extractResult.error ?? '未知错误'}`,
      frameCount: 0,
      duration: extractResult.info?.duration ?? 0,
      imagePaths: [],
      error: extractResult.error,
    };
  }

  const frames = extractResult.frames;
  const imagePaths = frames.map(f => f.imagePath);
  const base64List = frames.map(f => f.base64);
  const duration = extractResult.info?.duration ?? 0;
  const strategy = extractResult.strategy;

  // 2. 构造带时间戳的 prompt（v2.13.0：附带抽帧策略信息）
  const frameTimestamps = frames.map((f, i) =>
    `[第${i + 1}帧 ${f.timestamp.toFixed(1)}秒]`,
  ).join('、');

  const strategyHint = strategy === 'scene'
    ? '这些帧是从视频的场景切换点抽取的，每个帧代表一个不同的场景。'
    : strategy === 'mixed'
      ? '这些帧包含视频的场景切换点和均匀分布的时间点。'
      : '这些帧是按时间均匀分布抽取的。';

  const enhancedPrompt = `这是一段时长约 ${duration.toFixed(1)} 秒的视频，我从中抽取了 ${frames.length} 个关键帧（按时间顺序：${frameTimestamps}）。\n${strategyHint}\n\n${prompt}\n\n请结合这些帧描述视频的主要内容。`;

  // 3. 调用 vision 模型（复用 processVisionRequest 逻辑，但用增强版 prompt）
  // 注意：processVisionRequest 内部会 save + analyze + OCR
  const visionResult = await analyzeImages(base64List, enhancedPrompt, onDelta);

  // 4. OCR（如果启用，v2.14：用增强版含置信度）
  let ocrText: string | undefined;
  let ocrConfidence: VideoAnalysisResult['ocrConfidence'] | undefined;
  const config = getConfig();
  if (config.vision?.ocrEnabled) {
    const ocrResults: string[] = [];
    const allConfidences: number[] = [];
    let totalLowCount = 0;
    let totalLines = 0;
    for (const frame of frames) {
      const enhanced = await runOCREnhanced(frame.base64);
      if (enhanced.text.trim()) {
        ocrResults.push(`[${frame.timestamp.toFixed(1)}s] ${enhanced.text.trim()}`);
      }
      if (enhanced.confidence && enhanced.confidence.totalLines > 0) {
        allConfidences.push(enhanced.confidence.average);
        totalLowCount += enhanced.confidence.lowCount;
        totalLines += enhanced.confidence.totalLines;
      }
    }
    if (ocrResults.length > 0) {
      ocrText = ocrResults.join('\n\n');
    }
    if (allConfidences.length > 0 && totalLines > 0) {
      ocrConfidence = {
        average: Math.round(allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length),
        minimum: Math.min(...allConfidences),
        lowCount: totalLowCount,
        totalLines,
      };
    }
  }

  return {
    ok: true,
    description: visionResult,
    frameCount: frames.length,
    duration,
    imagePaths,
    strategy,
    ocrText,
    ocrConfidence,
  };
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
  // v2.20：缓存检查（单图时才缓存，多图组合太复杂）
  let visionCache: typeof import('./vision-cache.js') | undefined;
  if (images.length === 1) {
    visionCache = await import('./vision-cache.js');
    const cacheKey = visionCache.computeCacheKey(images[0] ?? '', prompt);
    const cached = visionCache.getVisionCache<VisionAnalysisResult>(cacheKey);
    if (cached) {
      console.log('[Vision] cache hit, skipping model call');
      return { ...cached, fromCache: true };
    }
  }

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
  let visionFailed = false;
  try {
    description = await analyzeImages(validBase64s, prompt, onDelta);
  } catch (err) {
    console.error('[Vision] analyzeImages failed:', err);
    description = `（虚空屏微光一闪）……我的视觉暂时有些模糊，没能看清。错误：${String(err)}`;
    visionFailed = true; // 标记失败，不写缓存（避免毒化缓存让下次无法重试）
  }

  // 3. 可选 OCR（v2.14：用增强版，含置信度 + v2.17 二次识别 + v2.18 语言检测）
  let ocrText: string | undefined;
  let ocrConfidence: VisionAnalysisResult['ocrConfidence'] | undefined;
  let ocrRerecognize: VisionAnalysisResult['ocrRerecognize'] | undefined;
  let ocrLanguage: VisionAnalysisResult['ocrLanguage'] | undefined;
  if (getConfig().vision?.ocrEnabled) {
    try {
      const ocrResults = await Promise.all(
        validBase64s.map(b => runOCREnhanced(b)),
      );
      ocrText = ocrResults.filter(r => r.text.length > 0).map(r => r.text).join('\n');
      // 取第一张有置信度的图作为代表
      const firstWithConf = ocrResults.find(r => r.confidence && r.confidence.totalLines > 0);
      if (firstWithConf?.confidence) {
        ocrConfidence = {
          average: firstWithConf.confidence.average,
          minimum: firstWithConf.confidence.minimum,
          lowCount: firstWithConf.confidence.lowCount,
          totalLines: firstWithConf.confidence.totalLines,
        };
      }
      // v2.20：提取二次识别和语言信息
      const firstWithRerecog = ocrResults.find(r => r.rerecognize);
      if (firstWithRerecog?.rerecognize) {
        ocrRerecognize = firstWithRerecog.rerecognize;
      }
      const firstWithLang = ocrResults.find(r => r.language);
      if (firstWithLang?.language) {
        ocrLanguage = firstWithLang.language;
      }
    } catch (err) {
      console.warn('[Vision] OCR failed:', err);
    }
  }

  const result: VisionAnalysisResult = {
    description,
    ocrText: ocrText || undefined,
    ocrConfidence,
    ocrRerecognize,
    ocrLanguage,
    imagePaths,
  };

  // v2.20：写入缓存（单图时）
  // 注意：vision 模型调用失败时不写缓存，否则错误描述会被缓存，
  // 下次同样的图片+prompt 来时直接返回缓存的错误描述，永远不会重试
  if (images.length === 1 && visionCache && !visionFailed) {
    const cacheKey = visionCache.computeCacheKey(images[0] ?? '', prompt);
    visionCache.setVisionCache(cacheKey, result);
  }

  return result;
}

// ── v2.16：屏幕实时监控集成 ─────────────────────────────────────

/**
 * 开始屏幕监控（带自动 vision 分析）
 *
 * 当检测到画面变化超过阈值时，自动触发 vision 分析。
 * 分析结果通过回调返回，可推送到渲染层展示。
 *
 * v2.19：如果未传入 config，从 config.json 的 vision.monitor 读取持久化配置
 *
 * @param config 监控配置（未传则从配置文件读取）
 * @param onAnalysis 分析结果回调
 */
export function startScreenMonitor(
  config?: ScreenMonitor.MonitorConfig,
  onAnalysis?: (result: VisionAnalysisResult) => void,
): ScreenMonitor.MonitorState {
  // v2.19：未传入 config 时，从配置文件读取持久化配置
  if (!config) {
    const persisted = getConfig().vision?.monitor;
    if (persisted) {
      config = {
        intervalMs: persisted.intervalMs,
        threshold: persisted.threshold,
        cooldownMs: persisted.cooldownMs,
        windowFilter: persisted.windowFilter
          ? {
              mode: persisted.windowFilter.mode,
              rules: persisted.windowFilter.rules,
            }
          : undefined,
      };
      console.log('[Monitor] loaded persisted config from config.json');
    }
  }

  const cooldownMs = config?.cooldownMs ?? 5000;

  return ScreenMonitor.startMonitor(config, async (diffResult) => {
    const now = Date.now();
    const lastAnalyze = ScreenMonitor.getState().lastAnalyzeTime;

    // 冷却检查
    if (now - lastAnalyze < cooldownMs) {
      return;
    }

    try {
      // 触发 vision 分析
      const result = await processVisionRequest(
        [diffResult.base64],
        '请描述屏幕上的内容。',
      );

      // 更新内部状态的 lastAnalyzeTime（通过正式 API，直接赋值无法触及模块内部变量）
      ScreenMonitor.updateLastAnalyzeTime(now);

      // 调用回调
      if (onAnalysis) {
        onAnalysis(result);
      }

      console.log(`[Monitor] auto analysis triggered: ${result.description.slice(0, 50)}...`);
    } catch (err) {
      console.error('[Monitor] auto analysis failed:', err);
    }
  });
}

/**
 * 停止屏幕监控
 */
export function stopScreenMonitor(): ScreenMonitor.MonitorState {
  return ScreenMonitor.stopMonitor();
}

/**
 * 获取监控状态
 */
export function getScreenMonitorState(): ScreenMonitor.MonitorState {
  return ScreenMonitor.getState();
}

/**
 * 是否正在监控
 */
export function isScreenMonitoring(): boolean {
  return ScreenMonitor.isMonitoring();
}

/**
 * 清理监控截图文件
 */
export function cleanupMonitorFiles(keepCount?: number): void {
  ScreenMonitor.cleanupMonitorFiles(keepCount);
}
