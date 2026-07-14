import { app } from 'electron';
import { WindowManager } from './windows/manager';
import { setupIpcHandlers } from './ipc/handlers';
import { warmupModel } from './agent/agent-core';
import { registerBuiltinTools } from './tools/builtin';
import { PerceptionModule } from './perception';
import { ReviewLayer } from './agent/review-layer';
import { proactiveQueue } from './agent/proactive-queue';
import { createTray, destroyTray } from './tray/tray-manager';
import { registerShortcuts, unregisterShortcuts } from './tray/shortcuts';

// 单例窗口管理器 + Perception 模块 + 主动开口 reviewer
const windowMgr = new WindowManager();
const perception = new PerceptionModule();
// 独立 reviewer 实例（避免与 handlers.ts 内部 reviewer 状态污染）
const proactiveReviewer = new ReviewLayer({ enabled: true });

app.whenReady().then(() => {
  windowMgr.createAll();

  if (windowMgr.mainWindow && windowMgr.live2dWindow) {
    setupIpcHandlers(windowMgr.mainWindow, windowMgr.live2dWindow);

    createTray({
      mainWindow: windowMgr.mainWindow,
      live2dWindow: windowMgr.live2dWindow,
    });

    registerShortcuts({
      mainWindow: windowMgr.mainWindow,
      live2dWindow: windowMgr.live2dWindow,
    });

    proactiveQueue.bind(windowMgr.mainWindow, windowMgr.live2dWindow, proactiveReviewer);

    perception.alert.onAlert((event) => {
      windowMgr.mainWindow?.webContents.send('agent:state-change', {
        state: 'error' as const,
        reason: `[Perception:${event.type}] ${event.message}`,
        game: event.data.game ? { game: event.data.game as 'GI' | 'SR' | 'none' } : undefined,
        timestamp: event.timestamp,
      });

      proactiveQueue.enqueue(event.type, {
        game: event.data.game,
        fpsAvg: event.data.fpsAvg,
        gpuTemp: event.data.gpuTemp,
      });
    });
  }

  perception.start();

  registerBuiltinTools();

  void warmupModel();

  if (process.env.VITE_DEV_SERVER_URL && windowMgr.mainWindow) {
    windowMgr.mainWindow.webContents.openDevTools();
  }
});

// macOS 特有：点击 dock 图标且没有窗口时重建
app.on('activate', () => {
  if (windowMgr.mainWindow === null) {
    windowMgr.createAll();
  }
});

app.on('window-all-closed', () => {
  perception.stop();
  destroyTray();
  unregisterShortcuts();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
