/**
 * 社区共享协议 —— .nahida-package 格式定义 —— v2.0.0
 *
 * 职责：
 *   定义社区共享包的标准格式，让人格分片、worldbook、模型配置
 *   可以打包成一个 .nahida-package 文件，在用户间流通。
 *
 * 包结构（zip 格式，扩展名 .nahida-package）：
 *   /
 *   ├── manifest.json          # 包元数据（必需）
 *   ├── SOHA.md                # 人格核心（persona 类型包必需）
 *   ├── persona.md             # 人格扩展
 *   ├── emotion.md             # 情绪状态
 *   ├── skill.md               # 技能描述
 *   ├── interest.md            # 兴趣爱好
 *   ├── User.md                # 用户模板（占位，不含真实用户数据）
 *   ├── worldbook/
 *   │   └── entries.jsonl      # 世界书条目
 *   ├── modelfile/
 *   │   └── Modelfile          # 模型配置（可选）
 *   └── README.md              # 包介绍
 *
 * 包类型：
 *   - persona  : 纯人格分片（SOHA + persona + emotion 等）
 *   - worldbook: 纯世界书条目
 *   - full     : 人格 + 世界书 + 模型配置（完整包）
 */

import { z } from 'zod';

// ── 格式版本 ──────────────────────────────────────────────────

export const PACKAGE_FORMAT_VERSION = '1.0';

// ── 包类型 ────────────────────────────────────────────────────

export const PackageTypeSchema = z.enum(['persona', 'worldbook', 'full']);
export type PackageType = z.infer<typeof PackageTypeSchema>;

// ── 包内容标记 ────────────────────────────────────────────────

export const PackageContentsSchema = z.object({
  persona: z.boolean().default(false).describe('是否包含人格分片'),
  worldbook: z.boolean().default(false).describe('是否包含世界书'),
  modelfile: z.boolean().default(false).describe('是否包含模型配置'),
});
export type PackageContents = z.infer<typeof PackageContentsSchema>;

// ── 兼容性 ────────────────────────────────────────────────────

export const CompatibilitySchema = z.object({
  minAppVersion: z.string().describe('最低兼容应用版本（语义化版本）'),
  maxAppVersion: z.string().optional().describe('最高兼容应用版本（不填则不限）'),
});
export type Compatibility = z.infer<typeof CompatibilitySchema>;

// ── Manifest（包元数据） ──────────────────────────────────────

export const PackageManifestSchema = z.object({
  formatVersion: z.string().describe('包格式版本，当前 1.0'),
  packageType: PackageTypeSchema.describe('包类型：persona / worldbook / full'),
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, '包名只能含小写字母、数字、连字符')
    .describe('包标识名（snake-case）'),
  displayName: z.string().min(1).max(64).describe('展示名（可含中文）'),
  description: z.string().max(500).describe('包描述'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '语义化版本号 x.y.z')
    .describe('包版本号'),
  author: z.string().min(1).max(64).describe('作者'),
  license: z.string().default('AGPL-3.0').describe('许可证'),
  homepage: z.string().url().optional().describe('主页 URL'),
  createdAt: z.number().int().positive().describe('创建时间戳（ms）'),
  contents: PackageContentsSchema,
  compatibility: CompatibilitySchema,
  tags: z.array(z.string().max(32)).max(10).default([]).describe('标签（最多 10 个）'),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// ── 包内文件清单 ──────────────────────────────────────────────

/** 人格分片文件列表（persona 类型包可能包含的文件） */
export const PERSONA_SHARD_FILES = [
  'SOHA.md',
  'persona.md',
  'emotion.md',
  'skill.md',
  'interest.md',
  'reflect.md',
  'User.md',
] as const;

/** 世界书目录名 */
export const WORLDBOOK_DIR = 'worldbook';

/** 模型配置目录名 */
export const MODELFILE_DIR = 'modelfile';

/** manifest 文件名 */
export const MANIFEST_FILE = 'manifest.json';

/** README 文件名 */
export const README_FILE = 'README.md';

// ── 校验工具 ──────────────────────────────────────────────────

/**
 * 校验 manifest 对象
 *
 * @returns 校验后的 manifest，或抛出 ZodError
 */
export function validateManifest(raw: unknown): PackageManifest {
  return PackageManifestSchema.parse(raw);
}

/**
 * 检查应用版本是否兼容
 *
 * @param appVersion 当前应用版本（如 '1.9.0'）
 * @param compat 包的兼容性声明
 * @returns 是否兼容
 */
export function isAppVersionCompatible(appVersion: string, compat: Compatibility): boolean {
  const appParts = appVersion.split('.').map(n => parseInt(n, 10));
  const minParts = compat.minAppVersion.split('.').map(n => parseInt(n, 10));

  // 比较 appVersion >= minAppVersion
  for (let i = 0; i < 3; i++) {
    const app = appParts[i] ?? 0;
    const min = minParts[i] ?? 0;
    if (app > min) break;
    if (app < min) return false;
  }

  // 如果有 maxAppVersion，检查 appVersion <= maxAppVersion
  if (compat.maxAppVersion) {
    const maxParts = compat.maxAppVersion.split('.').map(n => parseInt(n, 10));
    for (let i = 0; i < 3; i++) {
      const app = appParts[i] ?? 0;
      const max = maxParts[i] ?? 0;
      if (app < max) break;
      if (app > max) return false;
    }
  }

  return true;
}

/**
 * 根据包类型推断应包含的文件
 */
export function getExpectedFiles(manifest: PackageManifest): string[] {
  const files: string[] = [MANIFEST_FILE];

  if (manifest.contents.persona) {
    files.push(...PERSONA_SHARD_FILES);
  }

  if (manifest.contents.worldbook) {
    files.push(`${WORLDBOOK_DIR}/entries.jsonl`);
  }

  if (manifest.contents.modelfile) {
    files.push(`${MODELFILE_DIR}/Modelfile`);
  }

  return files;
}

// ── 安装结果 ──────────────────────────────────────────────────

export interface InstallResult {
  ok: boolean;
  manifest?: PackageManifest;
  installedFiles: string[];
  backedUpFiles: string[];
  backupDir?: string;
  errors: string[];
}

// ── 打包结果 ──────────────────────────────────────────────────

export interface BuildResult {
  ok: boolean;
  packagePath?: string;
  manifest?: PackageManifest;
  includedFiles: string[];
  totalSize: number;
  errors: string[];
}
