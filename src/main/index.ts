import { app } from 'electron';
import { WindowManager } from './windows/manager';
import { setupIpcHandlers } from './ipc/handlers';
import { warmupModel } from './agent/agent-core';
import { registerBuiltinTools } from './tools/builtin';
import { PerceptionModule } from './perception';
import { ReviewLayer } from './agent/review-layer';
import { proactiveQueue } from './agent/proactive-queue';

// 单例窗口管理器 + Perception 模块 + 主动开口 reviewer
const windowMgr = new WindowManager();
const perception = new PerceptionModule();
// 独立 reviewer 实例（避免与 handlers.ts 内部 reviewer 状态污染）
const proactiveReviewer = new ReviewLayer({ enabled: true });

app.whenReady().then(() => {
  windowMgr.createAll();

  if (windowMgr.mainWindow && windowMgr.live2dWindow) {
    setupIpcHandlers(windowMgr.mainWindow, windowMgr.live2dWindow);

    // 主动开口队列绑定窗口 + reviewer
    proactiveQueue.bind(windowMgr.mainWindow, windowMgr.live2dWindow, proactiveReviewer);

    // Perception 报警 → 两条路并行：
    //   1. 推 state-change 给渲染层 StatusBar 显示（报警提示）
    //   2. 入队 proactiveQueue 让纳西妲主动开口（陪伴感）
    perception.alert.onAlert((event) => {
      // 路 1：StatusBar toast
      windowMgr.mainWindow?.webContents.send('agent:state-change', {
        state: 'error' as const,
        reason: `[Perception:${event.type}] ${event.message}`,
        game: event.data.game ? { game: event.data.game as 'GI' | 'SR' | 'none' } : undefined,
        timestamp: event.timestamp,
      });

      // 路 2：主动开口（纳西妲"她一直在看着你"）
      proactiveQueue.enqueue(event.type, {
        game: event.data.game,
        fpsAvg: event.data.fpsAvg,
        gpuTemp: event.data.gpuTemp,
      });
    });
  }

  // 启动 Perception 监控（纯 CPU，扫描间隔长，不占 GPU）
  perception.start();

  // 注册内置工具（clock / web_fetch 等，纯 CPU 不占 GPU）
  registerBuiltinTools();

  // 异步预热模型（不阻塞启动，ollama 不可用时自动跳过）
  void warmupModel();

  // dev 模式自动打开 DevTools，方便调试
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

// 非 macOS：所有窗口关了就退
app.on('window-all-closed', () => {
  perception.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
