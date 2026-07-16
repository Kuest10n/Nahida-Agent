/**
 * 社区共享包安装器 —— v2.0.0
 *
 * 职责：
 *   读取 .nahida-package 目录 → 校验 manifest → 备份现有 memory/ →
 *   将包内分片/worldbook 复制到 memory/ 对应位置。
 *
 * 安全约束：
 *   - 安装前强制备份现有文件到 memory/backup/{timestamp}/
 *   - 拒绝覆盖 User.md（用户私密数据，包内只是模板）
 *   - 拒绝覆盖 fact-*.md（运行时记忆）
 *   - 路径白名单：包内文件路径不得含 .. 或绝对路径
 *   - 兼容性检查：appVersion 必须落在 [minAppVersion, maxAppVersion] 区间
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PACKAGE_FORMAT_VERSION,
  PERSONA_SHARD_FILES,
  WORLDBOOK_DIR,
  MANIFEST_FILE,
  validateManifest,
  isAppVersionCompatible,
  getExpectedFiles,
  type PackageManifest,
  type InstallResult,
} from './package-format';

// ── 常量 ──────────────────────────────────────────────────────

const MEMORY_DIR = path.resolve(process.cwd(), 'memory');
const BACKUP_DIR = path.join(MEMORY_DIR, 'backup');

/** 应用当前版本（从 package.json 读取，失败则回退到硬编码） */
function getAppVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '2.0.0';
  } catch {
    return '2.0.0';
  }
}

/** 拒绝被覆盖的文件名（用户私密或运行时数据） */
const PROTECTED_FILES = new Set([
  'User.md',
  'fact-long.md',
  'fact-mid.md',
  'fact-short.json',
  'emotion.md', // 情绪状态是运行时数据，不覆盖
  'reflect.md', // 反思由 AI 自动维护，不覆盖
]);

// ── 安装选项 ──────────────────────────────────────────────────

export interface InstallOptions {
  /**
   * .nahida-package 目录的绝对路径
   * 或 packages/ 下的子目录名
   */
  packagePath: string;
  /**
   * 是否跳过兼容性检查（调试用）
   */
  skipCompatCheck?: boolean;
  /**
   * 是否跳过备份（危险，默认 false）
   */
  skipBackup?: boolean;
}

// ── 核心安装流程 ──────────────────────────────────────────────

/**
 * 安装一个 .nahida-package
 *
 * 步骤：
 *   1. 读取并校验 manifest
 *   2. 兼容性检查
 *   3. 备份现有 memory/ 文件
 *   4. 复制包内文件到 memory/
 *   5. 返回 InstallResult
 */
export function installPackage(options: InstallOptions): InstallResult {
  const result: InstallResult = {
    ok: false,
    installedFiles: [],
    backedUpFiles: [],
    errors: [],
  };

  // 1. 解析包路径
  const packageDir = resolvePackageDir(options.packagePath);
  if (!packageDir || !fs.existsSync(packageDir)) {
    result.errors.push(`包目录不存在: ${options.packagePath}`);
    return result;
  }

  // 2. 读取 manifest
  const manifestPath = path.join(packageDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    result.errors.push(`manifest.json 不存在于: ${packageDir}`);
    return result;
  }

  let manifest: PackageManifest;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest = validateManifest(raw);
  } catch (err) {
    result.errors.push(`manifest 校验失败: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  result.manifest = manifest;

  // 3. 格式版本检查
  if (manifest.formatVersion !== PACKAGE_FORMAT_VERSION) {
    result.errors.push(
      `格式版本不兼容：包为 ${manifest.formatVersion}，当前应用支持 ${PACKAGE_FORMAT_VERSION}`,
    );
    return result;
  }

  // 4. 兼容性检查
  if (!options.skipCompatCheck) {
    const appVersion = getAppVersion();
    if (!isAppVersionCompatible(appVersion, manifest.compatibility)) {
      result.errors.push(
        `应用版本不兼容：当前 ${appVersion}，要求 [${manifest.compatibility.minAppVersion}, ${manifest.compatibility.maxAppVersion ?? '∞'}]`,
      );
      return result;
    }
  }

  // 5. 备份现有文件
  if (!options.skipBackup) {
    const backupResult = backupExistingFiles(manifest);
    result.backedUpFiles = backupResult.backedUp;
    result.backupDir = backupResult.backupDir;
    if (backupResult.errors.length > 0) {
      result.errors.push(...backupResult.errors);
      return result;
    }
  }

  // 6. 安装包内文件
  const installErrors = installFiles(packageDir, manifest, result.installedFiles);
  if (installErrors.length > 0) {
    result.errors.push(...installErrors);
    // 安装失败时不回滚备份，让用户手动恢复
    return result;
  }

  result.ok = true;
  return result;
}

// ── 包路径解析 ────────────────────────────────────────────────

/**
 * 解析包路径：
 *   - 绝对路径直接用
 *   - 相对路径视为 packages/ 下的子目录
 */
function resolvePackageDir(input: string): string | null {
  // 防路径遍历
  if (input.includes('..')) {
    return null;
  }

  if (path.isAbsolute(input)) {
    return input;
  }

  // 相对路径：尝试 packages/{input}
  const packagesDir = path.resolve(process.cwd(), 'packages');
  const candidate = path.join(packagesDir, input);
  return candidate;
}

// ── 备份逻辑 ──────────────────────────────────────────────────

interface BackupResult {
  backedUp: string[];
  backupDir: string;
  errors: string[];
}

/**
 * 备份现有 memory/ 中即将被覆盖的文件
 *
 * 备份位置：memory/backup/{timestamp}_{packageName}/
 */
function backupExistingFiles(manifest: PackageManifest): BackupResult {
  const result: BackupResult = {
    backedUp: [],
    backupDir: '',
    errors: [],
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${timestamp}_${manifest.name}`;
  const backupDir = path.join(BACKUP_DIR, backupName);

  // 收集需要备份的文件
  const filesToBackup: string[] = [];
  if (manifest.contents.persona) {
    for (const shardFile of PERSONA_SHARD_FILES) {
      if (!PROTECTED_FILES.has(shardFile)) {
        filesToBackup.push(shardFile);
      }
    }
  }
  if (manifest.contents.worldbook) {
    filesToBackup.push(`${WORLDBOOK_DIR}/entries.jsonl`);
  }

  if (filesToBackup.length === 0) {
    result.backupDir = backupDir;
    return result;
  }

  // 创建备份目录
  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch (err) {
    result.errors.push(`创建备份目录失败: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  result.backupDir = backupDir;

  // 复制文件
  for (const relPath of filesToBackup) {
    const srcPath = path.join(MEMORY_DIR, relPath);
    if (!fs.existsSync(srcPath)) {
      continue; // 不存在的文件跳过
    }

    const destPath = path.join(backupDir, relPath);
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      result.backedUp.push(relPath);
    } catch (err) {
      result.errors.push(
        `备份 ${relPath} 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ── 文件安装 ──────────────────────────────────────────────────

/**
 * 将包内文件复制到 memory/ 对应位置
 *
 * @returns 错误列表（空数组表示全部成功）
 */
function installFiles(
  packageDir: string,
  manifest: PackageManifest,
  installedFiles: string[],
): string[] {
  const errors: string[] = [];

  // 检查包内文件清单是否完整
  const expectedFiles = getExpectedFiles(manifest);
  for (const expected of expectedFiles) {
    const expectedPath = path.join(packageDir, expected);
    if (!fs.existsSync(expectedPath)) {
      // README.md 不强制（虽然 builder 总会生成）
      if (expected === 'README.md') continue;
      errors.push(`包内缺少必需文件: ${expected}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  // 安装人格分片
  if (manifest.contents.persona) {
    for (const shardFile of PERSONA_SHARD_FILES) {
      const srcPath = path.join(packageDir, shardFile);

      // User.md / fact-*.md / emotion.md / reflect.md 不覆盖（保护用户数据）
      if (PROTECTED_FILES.has(shardFile)) {
        // 只在 memory/ 中不存在时复制（首次安装）
        const destPath = path.join(MEMORY_DIR, shardFile);
        if (!fs.existsSync(destPath) && fs.existsSync(srcPath)) {
          try {
            fs.copyFileSync(srcPath, destPath);
            installedFiles.push(shardFile);
          } catch (err) {
            errors.push(`安装 ${shardFile} 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        continue;
      }

      if (!fs.existsSync(srcPath)) {
        continue; // 包内无此分片则跳过
      }

      const destPath = path.join(MEMORY_DIR, shardFile);
      try {
        fs.copyFileSync(srcPath, destPath);
        installedFiles.push(shardFile);
      } catch (err) {
        errors.push(`安装 ${shardFile} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 安装 worldbook
  if (manifest.contents.worldbook) {
    const srcDir = path.join(packageDir, WORLDBOOK_DIR);
    const destDir = path.join(MEMORY_DIR, WORLDBOOK_DIR);

    if (fs.existsSync(srcDir)) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        const entries = fs.readdirSync(srcDir);
        for (const entry of entries) {
          const srcPath = path.join(srcDir, entry);
          if (!fs.statSync(srcPath).isFile()) continue;

          // 防路径遍历：文件名不得含路径分隔符或 ..
          if (entry.includes('/') || entry.includes('\\') || entry.includes('..')) {
            errors.push(`worldbook 内非法文件名: ${entry}`);
            continue;
          }

          const destPath = path.join(destDir, entry);
          fs.copyFileSync(srcPath, destPath);
          installedFiles.push(`${WORLDBOOK_DIR}/${entry}`);
        }
      } catch (err) {
        errors.push(
          `安装 worldbook 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return errors;
}

// ── 列举已安装的包 ────────────────────────────────────────────

export interface InstalledPackageInfo {
  name: string;
  displayName: string;
  version: string;
  packageType: string;
  installedAt: number;
  manifest: PackageManifest;
}

/**
 * 列举 packages/ 目录下所有可用的 .nahida-package
 */
export function listAvailablePackages(): InstalledPackageInfo[] {
  const packagesDir = path.resolve(process.cwd(), 'packages');
  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  const result: InstalledPackageInfo[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = path.join(packagesDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    if (!entry.endsWith('.nahida-package')) continue;

    const manifestPath = path.join(entryPath, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const manifest = validateManifest(raw);
      const stat = fs.statSync(manifestPath);
      result.push({
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        packageType: manifest.packageType,
        installedAt: stat.mtimeMs,
        manifest,
      });
    } catch {
      // 校验失败的包跳过
    }
  }

  return result;
}

/**
 * 获取一个包的详细信息
 */
export function getPackageInfo(packageNameOrPath: string): {
  ok: boolean;
  manifest?: PackageManifest;
  packagePath?: string;
  error?: string;
} {
  const packageDir = resolvePackageDir(packageNameOrPath);
  if (!packageDir || !fs.existsSync(packageDir)) {
    return { ok: false, error: `包目录不存在: ${packageNameOrPath}` };
  }

  const manifestPath = path.join(packageDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: `manifest.json 不存在` };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = validateManifest(raw);
    return { ok: true, manifest, packagePath: packageDir };
  } catch (err) {
    return {
      ok: false,
      error: `manifest 校验失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
