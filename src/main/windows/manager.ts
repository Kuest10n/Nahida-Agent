import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 计算预加载脚本路径
 *
 * 构建后目录结构：
 *   dist/
 *     main/main/index.js          (主进程入口)
 *     main/main/windows/manager.js (本文件)
 *     preload/preload/index.js    (预加载脚本)
 *     renderer/main/index.html    (聊天窗口 HTML)
 *     renderer/live2d/index.html  (Live2D 窗口 HTML)
 *
 * __dirname = dist/main/main/windows/
 * ../../../preload/preload/index.js → dist/preload/preload/index.js ✅
 */
function getPreloadPath(): string {
  return path.join(__dirname, '../../../preload/preload/index.js');
}

/**
 * 计算渲染层 HTML 路径
 *
 * @param page 页面名 ('main' | 'live2d')
 * @returns 完整文件路径
 */
function getRendererHtmlPath(page: 'main' | 'live2d'): string {
  // __dirname = dist/main/main/windows/
  // ../../renderer/${page}/index.html → dist/renderer/${page}/index.html
  return path.join(__dirname, `../../renderer/${page}/index.html`);
}

// 聊天主窗口（正常窗口，带聊天/设置/任务/侧边栏）
export function createMainWindow(): BrowserWindow {
  const preloadPath = getPreloadPath();

  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 480,
    title: '纳西妲 Agent',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  console.log('[Main] preload path:', preloadPath);
  console.log('[Main] preload exists:', fs.existsSync(preloadPath));

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}main/index.html`);
  } else {
    const htmlPath = getRendererHtmlPath('main');
    console.log('[Main] loading HTML:', htmlPath);
    win.loadFile(htmlPath);
  }

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Renderer][L${level}] ${message} (${sourceId}:${line})`);
  });

  return win;
}

// Live2D 透明漂浮窗
export function createLive2dWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const winWidth = 450;
  const winHeight = 700;

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: workAreaSize.width - winWidth - 40,
    y: workAreaSize.height - winHeight - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 默认允许鼠标事件；动态穿透由渲染层通过 live2d:penetrate 控制

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}live2d/index.html`);
  } else {
    win.loadFile(getRendererHtmlPath('live2d'));
  }

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Live2D][L${level}] ${message} (${sourceId}:${line})`);
  });

  return win;
}

// 统一管理所有窗口
export class WindowManager {
  mainWindow: BrowserWindow | null = null;
  live2dWindow: BrowserWindow | null = null;

  createAll(): void {
    this.mainWindow = createMainWindow();
    this.live2dWindow = createLive2dWindow();

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      app.quit(); // 主窗关了整个 app 退
    });
  }
}
