/**
 * 插件系统接口定义 —— v1.7
 *
 * 插件 = 钩子（Hook） + 工具（Tool） + 配置（Config）
 *
 * 生命周期：
 *   1. loadPlugins() 扫描 plugins/ 目录
 *   2. 每个插件的 manifest.json 声明名称/版本/钩子/工具
 *   3. 插件代码以 IIFE 形式执行，注册钩子和工具
 *   4. 主流程在各阶段调用对应钩子
 *
 * 钩子点：
 *   - beforeMessage:   用户消息到达前（可修改消息）
 *   - afterResponse:   模型回复后（可修改回复）
 *   - onToolCall:      工具调用时（可拦截/替换）
 *   - onSessionStart:  会话开始
 *   - onSessionEnd:    会话结束
 *   - onCustomCommand: 自定义命令（/plugin xxx）
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 插件清单 */
export interface PluginManifest {
  /** 插件 ID（唯一标识，英文小写+连字符） */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 支持的钩子列表 */
  hooks?: PluginHookType[];
  /** 提供的工具列表 */
  tools?: PluginToolDecl[];
  /** 自定义命令列表 */
  commands?: PluginCommandDecl[];
  /** 依赖的其他插件 ID */
  dependencies?: string[];
}

/** 钩子类型 */
export type PluginHookType =
  | 'beforeMessage'
  | 'afterResponse'
  | 'onToolCall'
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'onCustomCommand';

/** 钩子上下文 */
export interface PluginHookContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 用户消息（beforeMessage 时可修改） */
  userMessage?: string;
  /** 模型回复（afterResponse 时可修改） */
  response?: string;
  /** 工具调用名称（onToolCall 时） */
  toolName?: string;
  /** 工具调用参数（onToolCall 时） */
  toolParams?: Record<string, unknown>;
  /** 自定义命令参数（onCustomCommand 时） */
  commandArgs?: string[];
}

/** 钩子执行结果 */
export interface PluginHookResult {
  /** 是否继续执行后续插件 */
  continue: boolean;
  /** 修改后的消息（beforeMessage 时） */
  modifiedMessage?: string;
  /** 修改后的回复（afterResponse 时） */
  modifiedResponse?: string;
  /** 是否拦截工具调用（onToolCall 时） */
  interceptTool?: boolean;
  /** 替换工具调用的结果（onToolCall 时） */
  replaceToolResult?: unknown;
}

/** 插件工具声明 */
export interface PluginToolDecl {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 JSON Schema */
  parameters: Record<string, unknown>;
}

/** 插件命令声明 */
export interface PluginCommandDecl {
  /** 命令名称（不含 /） */
  name: string;
  /** 命令描述 */
  description: string;
  /** 用法示例 */
  usage: string;
}

/** 插件接口 */
export interface NahidaPlugin {
  /** 清单 */
  manifest: PluginManifest;
  /** 钩子处理函数 */
  hooks?: Partial<Record<PluginHookType, (ctx: PluginHookContext) => PluginHookResult | Promise<PluginHookResult>>>;
  /** 工具执行函数 */
  executeTool?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 命令处理函数 */
  executeCommand?: (commandName: string, args: string[]) => string;
  /** 插件初始化（加载时调用） */
  onLoad?: () => void;
  /** 插件卸载（卸载时调用） */
  onUnload?: () => void;
}

/** 插件状态 */
export type PluginStatus = 'loaded' | 'enabled' | 'disabled' | 'error';

/** 已加载的插件实例 */
export interface LoadedPlugin {
  /** 插件实例 */
  plugin: NahidaPlugin;
  /** 状态 */
  status: PluginStatus;
  /** 加载时间 */
  loadedAt: string;
  /** 错误信息 */
  error?: string;
}