/**
 * 插件加载器 —— v1.7
 *
 * 职责：
 *   1. 扫描 plugins/ 目录，加载插件
 *   2. 管理插件状态（启用/禁用）
 *   3. 执行钩子链（按优先级顺序）
 *   4. 提供插件统计和列表
 *
 * 目录结构：
 *   plugins/
 *   ├── example-plugin/
 *   │   ├── manifest.json    ← 插件清单
 *   │   ├── index.js         ← 插件入口（IIFE）
 *   │   └── README.md        ← 插件文档
 *
 * 安全限制：
 *   - 插件在 Node.js 主进程中运行（需信任）
 *   - 后续可考虑沙箱化（vm2 / worker_threads）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type {
  NahidaPlugin,
  LoadedPlugin,
  PluginHookType,
  PluginHookContext,
  PluginHookResult,
  PluginManifest,
} from './plugin-types';

// ── 常量 ──────────────────────────────────────────────────────

/** 插件目录 */
const PLUGINS_DIR = path.resolve(process.cwd(), 'plugins');

/** 被 security 策略阻止的模块（VULN-002 修复） */
const BLOCKED_MODULES = new Set([
  'child_process',
  'cluster',
  'worker_threads',
  'node:child_process',
  'node:cluster',
  'node:worker_threads',
]);

/**
 * 沙箱化加载插件代码
 *
 * 使用 vm.runInThisContext 编译插件代码，注入受限的 require，
 * 阻止 child_process / cluster / worker_threads 等危险模块。
 * 注意：vm.runInThisContext 不是完美沙箱，但能阻止直接 require 危险模块。
 */
function loadPluginSandboxed(indexPath: string): Partial<NahidaPlugin> {
  const code = fs.readFileSync(indexPath, 'utf-8');
  const dir = path.dirname(indexPath);

  // CommonJS 包装：(function(exports, require, module, __filename, __dirname) { ... })
  const wrapper = `(function(exports, require, module, __filename, __dirname) { ${code} })`;

  const sandboxedRequire = (id: string): unknown => {
    if (BLOCKED_MODULES.has(id)) {
      throw new Error(`[Plugins] 安全策略阻止加载模块 "${id}"`);
    }
    return require(id);
  };

  const moduleObj: { exports: Partial<NahidaPlugin> } = { exports: {} };
  const compiledFn = vm.runInThisContext(wrapper, { filename: indexPath }) as (
    exports: Record<string, unknown>,
    require: (id: string) => unknown,
    module: { exports: Partial<NahidaPlugin> },
    filename: string,
    dirname: string,
  ) => void;

  compiledFn(moduleObj.exports, sandboxedRequire, moduleObj, indexPath, dir);
  return moduleObj.exports;
}

// ── 模块状态 ──────────────────────────────────────────────────

/** 已加载的插件列表 */
const loadedPlugins = new Map<string, LoadedPlugin>();

/** 是否已初始化 */
let initialized = false;

// ── 初始化 ────────────────────────────────────────────────────

/**
 * 初始化插件系统
 *
 * 扫描 plugins/ 目录，加载所有有效插件。
 */
export function initPlugins(): void {
  if (initialized) return;

  // 创建插件目录（如果不存在）
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    console.log('[Plugins] created plugins directory');
    initialized = true;
    return;
  }

  // 扫描插件
  scanPlugins();

  initialized = true;
  console.log(`[Plugins] initialized, ${loadedPlugins.size} plugin(s) loaded`);
}

/**
 * 扫描插件目录
 */
function scanPlugins(): void {
  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const manifestPath = path.join(pluginDir, 'manifest.json');
    const indexPath = path.join(pluginDir, 'index.js');

    // 检查 manifest.json
    if (!fs.existsSync(manifestPath)) {
      console.warn(`[Plugins] ${entry.name}: missing manifest.json, skipped`);
      continue;
    }

    // 检查 index.js
    if (!fs.existsSync(indexPath)) {
      console.warn(`[Plugins] ${entry.name}: missing index.js, skipped`);
      continue;
    }

    try {
      // 加载 manifest
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as PluginManifest;

      // 验证 manifest
      if (!manifest.id || !manifest.name || !manifest.version) {
        console.warn(`[Plugins] ${entry.name}: invalid manifest, skipped`);
        continue;
      }

      // 加载插件代码（沙箱化，VULN-002 修复）
      console.warn(`[Plugins] loading "${entry.name}" in sandboxed context (blocked: child_process, cluster, worker_threads)`);
      const pluginModule = loadPluginSandboxed(indexPath);
      const plugin: NahidaPlugin = {
        manifest,
        hooks: pluginModule.hooks,
        executeTool: pluginModule.executeTool,
        executeCommand: pluginModule.executeCommand,
        onLoad: pluginModule.onLoad,
        onUnload: pluginModule.onUnload,
      };

      // 检查依赖
      if (manifest.dependencies) {
        for (const dep of manifest.dependencies) {
          if (!loadedPlugins.has(dep)) {
            console.warn(`[Plugins] ${entry.name}: missing dependency "${dep}"`);
          }
        }
      }

      // 注册插件
      const loaded: LoadedPlugin = {
        plugin,
        status: 'enabled',
        loadedAt: new Date().toISOString(),
      };

      loadedPlugins.set(manifest.id, loaded);

      // 调用 onLoad
      if (plugin.onLoad) {
        try {
          plugin.onLoad();
        } catch (err) {
          console.error(`[Plugins] ${manifest.id}.onLoad() failed:`, err);
          loaded.status = 'error';
          loaded.error = err instanceof Error ? err.message : String(err);
        }
      }

      console.log(`[Plugins] loaded: ${manifest.id} v${manifest.version}`);
    } catch (err) {
      console.error(`[Plugins] ${entry.name} load failed:`, err);
    }
  }
}

// ── 钩子执行 ──────────────────────────────────────────────────

/**
 * 执行钩子链
 *
 * 按插件加载顺序依次执行，前一个插件可以阻止后续插件执行。
 *
 * @param hookType 钩子类型
 * @param context 钩子上下文
 * @returns 最终的钩子结果
 */
export async function executeHooks(
  hookType: PluginHookType,
  context: PluginHookContext,
): Promise<PluginHookResult> {
  let result: PluginHookResult = { continue: true };

  for (const [, loaded] of loadedPlugins) {
    // 跳过禁用/错误的插件
    if (loaded.status !== 'enabled') continue;

    // 跳过没有此钩子的插件
    const hookFn = loaded.plugin.hooks?.[hookType];
    if (!hookFn) continue;

    try {
      const hookResult = await hookFn(context);

      // 合并结果
      if (hookResult.modifiedMessage !== undefined) {
        context.userMessage = hookResult.modifiedMessage;
        result.modifiedMessage = hookResult.modifiedMessage;
      }
      if (hookResult.modifiedResponse !== undefined) {
        context.response = hookResult.modifiedResponse;
        result.modifiedResponse = hookResult.modifiedResponse;
      }
      if (hookResult.interceptTool !== undefined) {
        result.interceptTool = hookResult.interceptTool;
      }
      if (hookResult.replaceToolResult !== undefined) {
        result.replaceToolResult = hookResult.replaceToolResult;
      }

      // 如果插件要求停止，退出链
      if (!hookResult.continue) {
        result.continue = false;
        break;
      }
    } catch (err) {
      console.error(`[Plugins] ${loaded.plugin.manifest.id}.${hookType}() failed:`, err);
    }
  }

  return result;
}

// ── 插件管理 ──────────────────────────────────────────────────

/**
 * 启用插件
 */
export function enablePlugin(pluginId: string): boolean {
  const loaded = loadedPlugins.get(pluginId);
  if (!loaded) return false;
  loaded.status = 'enabled';
  return true;
}

/**
 * 禁用插件
 */
export function disablePlugin(pluginId: string): boolean {
  const loaded = loadedPlugins.get(pluginId);
  if (!loaded) return false;
  loaded.status = 'disabled';
  return true;
}

/**
 * 重新加载插件
 */
export function reloadPlugin(pluginId: string): boolean {
  const loaded = loadedPlugins.get(pluginId);
  if (!loaded) return false;

  // 调用 onUnload
  if (loaded.plugin.onUnload) {
    try {
      loaded.plugin.onUnload();
    } catch (err) {
      console.error(`[Plugins] ${pluginId}.onUnload() failed:`, err);
    }
  }

  // 移除并重新扫描
  loadedPlugins.delete(pluginId);
  scanPlugins();
  return loadedPlugins.has(pluginId);
}

/**
 * 获取所有已加载插件
 */
export function listPlugins(): Array<{ manifest: PluginManifest; status: string; loadedAt: string; error?: string }> {
  return Array.from(loadedPlugins.values()).map(loaded => ({
    manifest: loaded.plugin.manifest,
    status: loaded.status,
    loadedAt: loaded.loadedAt,
    error: loaded.error,
  }));
}

/**
 * 获取插件统计
 */
export function getPluginStats(): { total: number; enabled: number; disabled: number; error: number } {
  let enabled = 0;
  let disabled = 0;
  let error = 0;

  for (const loaded of loadedPlugins.values()) {
    switch (loaded.status) {
      case 'enabled': enabled++; break;
      case 'disabled': disabled++; break;
      case 'error': error++; break;
    }
  }

  return { total: loadedPlugins.size, enabled, disabled, error };
}

/**
 * 执行插件提供的自定义命令
 *
 * @param pluginId 插件 ID
 * @param commandName 命令名称
 * @param args 命令参数
 * @returns 命令输出
 */
export function executePluginCommand(
  pluginId: string,
  commandName: string,
  args: string[],
): string | null {
  const loaded = loadedPlugins.get(pluginId);
  if (!loaded || loaded.status !== 'enabled') return null;
  if (!loaded.plugin.executeCommand) return null;

  try {
    return loaded.plugin.executeCommand(commandName, args);
  } catch (err) {
    console.error(`[Plugins] ${pluginId}.executeCommand() failed:`, err);
    return null;
  }
}

/**
 * 执行插件提供的工具
 *
 * @param pluginId 插件 ID
 * @param toolName 工具名称
 * @param params 工具参数
 * @returns 工具执行结果
 */
export async function executePluginTool(
  pluginId: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown | null> {
  const loaded = loadedPlugins.get(pluginId);
  if (!loaded || loaded.status !== 'enabled') return null;
  if (!loaded.plugin.executeTool) return null;

  try {
    return await loaded.plugin.executeTool(toolName, params);
  } catch (err) {
    console.error(`[Plugins] ${pluginId}.executeTool() failed:`, err);
    return null;
  }
}

/**
 * 格式化插件列表为纳西妲腔文本
 */
export function formatPluginList(): string {
  const plugins = listPlugins();
  const stats = getPluginStats();

  if (plugins.length === 0) {
    return '（花冠微垂）……plugins/ 目录下还没有插件呢。把插件放到 plugins/<plugin-name>/ 下就能自动加载了（铃铛轻响）';
  }

  const lines: string[] = [];
  lines.push('（指尖轻拂虚空屏）……插件列表：');
  lines.push('');
  lines.push(`总计：${stats.total} | 启用：${stats.enabled} | 禁用：${stats.disabled} | 错误：${stats.error}`);
  lines.push('');

  for (const p of plugins) {
    const statusIcon = p.status === 'enabled' ? '✅' : p.status === 'disabled' ? '⏸️' : '❌';
    lines.push(`${statusIcon} ${p.manifest.name} v${p.manifest.version} (${p.manifest.id})`);
    lines.push(`   ${p.manifest.description}`);
    if (p.error) {
      lines.push(`   错误：${p.error}`);
    }
  }

  return lines.join('\n');
}