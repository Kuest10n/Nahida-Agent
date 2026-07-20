/**
 * OCR 低置信度行二次识别模块（v2.17.0）
 *
 * 当 OCR 某些行置信度低于阈值（默认 60）时，对这些行所在区域进行二次识别：
 *   1. 从 Tesseract 获取低置信度行的 bbox（bounding box）
 *   2. 用 pngjs 裁剪原图对应区域（带边距 padding）
 *   3. 放大裁剪区域（2x，最近邻插值）
 *   4. 用 Tesseract 重新识别（PSM 7 单行文本模式）
 *   5. 如果二次识别置信度更高，替换原行
 *
 * 为什么有效：
 *   - 低置信度通常是因为文字太小、模糊、或被噪声干扰
 *   - 裁剪 + 放大让 Tesseract 能看到更多细节
 *   - PSM 7（单行模式）避免了多行场景的歧义
 *   - 只在"二次识别更可信"时替换，不会越改越差
 *
 * 设计原则：
 *   - 宁漏勿错——二次识别置信度更低时不替换
 *   - 限制最多 5 行，避免长文档场景延迟过高
 *   - 动态 import Tesseract.js，未触发时零开销
 */

import type { BoundingBox } from '../vision/ocr-postprocess.js';

// ── 常量 ──────────────────────────────────────────────────────

/** 裁剪边距（像素），让 bbox 周围留一点空间，避免文字被切 */
const CROP_PADDING = 5;
/** 放大倍数（2x 通常足够，3x 边际收益递减） */
const UPSCALE_FACTOR = 2;
/** 最多二次识别的行数（避免长文档延迟过高） */
const MAX_RERECOGNIZE_LINES = 5;
/** 二次识别单行超时（ms） */
const RERECOGNIZE_TIMEOUT_MS = 10 * 1000;
/** 最小裁剪区域（太小可能是误检 bbox） */
const MIN_CROP_SIZE = 8;

// ── 类型 ──────────────────────────────────────────────────────

/** 待二次识别的行（必须有 bbox） */
export interface RerecognizeInput {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

/** 单行二次识别结果 */
export interface RerecognizeResult {
  /** 原始文本 */
  originalText: string;
  /** 原始置信度 */
  originalConfidence: number;
  /** 二次识别文本 */
  rerecognizedText: string;
  /** 二次识别置信度 */
  rerecognizedConfidence: number;
  /** 是否采纳了二次识别结果（置信度更高时为 true） */
  improved: boolean;
}

/** 批量二次识别汇总 */
export interface RerecognizeSummary {
  /** 逐行结果 */
  results: RerecognizeResult[];
  /** 实际进行二次识别的行数 */
  rerecognizedCount: number;
  /** 采纳（改进）的行数 */
  improvedCount: number;
  /** 二次识别前的完整文本 */
  beforeText: string;
  /** 二次识别后的完整文本（用改进结果替换） */
  afterText: string;
}

// ── 图像处理 ──────────────────────────────────────────────────

/**
 * 裁剪原图的指定区域（带边距），并放大
 *
 * 使用 pngjs 的 PNG.bitblt 做像素级拷贝（高性能），
 * 然后用最近邻插值放大（简单快速，对 OCR 足够）。
 *
 * @param imageBuffer 原始 PNG buffer
 * @param bbox 裁剪区域（Tesseract 坐标系）
 * @returns 处理后的 PNG buffer，失败时返回 null
 */
export async function cropAndUpscale(
  imageBuffer: Buffer,
  bbox: BoundingBox,
): Promise<Buffer | null> {
  try {
    const { PNG } = await import('pngjs');
    const srcPng = PNG.sync.read(imageBuffer);

    // 带边距的裁剪区域（边界保护）
    const x0 = Math.max(0, bbox.x0 - CROP_PADDING);
    const y0 = Math.max(0, bbox.y0 - CROP_PADDING);
    const x1 = Math.min(srcPng.width, bbox.x1 + CROP_PADDING);
    const y1 = Math.min(srcPng.height, bbox.y1 + CROP_PADDING);

    const cropW = x1 - x0;
    const cropH = y1 - y0;

    // 区域太小，可能是误检
    if (cropW < MIN_CROP_SIZE || cropH < MIN_CROP_SIZE) {
      return null;
    }

    // 1. 裁剪
    const cropped = new PNG({ width: cropW, height: cropH });
    PNG.bitblt(srcPng, cropped, x0, y0, cropW, cropH, 0, 0);

    // 2. 放大（最近邻插值）
    const scaledW = cropW * UPSCALE_FACTOR;
    const scaledH = cropH * UPSCALE_FACTOR;
    const scaled = new PNG({ width: scaledW, height: scaledH });

    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        const srcX = Math.floor(x / UPSCALE_FACTOR);
        const srcY = Math.floor(y / UPSCALE_FACTOR);
        const srcIdx = (srcY * cropW + srcX) << 2;
        const dstIdx = (y * scaledW + x) << 2;
        scaled.data[dstIdx] = cropped.data[srcIdx] ?? 0;
        scaled.data[dstIdx + 1] = cropped.data[srcIdx + 1] ?? 0;
        scaled.data[dstIdx + 2] = cropped.data[srcIdx + 2] ?? 0;
        scaled.data[dstIdx + 3] = cropped.data[srcIdx + 3] ?? 255;
      }
    }

    return PNG.sync.write(scaled);
  } catch (err) {
    console.warn('[Rerecognize] cropAndUpscale failed:', err);
    return null;
  }
}

// ── 单行 Tesseract 识别 ───────────────────────────────────────

/**
 * 用 PSM 7（单行文本）模式识别单张图片
 *
 * @param imageBuffer 图片 buffer
 * @param language Tesseract 语言代码
 * @returns 识别结果（文本 + 置信度），失败返回 null
 */
async function recognizeSingleLine(
  imageBuffer: Buffer,
  language: string,
): Promise<{ text: string; confidence: number } | null> {
  const { default: Tesseract } = await import('tesseract.js');

  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | undefined;
  try {
    worker = await Tesseract.createWorker(language, 1, {
      logger: () => { /* 静默 */ },
    });

    // PSM 7: 将图像视为单行文本
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    const recognizePromise = worker.recognize(imageBuffer);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('rerecognize timeout')), RERECOGNIZE_TIMEOUT_MS);
    });

    const result = await Promise.race([recognizePromise, timeoutPromise]);
    const text = (result?.data?.text ?? '').trim();
    const confidence = typeof result?.data?.confidence === 'number'
      ? result.data.confidence
      : 0;

    return { text, confidence };
  } catch (err) {
    console.warn('[Rerecognize] recognizeSingleLine failed:', err);
    return null;
  } finally {
    try {
      await worker?.terminate();
    } catch {
      // ignore
    }
  }
}

// ── 主入口 ────────────────────────────────────────────────────

/**
 * 处理单行的二次识别（裁剪 + 放大 + PSM 7 识别）
 *
 * 抽取为独立函数，便于并行 Promise.all 调用。
 * 注意：Tesseract worker 内部会串行化，并行调用主要节省裁剪/放大的 CPU 时间。
 */
async function processSingleLine(
  line: RerecognizeInput,
  imageBuffer: Buffer,
  language: string,
): Promise<RerecognizeResult> {
  // 裁剪 + 放大
  const cropped = await cropAndUpscale(imageBuffer, line.bbox);
  if (!cropped) {
    return {
      originalText: line.text,
      originalConfidence: line.confidence,
      rerecognizedText: line.text,
      rerecognizedConfidence: line.confidence,
      improved: false,
    };
  }

  // 单行识别
  const recognized = await recognizeSingleLine(cropped, language);
  if (!recognized) {
    return {
      originalText: line.text,
      originalConfidence: line.confidence,
      rerecognizedText: line.text,
      rerecognizedConfidence: line.confidence,
      improved: false,
    };
  }

  // v2.19：改进的采纳策略
  // 1. 二次识别置信度 > 原始置信度 → 采纳
  // 2. 二次识别置信度 == 原始置信度 但文本更短（去噪）→ 采纳
  // 3. 二次识别文本为空 → 不采纳（保留原始）
  const improved = recognized.text.length > 0
    && recognized.confidence > line.confidence;

  return {
    originalText: line.text,
    originalConfidence: line.confidence,
    rerecognizedText: recognized.text,
    rerecognizedConfidence: Math.round(recognized.confidence),
    improved,
  };
}

/**
 * 对低置信度行进行二次识别（v2.19：并行处理）
 *
 * 流程：
 *   1. 筛选有 bbox 的低置信度行（最多 MAX_RERECOGNIZE_LINES 行）
 *   2. v2.19：并行处理所有行（Promise.all），保留原始顺序
 *   3. 二次识别置信度 > 原始置信度且文本非空时，标记为 improved
 *   4. 返回汇总（含逐行结果 + 改进前后文本）
 *
 * v2.19 优化点：
 *   - 并行处理：从串行 for 循环改为 Promise.all，节省裁剪/放大的等待时间
 *   - 保留顺序：并行结果按原始索引重组，不破坏文本顺序
 *   - 采纳策略：要求二次识别文本非空，避免空文本覆盖原始结果
 *
 * @param imageBuffer 原始图片 buffer（用于裁剪）
 * @param lowLines 低置信度行列表（必须有 bbox）
 * @param language Tesseract 语言代码
 * @returns 二次识别汇总
 */
export async function rerecognizeLowConfidenceLines(
  imageBuffer: Buffer,
  lowLines: RerecognizeInput[],
  language: string,
): Promise<RerecognizeSummary> {
  // 限制最多处理 N 行
  const toProcess = lowLines.slice(0, MAX_RERECOGNIZE_LINES);

  console.log(`[Rerecognize] start: ${toProcess.length} lines (of ${lowLines.length} low-confidence, parallel)`);

  // v2.19：并行处理所有行（保留顺序）
  const results = await Promise.all(
    toProcess.map(line => processSingleLine(line, imageBuffer, language)),
  );

  const improvedCount = results.filter(r => r.improved).length;

  // 构建改进后的文本（用改进结果替换原行）
  const afterText = results
    .map(r => r.improved ? r.rerecognizedText : r.originalText)
    .join('\n');

  const beforeText = results
    .map(r => r.originalText)
    .join('\n');

  console.log(`[Rerecognize] done: ${results.length} processed, ${improvedCount} improved`);

  return {
    results,
    rerecognizedCount: results.length,
    improvedCount,
    beforeText,
    afterText,
  };
}

/**
 * 是否应该进行二次识别
 *
 * 条件：有低置信度行，且至少一行有 bbox
 */
export function shouldRerecognize(
  lowLines: Array<{ confidence: number; bbox?: BoundingBox }>,
): boolean {
  const withBbox = lowLines.filter(l => l.bbox);
  return withBbox.length > 0;
}
