/**
 * 区域截图覆盖窗口管理器（v2.11.0 多屏版）
 *
 * v2.9.0 只支持主屏。v2.11.0 改造为：
 *   - 为每个显示器创建一个独立的覆盖窗口
 *   - 用户在任意屏幕上拖拽选区
 *   - 回传 displayId + 相对坐标
 *   - 主进程按 displayId 截图 + 按相对坐标裁剪
 *
 * 设计：
 *   1. 用户输入 /screenshot region → 主进程调用 showRegionOverlay()
 *   2. 遍历所有显示器，每个创建一个全屏透明覆盖窗口
 *   3. 每个窗口加载 capture-overlay/index.html，传入 displayId + 屏幕尺寸 + DPR
 *   4. 用户在任意屏幕上拖拽选区 → 该窗口 IPC 发送 SCREENSHOT_REGION_RESULT
 *   5. 主进程收到 { displayId, x, y, width, height } → 关闭所有覆盖窗口 → captureRegion() 裁剪
 *   6. 用户按 ESC → 任意窗口发送 SCREENSHOT_REGION_CANCEL → 关闭所有窗口
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** 选区结果：displayId + 相对屏幕坐标 */
export interface RegionSelection {
  displayId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 覆盖窗口数组（多屏） */
let overlayWindows: BrowserWindow[] = [];

/** 选区完成回调 */
let resolveRegion: ((region: RegionSelection | null) => void) | null = null;

/** 是否已解决（防止重复 resolve） */
let resolved = false;

// ── 工具函数 ─────────────────────────────────────────────────

/** 计算预加载脚本路径（与 windows/manager.ts 一致） */
function getPreloadPath(): string {
  const primary = path.join(__dirname, '../../../preload/index.js');
  if (!fs.existsSync(primary)) {
    const fallback = path.join(__dirname, '../../../preload/preload/index.js');
    if (fs.existsSync(fallback)) return fallback;
  }
  return primary;
}

/** 计算渲染层 HTML 路径 */
function getRendererHtmlPath(): string {
  // __dirname = dist/main/main/vision/
  // ../../renderer/capture-overlay/index.html → dist/renderer/capture-overlay/index.html
  return path.join(__dirname, '../../renderer/capture-overlay/index.html');
}

/** 关闭所有覆盖窗口并清理状态 */
function closeAllOverlays(): void {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
  overlayWindows = [];
  resolveRegion = null;
  resolved = false;
}

// ── 主 API ──────────────────────────────────────────────────

/**
 * 显示区域截图覆盖窗口（多屏版）
 *
 * @returns 选区结果（含 displayId），用户取消返回 null
 *
 * 重复调用安全：若已有覆盖窗口，先全部关闭再创建。
 */
export function showRegionOverlay(): Promise<RegionSelection | null> {
  // 若已存在覆盖窗口，先全部关闭
  if (overlayWindows.length > 0) {
    closeAllOverlays();
  }

  return new Promise((resolve) => {
    resolveRegion = resolve;
    resolved = false;

    const displays = screen.getAllDisplays();

    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      const dpr = display.scaleFactor;
      const displayId = String(display.id);

      const win = new BrowserWindow({
        x,
        y,
        width,
        height,
        fullscreen: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      // 记录 displayId 到窗口对象上（方便回调时识别）
      (win as unknown as { _displayId: string })._displayId = displayId;

      // 加载完成后通知渲染层启动选区
      win.once('ready-to-show', () => {
        win.show();
        win.focus();
        win.setFullScreen(true);

        // 通知渲染层开始选区
        win.webContents.send('screenshot:region-start', {
          displayId,
          screenWidth: width,
          screenHeight: height,
          devicePixelRatio: dpr,
          isMultiDisplay: displays.length > 1,
          displayIndex: displays.indexOf(display) + 1,
          totalDisplays: displays.length,
        });
      });

      // 加载页面
      if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(`${process.env.VITE_DEV_SERVER_URL}capture-overlay/index.html`);
      } else {
        win.loadFile(getRendererHtmlPath());
      }

      win.on('closed', () => {
        // 从数组中移除
        overlayWindows = overlayWindows.filter(w => w !== win);
        // 如果所有窗口都关了且还没 resolve，视为取消
        if (overlayWindows.length === 0 && !resolved && resolveRegion) {
          resolveRegion(null);
          resolveRegion = null;
          resolved = true;
        }
      });

      overlayWindows.push(win);
    }
  });
}

/**
 * 主进程注册区域截图 IPC 监听
 *
 * 在 setupIpcHandlers 中调用一次。
 */
export function registerRegionOverlayHandlers(): void {
  const { ipcMain } = require('electron') as typeof import('electron');

  // 渲染层回传选区坐标
  ipcMain.handle(
    'screenshot:region-result',
    (event, payload: { x: number; y: number; width: number; height: number; displayId?: string }) => {
      if (resolved) return { ok: false, reason: 'already-resolved' };
      resolved = true;

      // 从事件发送者窗口获取 displayId（更可靠）
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      let displayId = payload.displayId;
      if (!displayId && senderWin) {
        displayId = (senderWin as unknown as { _displayId?: string })._displayId;
      }
      // fallback：主屏
      if (!displayId) {
        const primary = screen.getPrimaryDisplay();
        displayId = String(primary.id);
      }

      if (resolveRegion) {
        resolveRegion({
          displayId,
          x: payload.x,
          y: payload.y,
          width: payload.width,
          height: payload.height,
        });
        resolveRegion = null;
      }

      // 关闭所有覆盖窗口
      closeAllOverlays();
      return { ok: true };
    },
  );

  // 用户取消（ESC）
  ipcMain.handle('screenshot:region-cancel', () => {
    if (resolved) return { ok: false, reason: 'already-resolved' };
    resolved = true;

    if (resolveRegion) {
      resolveRegion(null);
      resolveRegion = null;
    }
    closeAllOverlays();
    return { ok: true };
  });
}
