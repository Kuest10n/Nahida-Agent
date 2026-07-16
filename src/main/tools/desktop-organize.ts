/**
 * 桌面整理工具集 —— v1.9.0
 *
 * 职责：
 *   主动扫描用户桌面，按文件类型分类统计，并提供一键整理能力。
 *   补完 L2 #6「主动桌面/文件整理」。
 *
 * 工具清单：
 *   - desktop_scan     : 扫描桌面文件，按类型分类统计
 *   - desktop_organize : 一键整理桌面（按类型分文件夹）
 *   - file_search      : 在用户目录搜索文件（按名称模糊匹配）
 *
 * 安全约束：
 *   - 只读/写用户桌面目录，不碰系统目录
 *   - 整理前可预览（dry-run），不直接动文件
 *   - file_search 限定根目录深度，防全盘扫描卡死
 */

import { z } from 'zod';
import { registerTools, type ToolDefinition, type ToolResult } from './registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── 路径常量 ──────────────────────────────────────────────────

/** 用户桌面目录 */
const DESKTOP_DIR = path.join(os.homedir(), 'Desktop');

/** 文件类型分类规则 */
const FILE_CATEGORY_RULES: Record<string, string[]> = {
  图片: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg', '.heic'],
  文档: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.rtf'],
  视频: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
  音频: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'],
  压缩包: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
  代码: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh', '.json', '.xml', '.yaml', '.yml'],
  安装包: ['.exe', '.msi', '.dmg', '.deb', '.rpm', '.app'],
  其他: [], // 兜底
};

/** 类别 → 目标子文件夹名 */
const CATEGORY_FOLDER_NAMES: Record<string, string> = {
  图片: '图片',
  文档: '文档',
  视频: '视频',
  音频: '音频',
  压缩包: '压缩包',
  代码: '代码',
  安装包: '安装包',
  其他: '其他',
};

// ── 工具函数 ──────────────────────────────────────────────────

/** 根据扩展名推断文件分类 */
function categorizeFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  for (const [category, exts] of Object.entries(FILE_CATEGORY_RULES)) {
    if (category === '其他') continue;
    if (exts.includes(ext)) return category;
  }
  return '其他';
}

/** 列出桌面上的文件（不递归，不包含目录） */
function listDesktopFiles(): { name: string; fullPath: string; ext: string; size: number; mtime: number }[] {
  if (!fs.existsSync(DESKTOP_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(DESKTOP_DIR, { withFileTypes: true });
  const files: { name: string; fullPath: string; ext: string; size: number; mtime: number }[] = [];

  for (const entry of entries) {
    // 跳过目录和隐藏文件（. 开头）
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(DESKTOP_DIR, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        fullPath,
        ext: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    } catch {
      // 跳过无法访问的文件
    }
  }

  return files;
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── 工具 1：desktop_scan ──────────────────────────────────────

const desktopScanTool: ToolDefinition = {
  name: 'desktop_scan',
  description: '扫描用户桌面文件，按类型分类统计。当用户问"桌面有什么""桌面太乱了吗"或需要主动整理建议时调用。',
  parameters: z.object({}).strict(),
  async execute(): Promise<ToolResult> {
    const startTime = Date.now();

    if (!fs.existsSync(DESKTOP_DIR)) {
      return {
        ok: false,
        data: { message: `桌面目录不存在：${DESKTOP_DIR}` },
        latencyMs: Date.now() - startTime,
      };
    }

    const files = listDesktopFiles();

    // 按分类聚合
    const byCategory: Record<string, { count: number; totalSize: number; samples: string[] }> = {};
    for (const file of files) {
      const category = categorizeFile(file.name);
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, totalSize: 0, samples: [] };
      }
      byCategory[category].count += 1;
      byCategory[category].totalSize += file.size;
      // 保留前 3 个样本
      if (byCategory[category].samples.length < 3) {
        byCategory[category].samples.push(file.name);
      }
    }

    // 整理建议：超过 10 个文件就建议整理
    const suggestion = files.length > 10
      ? `桌面有 ${files.length} 个文件，建议整理。可调用 desktop_organize 自动分类。`
      : `桌面有 ${files.length} 个文件，比较整洁。`;

    return {
      ok: true,
      data: {
        desktopPath: DESKTOP_DIR,
        totalFiles: files.length,
        totalSize: files.reduce((s, f) => s + f.size, 0),
        totalSizeStr: formatSize(files.reduce((s, f) => s + f.size, 0)),
        categories: Object.entries(byCategory).map(([cat, info]) => ({
          category: cat,
          count: info.count,
          totalSize: info.totalSize,
          totalSizeStr: formatSize(info.totalSize),
          samples: info.samples,
        })),
        suggestion,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 2：desktop_organize ──────────────────────────────────

const desktopOrganizeTool: ToolDefinition = {
  name: 'desktop_organize',
  description: '一键整理桌面文件，按类型分文件夹归档。当用户要求"整理桌面""分类桌面文件"时调用。',
  parameters: z.object({
    dry_run: z.boolean().optional().describe('是否仅预览不实际移动，默认 false（真整理）'),
    categories: z.array(z.string()).optional().describe('指定要整理的类别，默认全部（图片/文档/视频/音频/压缩包/代码/安装包/其他）'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const dryRun = (params.dry_run as boolean) ?? false;
    const allowedCategories = (params.categories as string[] | undefined) ?? Object.keys(CATEGORY_FOLDER_NAMES);

    const files = listDesktopFiles();
    if (files.length === 0) {
      return {
        ok: true,
        data: { message: '桌面没有需要整理的文件', moved: 0 },
        latencyMs: Date.now() - startTime,
      };
    }

    // 分组：category → file list
    const groups: Record<string, typeof files> = {};
    const moves: { from: string; to: string; category: string }[] = [];
    for (const file of files) {
      const category = categorizeFile(file.name);
      if (!allowedCategories.includes(category)) continue;
      if (!groups[category]) groups[category] = [];
      groups[category].push(file);

      const targetDir = path.join(DESKTOP_DIR, CATEGORY_FOLDER_NAMES[category] ?? '其他');
      const targetPath = path.join(targetDir, file.name);
      moves.push({ from: file.fullPath, to: targetPath, category });
    }

    if (dryRun) {
      return {
        ok: true,
        data: {
          dryRun: true,
          planned: moves.length,
          moves: moves.map(m => ({ from: path.basename(m.from), to: `${m.category}/${path.basename(m.to)}`, category: m.category })),
          message: `预览：将整理 ${moves.length} 个文件到 ${Object.keys(groups).length} 个文件夹`,
        },
        latencyMs: Date.now() - startTime,
      };
    }

    // 真整理：先建目录，再移动
    const createdDirs = new Set<string>();
    let movedCount = 0;
    const errors: { file: string; error: string }[] = [];

    for (const move of moves) {
      try {
        const targetDir = path.dirname(move.to);
        if (!createdDirs.has(targetDir)) {
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          createdDirs.add(targetDir);
        }

        // 目标文件已存在则跳过（防覆盖）
        if (fs.existsSync(move.to)) {
          // 加时间戳后缀
          const ext = path.extname(move.to);
          const base = path.basename(move.to, ext);
          const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const altPath = path.join(targetDir, `${base}_${ts}${ext}`);
          fs.renameSync(move.from, altPath);
        } else {
          fs.renameSync(move.from, move.to);
        }
        movedCount += 1;
      } catch (err) {
        errors.push({
          file: path.basename(move.from),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: errors.length === 0,
      data: {
        dryRun: false,
        totalFiles: files.length,
        moved: movedCount,
        errors,
        categoriesCreated: Array.from(createdDirs).map(d => path.basename(d)),
        message: errors.length === 0
          ? `已整理 ${movedCount}/${files.length} 个文件`
          : `整理完成 ${movedCount}/${files.length}，失败 ${errors.length} 个`,
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 工具 3：file_search ───────────────────────────────────────

const fileSearchTool: ToolDefinition = {
  name: 'file_search',
  description: '在指定目录搜索文件（按名称模糊匹配）。当用户要求"找文件""搜索某个文件"时调用。默认在用户目录搜索，最大深度 5 层。',
  parameters: z.object({
    keyword: z.string().min(1).max(200).describe('文件名关键词（不区分大小写）'),
    search_dir: z.string().optional().describe('搜索根目录，默认用户目录（os.homedir）'),
    max_depth: z.number().int().positive().max(10).optional().describe('最大递归深度，默认 5'),
    max_results: z.number().int().positive().max(100).optional().describe('最大返回结果数，默认 30'),
  }),
  async execute(params): Promise<ToolResult> {
    const startTime = Date.now();
    const keyword = (params.keyword as string).toLowerCase();
    const searchDir = (params.search_dir as string) ?? os.homedir();
    const maxDepth = (params.max_depth as number) ?? 5;
    const maxResults = (params.max_results as number) ?? 30;

    if (!fs.existsSync(searchDir)) {
      return {
        ok: false,
        data: { message: `目录不存在：${searchDir}` },
        latencyMs: Date.now() - startTime,
      };
    }

    const results: { path: string; name: string; size: number; mtime: number; ext: string }[] = [];
    let scanned = 0;
    const SCAN_LIMIT = 50000; // 防 IO 风暴

    function walk(dir: string, depth: number): void {
      if (depth > maxDepth) return;
      if (results.length >= maxResults) return;
      if (scanned >= SCAN_LIMIT) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // 无权限或被占用，跳过
      }

      for (const entry of entries) {
        if (scanned >= SCAN_LIMIT) return;
        scanned += 1;

        // 跳过隐藏文件/系统目录
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          // 跳过 node_modules / .git / __pycache__ 等噪音目录
          if (['node_modules', '__pycache__', 'dist', 'build', '.cache', 'AppData', 'Library'].includes(entry.name)) continue;
          walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          if (entry.name.toLowerCase().includes(keyword)) {
            try {
              const fullPath = path.join(dir, entry.name);
              const stat = fs.statSync(fullPath);
              results.push({
                path: fullPath,
                name: entry.name,
                size: stat.size,
                mtime: stat.mtimeMs,
                ext: path.extname(entry.name).toLowerCase(),
              });
              if (results.length >= maxResults) return;
            } catch {
              // 跳过无法访问的文件
            }
          }
        }
      }
    }

    walk(searchDir, 0);

    // 按修改时间倒序（最近修改的优先）
    results.sort((a, b) => b.mtime - a.mtime);

    return {
      ok: true,
      data: {
        keyword: params.keyword as string,
        searchDir,
        scanned,
        found: results.length,
        truncated: results.length >= maxResults,
        results: results.map(r => ({
          path: r.path,
          name: r.name,
          ext: r.ext,
          size: r.size,
          sizeStr: formatSize(r.size),
          mtime: r.mtime,
          mtimeStr: new Date(r.mtime).toLocaleString('zh-CN'),
        })),
      },
      latencyMs: Date.now() - startTime,
    };
  },
};

// ── 注册入口 ──────────────────────────────────────────────────

/**
 * 注册桌面整理工具
 *
 * 在主进程启动时调用。
 */
export function registerDesktopOrganizeTools(): void {
  registerTools([desktopScanTool, desktopOrganizeTool, fileSearchTool]);
  console.log('[Tools] desktop-organize tools registered: desktop_scan, desktop_organize, file_search');
}
