/**
 * 屏幕截图模块（v2.8.0 视觉感知深度）
 *
 * 职责：
 *   1. 调用 Electron desktopCapturer 截取屏幕
 *   2. 支持单屏 / 多屏 / 指定区域三种模式
 *   3. 截图临时存 data/screenshots/（不污染 media/）
 *   4. 返回 base64 + 路径，供 vision-manager 分析
 *
 * 隐私设计：
 *   - 截图是本地操作，不上传任何远程服务
 *   - 截图默认存 data/screenshots/，30 分钟自动清理（防堆积）
 *   - 截图操作会记录到日志（用户可审计）
 *
 * 性能：
 *   - desktopCapturer 是 Electron 内置 API，无额外依赖
 *   - thumbnailSize 限制为 1920x1080，避免过大占用内存
 *   - 截图异步执行，不阻塞主进程
 */

import { desktopCapturer, screen } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { processVisionRequest } from './vision-manager';

// ── 常量 ──────────────────────────────────────────────────────

/** 截图存储目录（相对项目根） */
const SCREENSHOTS_DIR = path.resolve(process.cwd(), 'data', 'screenshots');

/** 截图最大边长（超过则由 desktopCapturer 自动缩放） */
const MAX_SCREENSHOT_SIZE = 1920;

/** 截图文件保留时间（ms），超过自动清理 */
const SCREENSHOT_TTL_MS = 30 * 60 * 1000; // 30 分钟

// ── 类型 ──────────────────────────────────────────────────────

export interface ScreenshotResult {
  ok: boolean;
  /** 截图存储路径（data/screenshots/xxx.png） */
  path?: string;
  /** base64 编码（不含 data:image/ 前缀） */
  base64?: string;
  /** 屏幕宽度 */
  width?: number;
  /** 屏幕高度 */
  height?: number;
  /** 显示器 ID */
  displayId?: string;
  /** 显示器名称（如 "Primary Monitor"） */
  displayLabel?: string;
  /** 错误信息 */
  error?: string;
}

export interface ScreenshotOptions {
  /** 指定显示器 ID（不指定则截主屏） */
  displayId?: string;
  /** 截图区域（相对显示器坐标，不指定则截全屏） */
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ── 模块状态 ──────────────────────────────────────────────────

/** 是否已初始化（目录存在） */
let initialized = false;

// ── 初始化 ────────────────────────────────────────────────────

/** 确保截图目录存在 */
function ensureScreenshotsDir(): void {
  if (initialized) return;
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  initialized = true;
}

/**
 * 清理过期截图（30 分钟前的）
 *
 * 在每次截图前调用，顺便清理。
 */
function cleanupExpiredScreenshots(): void {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) return;
    const now = Date.now();
    const files = fs.readdirSync(SCREENSHOTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.png')) continue;
      const filePath = path.join(SCREENSHOTS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > SCREENSHOT_TTL_MS) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 单个文件清理失败跳过
      }
    }
  } catch {
    // 清理失败不影响截图主流程
  }
}

// ── 核心功能 ──────────────────────────────────────────────────

/**
 * 获取所有显示器信息
 *
 * 用于 /screenshot list 命令，列出可截的屏幕。
 */
export function listDisplays(): Array<{ id: string; label: string; bounds: { x: number; y: number; width: number; height: number } }> {
  const displays = screen.getAllDisplays();
  return displays.map((d, i) => ({
    id: String(d.id),
    label: displays.length === 1 ? 'Primary Monitor' : `Monitor ${i + 1}${d.internal ? ' (Built-in)' : ''}`,
    bounds: {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
    },
  }));
}

/**
 * 截取屏幕
 *
 * @param options 截图选项（displayId / region）
 * @returns 截图结果（含 base64 和路径）
 *
 * 流程：
 *   1. 调用 desktopCapturer.getSources 获取屏幕缩略图
 *   2. 找到目标显示器（按 displayId 或默认主屏）
 *   3. 缩略图.toPNG() → 写入 data/screenshots/
 *   4. 返回 base64 + 路径
 *
 * 注意：desktopCapturer 必须在 app.ready 之后调用。
 */
export async function captureScreen(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  try {
    ensureScreenshotsDir();
    cleanupExpiredScreenshots();

    // 获取所有屏幕源
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: MAX_SCREENSHOT_SIZE,
        height: MAX_SCREENSHOT_SIZE,
      },
      fetchWindowIcons: false,
    });

    if (sources.length === 0) {
      return { ok: false, error: '没有可用的屏幕源（可能在远程桌面或无头环境）' };
    }

    // 选择目标屏幕
    let targetSource = sources[0];
    if (options.displayId) {
      const found = sources.find(s => s.display_id === options.displayId);
      if (!found) {
        return { ok: false, error: `找不到显示器: ${options.displayId}` };
      }
      targetSource = found;
    }
    // display_id 为空字符串时 fallback 到第一个源
    if (!targetSource || !targetSource.thumbnail) {
      return { ok: false, error: '屏幕源无缩略图' };
    }

    // 获取显示器的实际尺寸（用于记录，非截图像素尺寸）
    const displays = screen.getAllDisplays();
    const targetDisplay = options.displayId
      ? displays.find(d => String(d.id) === options.displayId)
      : displays.find(d => d.bounds.x === 0 && d.bounds.y === 0) ?? displays[0];

    // 转 PNG buffer
    const pngBuffer = targetSource.thumbnail.toPNG();
    const base64 = pngBuffer.toString('base64');

    // 生成文件名
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const filename = `${ts}_${rand}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    const relativePath = `data/screenshots/${filename}`;

    // 写入文件
    fs.writeFileSync(filePath, pngBuffer);

    // 获取缩略图尺寸（thumbnail.getSize 在新版 Electron 可能不存在，用 PNG 头部读）
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);

    console.log(`[Screenshot] captured: ${relativePath} (${width}x${height})`);

    return {
      ok: true,
      path: relativePath,
      base64,
      width,
      height,
      displayId: options.displayId ?? targetSource.display_id,
      displayLabel: targetSource.name,
    };
  } catch (err) {
    console.error('[Screenshot] captureScreen failed:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * 截取所有显示器
 *
 * 用于多显示器场景，每屏一张图。
 */
export async function captureAllDisplays(): Promise<ScreenshotResult[]> {
  const displays = screen.getAllDisplays();
  const results: ScreenshotResult[] = [];

  for (const display of displays) {
    const result = await captureScreen({ displayId: String(display.id) });
    results.push(result);
  }

  return results;
}

/**
 * 区域截图：截全屏后按 region 裁剪（v2.9.0）
 *
 * 流程：
 *   1. 调用 captureScreen 截全屏
 *   2. 用 pngjs 解码 PNG → 按 region 裁剪像素 → 重新编码
 *   3. 返回裁剪后的 base64 + 路径
 *
 * @param region 裁剪区域（x, y, width, height，相对屏幕坐标）
 * @param displayId 指定显示器（多屏场景），不指定则主屏
 *
 * 注意：region 坐标基于屏幕物理像素，与 desktopCapturer 返回的缩略图一致。
 */
export async function captureRegion(
  region: { x: number; y: number; width: number; height: number },
  displayId?: string,
): Promise<ScreenshotResult> {
  // 1. 先截全屏
  const fullShot = await captureScreen({ displayId });
  if (!fullShot.ok || !fullShot.base64) {
    return fullShot;
  }

  // 2. 边界保护
  const safeRegion = {
    x: Math.max(0, Math.floor(region.x)),
    y: Math.max(0, Math.floor(region.y)),
    width: Math.max(1, Math.floor(region.width)),
    height: Math.max(1, Math.floor(region.height)),
  };

  try {
    // 3. 动态 import pngjs 裁剪
    const { PNG } = await import('pngjs');
    const fullBuffer = Buffer.from(fullShot.base64, 'base64');
    const png = PNG.sync.read(fullBuffer);

    // 越界保护
    const maxWidth = png.width - safeRegion.x;
    const maxHeight = png.height - safeRegion.y;
    if (maxWidth <= 0 || maxHeight <= 0) {
      return { ok: false, error: `region 越界: region=${JSON.stringify(safeRegion)}, image=${png.width}x${png.height}` };
    }
    const cropW = Math.min(safeRegion.width, maxWidth);
    const cropH = Math.min(safeRegion.height, maxHeight);

    // 4. 创建裁剪后的 PNG
    const cropped = new PNG({ width: cropW, height: cropH });
    PNG.bitblt(png, cropped, safeRegion.x, safeRegion.y, cropW, cropH, 0, 0);

    // 5. 编码回 PNG buffer
    const croppedBuffer = PNG.sync.write(cropped);
    const croppedBase64 = croppedBuffer.toString('base64');

    // 6. 写入文件
    ensureScreenshotsDir();
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const filename = `${ts}_${rand}_region.png`;
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    const relativePath = `data/screenshots/${filename}`;
    fs.writeFileSync(filePath, croppedBuffer);

    console.log(`[Screenshot] region captured: ${relativePath} (${cropW}x${cropH} from ${safeRegion.x},${safeRegion.y})`);

    return {
      ok: true,
      path: relativePath,
      base64: croppedBase64,
      width: cropW,
      height: cropH,
      displayId: fullShot.displayId,
      displayLabel: fullShot.displayLabel,
    };
  } catch (err) {
    console.error('[Screenshot] captureRegion crop failed:', err);
    return { ok: false, error: `裁剪失败: ${String(err)}` };
  }
}

/**
 * 截取屏幕并直接交给 vision 模型分析
 *
 * 这是 /screenshot 命令的核心流程：截屏 → vision 分析 → 返回描述。
 *
 * @param prompt 用户指令（如"屏幕上这个报错什么意思？"）
 * @param onDelta 流式回调（透传给 vision-manager）
 * @returns vision 分析结果
 */
export async function captureAndAnalyze(
  prompt: string,
  onDelta?: (delta: string, done: boolean) => void,
): Promise<{ screenshot: ScreenshotResult; description: string; ocrText?: string }> {
  // 1. 截屏（默认主屏）
  const screenshot = await captureScreen();
  if (!screenshot.ok || !screenshot.base64) {
    return {
      screenshot,
      description: `（花冠微垂）……我没能看清屏幕，${screenshot.error ?? '未知错误'}`,
    };
  }

  // 2. 调用 vision 流程
  const visionResult = await processVisionRequest([screenshot.base64], prompt, onDelta);

  return {
    screenshot,
    description: visionResult.description,
    ocrText: visionResult.ocrText,
  };
}

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 格式化显示器列表（用于 /screenshot list 命令输出）
 */
export function formatDisplayList(): string {
  const displays = listDisplays();
  if (displays.length === 0) {
    return '（虚空屏暗了一瞬）……没有检测到可用的显示器。';
  }
  const lines = displays.map(d => `  · ${d.label}（id: ${d.id}，${d.bounds.width}×${d.bounds.height}）`);
  return `（指尖轻点虚空屏）……检测到 ${displays.length} 个显示器：\n${lines.join('\n')}`;
}
