import { globalShortcut, BrowserWindow, ipcMain } from 'electron';

export interface ShortcutOptions {
  mainWindow: BrowserWindow;
  live2dWindow: BrowserWindow;
}

const DEFAULT_SHORTCUT = 'Ctrl+Space';
const FEEDBACK_SHORTCUT = 'Ctrl+Shift+F';

let registered = false;

export function registerShortcuts(options: ShortcutOptions): void {
  if (registered) {
    unregisterShortcuts();
  }

  const { mainWindow } = options;

  // Ctrl+Space —— 显示/隐藏主窗口
  const toggleMainWindow = globalShortcut.register(DEFAULT_SHORTCUT, () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!toggleMainWindow) {
    console.warn('[Shortcut] failed to register Ctrl+Space (may be in use)');
  }

  // Ctrl+Shift+F —— 打开反馈窗口
  const openFeedback = globalShortcut.register(FEEDBACK_SHORTCUT, () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('feedback:open', {});
    }
  });

  if (!openFeedback) {
    console.warn('[Shortcut] failed to register Ctrl+Shift+F (may be in use)');
  }

  registered = true;
  console.log('[Shortcut] shortcuts registered:', DEFAULT_SHORTCUT, FEEDBACK_SHORTCUT);
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
  registered = false;
  console.log('[Shortcut] all shortcuts unregistered');
}

export function isShortcutRegistered(): boolean {
  return registered;
}

export function getDefaultShortcut(): string {
  return DEFAULT_SHORTCUT;
}

export function isShortcutAvailable(shortcut: string): boolean {
  return globalShortcut.isRegistered(shortcut) === false;
}