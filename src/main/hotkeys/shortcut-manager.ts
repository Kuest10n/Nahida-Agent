/**
 * 全局快捷键系统 —— v1.8
 *
 * 职责：
 *   1. 注册/注销全局快捷键（globalShortcut）
 *   2. 快捷键映射到预设动作（打开窗口/语音输入/截图等）
 *   3. 用户可自定义快捷键映射
 *
 * 默认快捷键：
 *   - Ctrl+Shift+N  → 显示/隐藏主窗口
 *   - Ctrl+Shift+V  → 开始/停止语音输入
 *   - Ctrl+Shift+E  → 导出当前对话
 *   - Ctrl+Shift+F  → 打开反馈界面
 *   - Ctrl+Shift+H  → 切换六顶帽模式
 *
 * 安全限制：
 *   - 快捷键冲突检测
 *   - 最多注册 10 个快捷键
 *   - 应用退出时自动注销全部
 */

import { globalShortcut, BrowserWindow } from 'electron';

// ── 类型定义 ──────────────────────────────────────────────────

/** 快捷键动作类型 */
export type ShortcutAction =
  | 'toggle-window'
  | 'toggle-voice'
  | 'export-conversation'
  | 'open-feedback'
  | 'toggle-hat-mode'
  | 'toggle-penetrate'
  | 'custom';

/** 快捷键映射 */
export interface ShortcutMapping {
  /** 快捷键组合（Electron 格式，如 'Ctrl+Shift+N'） */
  accelerator: string;
  /** 绑定的动作 */
  action: ShortcutAction;
  /** 自定义回调（仅 action='custom' 时使用） */
  callback?: () => void;
  /** 是否启用 */
  enabled: boolean;
}

/** 快捷键状态 */
export interface ShortcutStatus {
  registered: string[];
  failed: string[];
  total: number;
}

// ── 默认快捷键 ────────────────────────────────────────────────

const DEFAULT_SHORTCUTS: ShortcutMapping[] = [
  { accelerator: 'Ctrl+Shift+N', action: 'toggle-window', enabled: true },
  { accelerator: 'Ctrl+Shift+V', action: 'toggle-voice', enabled: true },
  { accelerator: 'Ctrl+Shift+E', action: 'export-conversation', enabled: true },
  { accelerator: 'Ctrl+Shift+F', action: 'open-feedback', enabled: true },
  { accelerator: 'Ctrl+Shift+H', action: 'toggle-hat-mode', enabled: true },
];

// ── 模块状态 ──────────────────────────────────────────────────

/** 已注册的快捷键映射 */
const shortcuts = new Map<string, ShortcutMapping>();

/** 动作回调 */
const actionCallbacks = new Map<ShortcutAction, () => void>();

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null;

/** 最大快捷键数量 */
const MAX_SHORTCUTS = 10;

// ── 初始化 ────────────────────────────────────────────────────

/**
 * 初始化快捷键系统
 *
 * @param window 主窗口
 * @param customShortcuts 自定义快捷键列表（覆盖默认）
 */
export function initShortcuts(
  window: BrowserWindow,
  customShortcuts?: ShortcutMapping[],
): void {
  mainWindow = window;

  const list = customShortcuts ?? DEFAULT_SHORTCUTS;

  for (const mapping of list) {
    if (shortcuts.size >= MAX_SHORTCUTS) {
      console.warn(`[Shortcuts] max ${MAX_SHORTCUTS} reached, skipping ${mapping.accelerator}`);
      break;
    }
    registerShortcut(mapping);
  }

  console.log(`[Shortcuts] initialized, ${shortcuts.size} shortcut(s) registered`);
}

/**
 * 注册快捷键
 */
export function registerShortcut(mapping: ShortcutMapping): boolean {
  if (!mapping.enabled) return false;

  if (shortcuts.size >= MAX_SHORTCUTS) {
    console.warn(`[Shortcuts] max ${MAX_SHORTCUTS} reached`);
    return false;
  }

  // 冲突检测
  if (shortcuts.has(mapping.accelerator)) {
    console.warn(`[Shortcuts] conflict: ${mapping.accelerator} already registered`);
    return false;
  }

  try {
    const success = globalShortcut.register(mapping.accelerator, () => {
      handleAction(mapping);
    });

    if (!success) {
      console.warn(`[Shortcuts] failed to register: ${mapping.accelerator}`);
      return false;
    }

    shortcuts.set(mapping.accelerator, mapping);
    console.log(`[Shortcuts] registered: ${mapping.accelerator} → ${mapping.action}`);
    return true;
  } catch (err) {
    console.error(`[Shortcuts] register error: ${mapping.accelerator}`, err);
    return false;
  }
}

/**
 * 注销快捷键
 */
export function unregisterShortcut(accelerator: string): boolean {
  if (!shortcuts.has(accelerator)) return false;

  globalShortcut.unregister(accelerator);
  shortcuts.delete(accelerator);
  console.log(`[Shortcuts] unregistered: ${accelerator}`);
  return true;
}

/**
 * 注册动作回调
 *
 * 外部模块通过此函数注册对特定动作的响应。
 */
export function onAction(action: ShortcutAction, callback: () => void): void {
  actionCallbacks.set(action, callback);
}

/**
 * 注销全部快捷键
 */
export function unregisterAll(): void {
  for (const accelerator of shortcuts.keys()) {
    globalShortcut.unregister(accelerator);
  }
  shortcuts.clear();
  console.log('[Shortcuts] all unregistered');
}

/**
 * 获取快捷键状态
 */
export function getShortcutStatus(): ShortcutStatus {
  return {
    registered: Array.from(shortcuts.keys()),
    failed: [],
    total: shortcuts.size,
  };
}

/**
 * 获取所有快捷键映射
 */
export function getShortcuts(): ShortcutMapping[] {
  return Array.from(shortcuts.values());
}

/**
 * 格式化快捷键列表为纳西妲腔文本
 */
export function formatShortcutList(): string {
  const list = getShortcuts();
  if (list.length === 0) {
    return '（花冠微垂）……还没有注册快捷键呢。';
  }

  const lines: string[] = [];
  lines.push('（指尖轻拂虚空屏）……快捷键列表：');
  lines.push('');

  const actionNames: Record<ShortcutAction, string> = {
    'toggle-window': '显示/隐藏主窗口',
    'toggle-voice': '开始/停止语音输入',
    'export-conversation': '导出当前对话',
    'open-feedback': '打开反馈界面',
    'toggle-hat-mode': '切换六顶帽模式',
    'toggle-penetrate': '切换鼠标穿透',
    'custom': '自定义动作',
  };

  for (const s of list) {
    const status = s.enabled ? '✅' : '⏸️';
    lines.push(`${status} ${s.accelerator} → ${actionNames[s.action] ?? s.action}`);
  }

  return lines.join('\n');
}

// ── 内部函数 ──────────────────────────────────────────────────

/**
 * 处理快捷键动作
 */
function handleAction(mapping: ShortcutMapping): void {
  console.log(`[Shortcuts] action: ${mapping.action}`);

  // 优先调用自定义回调
  if (mapping.action === 'custom' && mapping.callback) {
    mapping.callback();
    return;
  }

  // 调用注册的回调
  const callback = actionCallbacks.get(mapping.action);
  if (callback) {
    callback();
    return;
  }

  // 默认处理
  switch (mapping.action) {
    case 'toggle-window':
      toggleWindow();
      break;

    case 'toggle-voice':
      // 通知渲染层切换语音输入
      mainWindow?.webContents.send('stt:toggle', { timestamp: Date.now() });
      break;

    case 'export-conversation':
      // 通知渲染层导出对话
      mainWindow?.webContents.send('export:request', { timestamp: Date.now() });
      break;

    case 'open-feedback':
      // 通知渲染层打开反馈
      mainWindow?.webContents.send('feedback:open', { timestamp: Date.now() });
      break;

    case 'toggle-hat-mode':
      // 通知渲染层切换六顶帽
      mainWindow?.webContents.send('hat:toggle', { timestamp: Date.now() });
      break;

    case 'toggle-penetrate':
      // 通知渲染层切换穿透
      mainWindow?.webContents.send('live2d:penetrate-toggle', { timestamp: Date.now() });
      break;

    default:
      console.warn(`[Shortcuts] unhandled action: ${mapping.action}`);
  }
}

/**
 * 切换主窗口显示/隐藏
 */
function toggleWindow(): void {
  if (!mainWindow) return;

  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}