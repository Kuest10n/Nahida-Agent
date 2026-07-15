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
 *     preload/index.js            (预加载脚本，rootDir=src 平铺)
 *     renderer/main/index.html    (聊天窗口 HTML)
 *     renderer/live2d/index.html  (Live2D 窗口 HTML)
 *
 * __dirname = dist/main/main/windows/
 * ../../../preload/index.js → dist/preload/index.js ✅
 */
function getPreloadPath(): string {
  const primary = path.join(__dirname, '../../../preload/index.js');
  // 兜底：开发期 dist 结构若被改动，回退到 dist/preload/preload/index.js
  if (!fs.existsSync(primary)) {
    const fallback = path.join(__dirname, '../../../preload/preload/index.js');
    if (fs.existsSync(fallback)) return fallback;
  }
  return primary;
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
    backgroundColor: '#f5f7fa', // 防止白屏闪烁
    show: false, // 等 ready-to-show 再显示，避免白屏
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  console.log('[Main] preload path:', preloadPath);
  console.log('[Main] preload exists:', fs.existsSync(preloadPath));

  // 渲染层准备完毕后显示窗口，避免白屏
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    // 移到最顶层并激活（避免被其他窗口遮盖）
    win.moveTop();
    console.log('[Main] window ready and focused');
  });

  // 加载失败兜底：5s 内若还看不到 ready-to-show，主动 show + 输出诊断
  setTimeout(() => {
    if (!win.isVisible()) {
      console.warn('[Main] window still not visible after 5s — forcing show');
      win.show();
      win.focus();
      win.moveTop();
    }
  }, 5000);

  // 渲染层加载失败的诊断信息
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Main] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[Main] preload-error: path=${preloadPath} err=${error.message}`);
  });

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

  // 主窗口重新获得焦点时移到最顶（防止被 Live2D 一直置顶遮盖）
  win.on('focus', () => {
    win.moveTop();
  });

  return win;
}

// Live2D 透明漂浮窗
export function createLive2dWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay();
  // 缩小 Live2D 窗口尺寸，避免太大遮挡主窗口
  const winWidth = 320;
  const winHeight = 480;

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    // 放在右下角，但不与主窗口冲突
    x: workAreaSize.width - winWidth - 20,
    y: workAreaSize.height - winHeight - 60,
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
