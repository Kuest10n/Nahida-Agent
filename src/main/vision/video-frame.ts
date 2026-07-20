/**
 * 视频帧抽取模块（v2.12.0 → v2.13.0）
 *
 * 让纳西妲"看视频"——上传视频后自动抽取关键帧，
 * 交给 vision 模型分析视频内容。
 *
 * 依赖设计：
 *   - 不内嵌 ffmpeg（体积太大，下载慢）
 *   - 自动检测系统 ffmpeg（PATH 中查找）
 *   - 没有则提示用户安装，并给出安装指引
 *
 * 抽帧策略（v2.13.0 智能抽帧）：
 *   - 先用 ffmpeg scene 滤镜检测场景切换点
 *   - 场景切换点 >= 目标帧数 → 均匀选取 N 个场景切换帧（strategy=scene）
 *   - 场景切换点 > 0 但不够 → 场景切换帧 + 均匀分布补充（strategy=mixed）
 *   - 无场景切换点 → 纯均匀分布，跳过片头片尾各 5%（strategy=uniform）
 *   - 场景检测有 15s 超时保护，超时自动 fallback 到均匀分布
 *
 * 帧数策略：
 *   - 默认抽取 6 帧
 *   - 视频很短（<10s）时抽 3 帧
 *   - 视频很长（>10min）时抽 10 帧
 *
 * 输出：PNG 帧图像 base64 列表 + 时间戳 + 抽帧策略
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── 类型 ────────────────────────────────────────────────────

export interface ExtractedFrame {
  /** 帧时间戳（秒） */
  timestamp: number;
  /** 帧图片路径（data/media/ 下相对路径） */
  imagePath: string;
  /** 帧图片 base64 */
  base64: string;
  /** 帧宽度（像素） */
  width: number;
  /** 帧高度（像素） */
  height: number;
}

export interface VideoInfo {
  /** 视频时长（秒） */
  duration: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 文件大小（字节） */
  fileSize: number;
  /** 编码格式 */
  codec?: string;
}

export interface VideoExtractResult {
  ok: boolean;
  /** 视频信息 */
  info?: VideoInfo;
  /** 抽取的帧列表 */
  frames?: ExtractedFrame[];
  /** 抽帧策略：scene（场景切换检测）/ uniform（均匀分布）/ mixed（混合） */
  strategy?: 'scene' | 'uniform' | 'mixed';
  /** 错误信息 */
  error?: string;
}

// ── 常量 ────────────────────────────────────────────────────

/** 帧存储目录（相对项目根） */
const FRAMES_DIR = path.resolve(process.cwd(), 'data', 'video-frames');

/** 支持的视频格式 */
const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm', '.flv', '.wmv', '.m4v']);

/** 默认抽帧数 */
const DEFAULT_FRAME_COUNT = 6;
/** 短视频帧数（<10s） */
const SHORT_VIDEO_FRAMES = 3;
/** 长视频帧数（>10min） */
const LONG_VIDEO_FRAMES = 10;

/** 跳过片头片尾比例 */
const SKIP_RATIO = 0.05;

/** 场景切换检测阈值（0-1，越小越敏感） */
const SCENE_THRESHOLD = 0.3;
/** 场景检测超时（ms）——防止长视频卡死 */
const SCENE_DETECT_TIMEOUT_MS = 15000;

// ── ffmpeg 检测 ─────────────────────────────────────────────

let ffmpegPathCache: string | null | undefined = undefined;
let ffprobePathCache: string | null | undefined = undefined;

/**
 * 检测系统是否安装了 ffmpeg
 *
 * 查找顺序：
 *   1. 环境变量 FFMPEG_PATH / FFPROBE_PATH（用户自定义）
 *   2. PATH 中查找 ffmpeg / ffprobe
 *   3. Windows 常见安装路径
 */
export function detectFFmpeg(): { ffmpeg: string | null; ffprobe: string | null } {
  if (ffmpegPathCache !== undefined) {
    return { ffmpeg: ffmpegPathCache, ffprobe: ffprobePathCache ?? null };
  }

  const findInPath = (cmd: string): string | null => {
    // 环境变量优先
    const envVar = process.env[cmd.toUpperCase().replace('-', '_') + '_PATH'];
    if (envVar && fs.existsSync(envVar)) {
      return envVar;
    }

    // Windows 常见路径
    if (process.platform === 'win32') {
      const commonPaths = [
        path.join('C:\\', 'Program Files', 'ffmpeg', 'bin', cmd + '.exe'),
        path.join('C:\\', 'ffmpeg', 'bin', cmd + '.exe'),
        path.join(os.homedir(), 'scoop', 'shims', cmd + '.exe'),
        path.join('C:\\', 'ProgramData', 'chocolatey', 'bin', cmd + '.exe'),
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
      }
    }

    // PATH 查找（用 where / which）
    const finder = process.platform === 'win32' ? 'where' : 'which';
    try {
      const result = require('node:child_process').execSync(`${finder} ${cmd}`, { encoding: 'utf8', stdio: 'pipe' });
      const lines = result.trim().split('\n');
      const firstLine = lines[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      // 没找到
    }

    return null;
  };

  ffmpegPathCache = findInPath('ffmpeg');
  ffprobePathCache = findInPath('ffprobe');
  return { ffmpeg: ffmpegPathCache, ffprobe: ffprobePathCache };
}

/** ffmpeg 是否可用 */
export function isFFmpegAvailable(): boolean {
  const { ffmpeg } = detectFFmpeg();
  return ffmpeg !== null;
}

// ── 视频信息获取 ─────────────────────────────────────────────

/**
 * 获取视频信息（用 ffprobe）
 *
 * ffprobe 不可用时 fallback 到纯文件信息（只有 fileSize）
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const stat = fs.statSync(videoPath);
  const ext = path.extname(videoPath).toLowerCase();

  const info: VideoInfo = {
    duration: 0,
    width: 0,
    height: 0,
    fileSize: stat.size,
  };

  const { ffprobe } = detectFFmpeg();
  if (!ffprobe) {
    return info;
  }

  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    let output = '';
    const proc = spawn(ffprobe, args);
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', () => { /* ignore */ });
    proc.on('close', () => {
      try {
        const data = JSON.parse(output);
        if (data.format) {
          info.duration = parseFloat(data.format.duration ?? '0') || 0;
          info.codec = data.format.format_name;
        }
        if (data.streams && Array.isArray(data.streams)) {
          const videoStream = data.streams.find((s: { codec_type?: string }) => s.codec_type === 'video');
          if (videoStream) {
            info.width = videoStream.width || 0;
            info.height = videoStream.height || 0;
          }
        }
      } catch {
        // JSON 解析失败，用默认值
      }
      resolve(info);
    });
    proc.on('error', () => {
      resolve(info);
    });
  });
}

// ── 场景切换检测（v2.13.0） ─────────────────────────────────

/**
 * 检测视频中的场景切换点
 *
 * 用 ffmpeg 的 scene 滤镜 + showinfo 解析时间戳。
 * select='gt(scene,THRESHOLD)' 只让 scene 值超过阈值的帧通过，
 * showinfo 输出这些帧的 pts_time 到 stderr。
 *
 * 设计：
 *   - -an 忽略音频流加速
 *   - -f null - 不输出文件，只跑滤镜
 *   - 超时保护防止长视频卡死
 *
 * @returns 场景切换时间戳列表（秒），按时间顺序。失败/超时返回空数组
 */
async function detectSceneCuts(
  ffmpegPath: string,
  videoPath: string,
  threshold: number = SCENE_THRESHOLD,
  timeoutMs: number = SCENE_DETECT_TIMEOUT_MS,
): Promise<number[]> {
  return new Promise((resolve) => {
    const args = [
      '-i', videoPath,
      '-vf', `select='gt(scene,${threshold})',showinfo`,
      '-an',
      '-f', 'null',
      '-',
    ];

    let stderr = '';
    const proc = spawn(ffmpegPath, args);

    const timer = setTimeout(() => {
      proc.kill();
      console.warn(`[Video] scene detection timeout (${timeoutMs}ms), falling back to uniform`);
      resolve([]);
    }, timeoutMs);

    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', () => {
      clearTimeout(timer);
      // 解析 showinfo 输出中的 pts_time
      const times: number[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(stderr)) !== null) {
        const t = parseFloat(match[1] ?? '0');
        if (!Number.isNaN(t) && t > 0) {
          times.push(parseFloat(t.toFixed(2)));
        }
      }
      // 去重（相邻帧 scene 值可能连续超阈值）
      const unique: number[] = [];
      for (const t of times) {
        if (unique.length === 0 || t - unique[unique.length - 1]! > 0.5) {
          unique.push(t);
        }
      }
      console.log(`[Video] scene detection: ${unique.length} cuts found (threshold=${threshold})`);
      resolve(unique);
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}

/**
 * 从一组时间戳中均匀选取 N 个
 *
 * @param source 候选时间戳（已排序）
 * @param count 要选取的数量
 */
function selectEvenly(source: number[], count: number): number[] {
  if (source.length <= count) return [...source];
  const result: number[] = [];
  const step = (source.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    result.push(source[idx]!);
  }
  return result;
}

/**
 * 生成均匀分布的时间戳（跳过片头片尾）
 */
function generateUniformTimes(duration: number, count: number, startSkip: number, endSkip: number): number[] {
  const effectiveDuration = Math.max(1, duration - startSkip - endSkip);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = startSkip + (effectiveDuration * i) / Math.max(1, count - 1);
    times.push(parseFloat(t.toFixed(2)));
  }
  return times;
}

// ── 帧抽取 ─────────────────────────────────────────────────

/**
 * 从视频中抽取帧
 *
 * @param videoPath 视频文件路径
 * @param frameCount 抽帧数（不传则按时长自动决定）
 * @returns 抽取结果
 */
export async function extractFrames(
  videoPath: string,
  frameCount?: number,
): Promise<VideoExtractResult> {
  // 1. 检查文件
  if (!fs.existsSync(videoPath)) {
    return { ok: false, error: '视频文件不存在' };
  }
  const ext = path.extname(videoPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `不支持的视频格式: ${ext}（支持: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}）` };
  }

  // 2. 检查 ffmpeg
  const { ffmpeg } = detectFFmpeg();
  if (!ffmpeg) {
    return {
      ok: false,
      error: '未检测到 ffmpeg。请先安装 ffmpeg 并添加到 PATH 中。\n' +
        'Windows 用户可使用 scoop install ffmpeg 或从 https://ffmpeg.org/download.html 下载。',
    };
  }

  // 3. 获取视频信息
  const info = await getVideoInfo(videoPath);

  // 4. 决定抽帧数
  let count = frameCount ?? DEFAULT_FRAME_COUNT;
  if (!frameCount) {
    if (info.duration > 0 && info.duration < 10) {
      count = SHORT_VIDEO_FRAMES;
    } else if (info.duration > 600) {
      count = LONG_VIDEO_FRAMES;
    }
  }

  // 5. 确保输出目录存在
  if (!fs.existsSync(FRAMES_DIR)) {
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
  }

  // 6. 智能抽帧：先检测场景切换，不足时用均匀分布补充（v2.13.0）
  const startSkip = info.duration > 0 ? info.duration * SKIP_RATIO : 0;
  const endSkip = info.duration > 0 ? info.duration * SKIP_RATIO : 0;

  let timestamps: number[] = [];
  let strategy: 'scene' | 'uniform' | 'mixed' = 'uniform';

  if (info.duration > 0) {
    // 检测场景切换点
    const sceneCuts = await detectSceneCuts(ffmpeg, videoPath);
    // 过滤掉片头片尾范围外的
    const validCuts = sceneCuts.filter(t => t >= startSkip && t <= info.duration - endSkip);

    if (validCuts.length >= count) {
      // 场景切换点足够，均匀选取 count 个
      timestamps = selectEvenly(validCuts, count);
      strategy = 'scene';
    } else if (validCuts.length > 0) {
      // 场景切换点不够，用均匀分布补充
      const uniformTimes = generateUniformTimes(info.duration, count - validCuts.length, startSkip, endSkip);
      // 合并、去重（避免场景切换点和均匀点太近）、排序
      const merged = [...validCuts];
      for (const t of uniformTimes) {
        const tooClose = merged.some(existing => Math.abs(existing - t) < 1.0);
        if (!tooClose) merged.push(t);
      }
      // 如果去重后数量不够，补均匀分布
      if (merged.length < count) {
        const extra = generateUniformTimes(info.duration, count - merged.length, startSkip, endSkip);
        merged.push(...extra);
      }
      timestamps = merged.sort((a, b) => a - b).slice(0, count);
      strategy = 'mixed';
    }

    // 没有场景切换点 → 纯均匀分布
    if (timestamps.length === 0) {
      timestamps = generateUniformTimes(info.duration, count, startSkip, endSkip);
      strategy = 'uniform';
    }
  } else {
    // 无时长信息，用 0 开始的均匀分布
    timestamps = Array.from({ length: count }, (_, i) => parseFloat((i * 2).toFixed(2)));
    strategy = 'uniform';
  }

  console.log(`[Video] frame strategy: ${strategy}, ${timestamps.length} timestamps: [${timestamps.join(', ')}]`);

  // 7. 逐帧抽取
  const frames: ExtractedFrame[] = [];
  const videoId = path.basename(videoPath, ext).slice(0, 20).replace(/[^\w\-]/g, '_');

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i] ?? 0;
    const frameResult = await extractSingleFrame(ffmpeg, videoPath, timestamp, videoId, i);
    if (frameResult) {
      frames.push(frameResult);
    }
  }

  if (frames.length === 0) {
    return { ok: false, error: '抽帧失败，没有成功抽取到任何帧' };
  }

  console.log(`[Video] extracted ${frames.length}/${count} frames from ${path.basename(videoPath)} (${info.duration.toFixed(1)}s, strategy=${strategy})`);

  return {
    ok: true,
    info,
    frames,
    strategy,
  };
}

/**
 * 抽取单帧
 *
 * ffmpeg 命令：
 *   ffmpeg -ss <timestamp> -i <input> -vframes 1 -f image2pipe -vcodec png -
 * （-ss 放在 -i 前面是快速定位，可能不够精确但快）
 */
async function extractSingleFrame(
  ffmpegPath: string,
  videoPath: string,
  timestamp: number,
  videoId: string,
  index: number,
): Promise<ExtractedFrame | null> {
  return new Promise((resolve) => {
    // 输出文件（存盘方便后续查看）
    const filename = `${videoId}_${index + 1}_${timestamp}s.png`;
    const outputPath = path.join(FRAMES_DIR, filename);
    const relativePath = `data/video-frames/${filename}`;

    const args = [
      '-ss', String(timestamp),
      '-i', videoPath,
      '-vframes', '1',
      '-y',
      outputPath,
    ];

    let stderrOut = '';
    const proc = spawn(ffmpegPath, args);
    proc.stderr.on('data', (data) => { stderrOut += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        try {
          const buf = fs.readFileSync(outputPath);
          const base64 = buf.toString('base64');
          // 从 PNG 头部读宽高
          const width = buf.readUInt32BE(16);
          const height = buf.readUInt32BE(20);
          resolve({
            timestamp,
            imagePath: relativePath,
            base64,
            width,
            height,
          });
        } catch {
          resolve(null);
        }
      } else {
        console.warn(`[Video] extract frame ${timestamp}s failed (exit code ${code}): ${stderrOut.slice(0, 200)}`);
        resolve(null);
      }
    });
    proc.on('error', () => {
      resolve(null);
    });
  });
}

// ── 工具函数 ───────────────────────────────────────────────

/** 支持的视频格式列表（字符串形式） */
export function getSupportedFormats(): string[] {
  return Array.from(SUPPORTED_EXTENSIONS);
}

/** 清理指定视频的帧文件（或所有过期帧） */
export function cleanupVideoFrames(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  if (!fs.existsSync(FRAMES_DIR)) return 0;

  let cleaned = 0;
  const now = Date.now();
  try {
    const files = fs.readdirSync(FRAMES_DIR);
    for (const file of files) {
      const filePath = path.join(FRAMES_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // 单个文件失败跳过
      }
    }
  } catch {
    // 目录操作失败返回 0
  }
  return cleaned;
}
