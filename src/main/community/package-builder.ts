/**
 * 社区共享包打包器 —— v2.0.0
 *
 * 职责：
 *   从当前项目的 memory/ 目录读取人格分片和 worldbook，
 *   生成 manifest.json，组装成 .nahida-package 目录结构。
 *
 * 打包产物：
 *   exports/{name}-v{version}.nahida-package/
 *   ├── manifest.json
 *   ├── SOHA.md
 *   ├── persona.md
 *   ├── ...
 *   ├── worldbook/entries.jsonl
 *   └── README.md
 *
 * 安全约束：
 *   - User.md 导出时脱敏（替换真实用户信息为模板占位符）
 *   - fact-*.md 不导出（含用户私密信息）
 *   - 不导出 session/、token-usage 等运行时数据
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PACKAGE_FORMAT_VERSION,
  PERSONA_SHARD_FILES,
  WORLDBOOK_DIR,
  MANIFEST_FILE,
  README_FILE,
  validateManifest,
  type PackageManifest,
  type PackageType,
  type PackageContents,
  type BuildResult,
} from './package-format';

// ── 常量 ──────────────────────────────────────────────────────

const MEMORY_DIR = path.resolve(process.cwd(), 'memory');
const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');

/** User.md 脱敏模板 */
const USER_TEMPLATE = `# 用户信息模板

> 这是社区共享包中的用户信息模板，请替换为你自己的信息。

## 基本信息

- **称呼**：旅行者
- **专业**：（请填写你的专业）
- **学校**：（请填写你的学校）
- **兴趣**：（请填写你的兴趣）

## 偏好

- 沟通语言：中文
- 代码风格：TypeScript strict 模式
`;

// ── 打包选项 ──────────────────────────────────────────────────

export interface BuildOptions {
  /** 包名（snake-case） */
  name: string;
  /** 展示名 */
  displayName: string;
  /** 包描述 */
  description: string;
  /** 包版本号 */
  version: string;
  /** 作者 */
  author: string;
  /** 包类型 */
  packageType: PackageType;
  /** 包内容标记 */
  contents: PackageContents;
  /** 标签 */
  tags?: string[];
  /** 许可证，默认 AGPL-3.0 */
  license?: string;
  /** 主页 URL */
  homepage?: string;
  /** 最低兼容应用版本 */
  minAppVersion: string;
  /** 最高兼容应用版本 */
  maxAppVersion?: string;
  /** 输出目录，默认 exports/ */
  outputDir?: string;
}

// ── 打包逻辑 ──────────────────────────────────────────────────

/**
 * 打包一个 .nahida-package
 *
 * @returns 打包结果
 */
export function buildPackage(options: BuildOptions): BuildResult {
  const result: BuildResult = {
    ok: false,
    includedFiles: [],
    totalSize: 0,
    errors: [],
  };

  // 1. 构造 manifest
  const manifest: PackageManifest = {
    formatVersion: PACKAGE_FORMAT_VERSION,
    packageType: options.packageType,
    name: options.name,
    displayName: options.displayName,
    description: options.description,
    version: options.version,
    author: options.author,
    license: options.license ?? 'AGPL-3.0',
    homepage: options.homepage,
    createdAt: Date.now(),
    contents: options.contents,
    compatibility: {
      minAppVersion: options.minAppVersion,
      maxAppVersion: options.maxAppVersion,
    },
    tags: options.tags ?? [],
  };

  // 校验 manifest
  try {
    validateManifest(manifest);
  } catch (err) {
    result.errors.push(`manifest 校验失败: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // 2. 创建输出目录
  const outputDir = options.outputDir ?? EXPORTS_DIR;
  const packageDirName = `${options.name}-v${options.version}.nahida-package`;
  const packageDir = path.join(outputDir, packageDirName);

  // 如果已存在则先清理
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // 3. 写 manifest.json
  const manifestPath = path.join(packageDir, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  result.includedFiles.push(MANIFEST_FILE);
  result.totalSize += Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf-8');

  // 4. 复制人格分片
  if (options.contents.persona) {
    for (const shardFile of PERSONA_SHARD_FILES) {
      const srcPath = path.join(MEMORY_DIR, shardFile);
      const destPath = path.join(packageDir, shardFile);

      if (shardFile === 'User.md') {
        // User.md 脱敏：写模板而非真实用户数据
        fs.writeFileSync(destPath, USER_TEMPLATE, 'utf-8');
        result.includedFiles.push(shardFile);
        result.totalSize += Buffer.byteLength(USER_TEMPLATE, 'utf-8');
      } else if (fs.existsSync(srcPath)) {
        const content = fs.readFileSync(srcPath, 'utf-8');
        fs.writeFileSync(destPath, content, 'utf-8');
        result.includedFiles.push(shardFile);
        result.totalSize += Buffer.byteLength(content, 'utf-8');
      } else {
        // 文件不存在不报错，跳过（部分分片可选）
        console.warn(`[PackageBuilder] 跳过不存在的分片: ${shardFile}`);
      }
    }
  }

  // 5. 复制 worldbook
  if (options.contents.worldbook) {
    const worldbookSrcDir = path.join(MEMORY_DIR, WORLDBOOK_DIR);
    const worldbookDestDir = path.join(packageDir, WORLDBOOK_DIR);

    if (fs.existsSync(worldbookSrcDir)) {
      fs.mkdirSync(worldbookDestDir, { recursive: true });
      const entries = fs.readdirSync(worldbookSrcDir);
      for (const entry of entries) {
        const srcPath = path.join(worldbookSrcDir, entry);
        const destPath = path.join(worldbookDestDir, entry);
        if (fs.statSync(srcPath).isFile()) {
          const content = fs.readFileSync(srcPath);
          fs.writeFileSync(destPath, content);
          const relPath = `${WORLDBOOK_DIR}/${entry}`;
          result.includedFiles.push(relPath);
          result.totalSize += content.length;
        }
      }
    } else {
      result.errors.push(`worldbook 目录不存在: ${worldbookSrcDir}`);
    }
  }

  // 6. 生成 README.md
  const readmeContent = generateReadme(manifest);
  const readmePath = path.join(packageDir, README_FILE);
  fs.writeFileSync(readmePath, readmeContent, 'utf-8');
  result.includedFiles.push(README_FILE);
  result.totalSize += Buffer.byteLength(readmeContent, 'utf-8');

  // 7. 完成
  result.ok = result.errors.length === 0;
  if (result.ok) {
    result.packagePath = packageDir;
    result.manifest = manifest;
  }

  return result;
}

// ── README 生成 ───────────────────────────────────────────────

function generateReadme(manifest: PackageManifest): string {
  const contentFlags = [
    manifest.contents.persona ? '人格分片' : '',
    manifest.contents.worldbook ? '世界书' : '',
    manifest.contents.modelfile ? '模型配置' : '',
  ].filter(Boolean).join(' / ');

  return `# ${manifest.displayName}

> ${manifest.description}

## 包信息

- **包名**: \`${manifest.name}\`
- **版本**: ${manifest.version}
- **类型**: ${manifest.packageType}
- **作者**: ${manifest.author}
- **许可证**: ${manifest.license}
- **创建时间**: ${new Date(manifest.createdAt).toLocaleString('zh-CN')}
- **格式版本**: ${manifest.formatVersion}

## 包含内容

${contentFlags}

## 兼容性

- 最低应用版本: ${manifest.compatibility.minAppVersion}
${manifest.compatibility.maxAppVersion ? `- 最高应用版本: ${manifest.compatibility.maxAppVersion}` : ''}

## 标签

${manifest.tags.length > 0 ? manifest.tags.map(t => `\`${t}\``).join(' ') : '（无）'}

## 安装方式

1. 将此目录放到 Nahida Agent 的 \`packages/\` 目录
2. 在应用中执行 \`/package install ${manifest.name}\`
3. 安装前会自动备份现有数据

## 注意事项

- User.md 已脱敏为模板，请替换为你自己的信息
- fact-*.md 不包含在共享包中（含用户私密信息）
- 安装前请确认包来源可信

---

*由 Nahida Agent v${manifest.compatibility.minAppVersion} 社区共享协议生成*
`;
}
