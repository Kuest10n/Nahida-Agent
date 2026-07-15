import { app } from 'electron';
import { WindowManager } from './windows/manager';
import { setupIpcHandlers } from './ipc/handlers';
import { warmupModel } from './agent/agent-core';
import { registerBuiltinTools } from './tools/builtin';
import { registerCalendarTools } from './tools/calendar';
import { registerAlarmTools } from './tools/alarm';
import { PerceptionModule } from './perception';
import { ReviewLayer } from './agent/review-layer';
import { proactiveQueue } from './agent/proactive-queue';
import { createTray, destroyTray, updateTrayStatus } from './tray/tray-manager';
import { registerShortcuts, unregisterShortcuts } from './tray/shortcuts';
import { initPersonalityManager } from './memory/personality-manager';
import { emergencyFlush, loadSessions } from './memory/session-store';
import { healthMonitor, createHttpProbe, createNetworkProbe } from './health/health';
import { getConfig, getOllamaBaseUrl, loadUserConfigFromDisk } from './config/config';
import { initMaturity } from './agent/maturity';
import { cleanupAllServices } from './python/python-manager';

// 单例窗口管理器 + Perception 模块 + 主动开口 reviewer
const windowMgr = new WindowManager();
const perception = new PerceptionModule();
// 独立 reviewer 实例（避免与 handlers.ts 内部 reviewer 状态污染）
const proactiveReviewer = new ReviewLayer({ enabled: true });

// 崩溃自愈：渲染进程崩溃 → 紧急写盘 + 尝试恢复窗口
function setupCrashSurvival(): void {
  const windowsToMonitor = [windowMgr.mainWindow, windowMgr.live2dWindow].filter(Boolean);

  for (const win of windowsToMonitor) {
    if (!win) continue;

    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[CrashSurvival] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);

      // 第一步：紧急写盘，保住 session 数据
      const flushed = emergencyFlush();
      console.warn(`[CrashSurvival] emergency flushed ${flushed} sessions`);

      // 第二步：通知主窗口用户（如果主窗还活着）
      if (windowMgr.mainWindow && !windowMgr.mainWindow.isDestroyed() && win !== windowMgr.mainWindow) {
        windowMgr.mainWindow.webContents.send('agent:state-change', {
          state: 'error' as const,
          reason: `虚空屏暗了一瞬…又亮了。(${details.reason})`,
          timestamp: Date.now(),
        });
      }

      // 第三步：尝试重建崩溃的窗口（如果是 Live2D 窗崩了，重建它）
      if (win === windowMgr.live2dWindow) {
        console.warn('[CrashSurvival] Live2D window crashed — attempting to recreate');
        try {
          windowMgr.live2dWindow = null;
          const { createLive2dWindow } = require('./windows/manager');
          windowMgr.live2dWindow = createLive2dWindow();
          // 重新绑定 IPC
          if (windowMgr.mainWindow && windowMgr.live2dWindow) {
            setupIpcHandlers(windowMgr.mainWindow, windowMgr.live2dWindow);
          }
        } catch (err) {
          console.error('[CrashSurvival] failed to recreate Live2D window:', err);
        }
      }
    });
  }
}

// 健康监控：注册探针 + 绑定状态变化推送
function setupHealthMonitor(): void {
  const cfg = getConfig();

  // 1. ollama 探针（用 /api/tags 接口，轻量）
  healthMonitor.registerProbe(
    createHttpProbe('ollama', `${getOllamaBaseUrl()}/api/tags`),
  );

  // 2. GPT-SoVITS 探针（如果启用了的话）
  if (cfg.voice.ttsAdapter === 'gpt-sovits') {
    healthMonitor.registerProbe(
      createHttpProbe('gptsovits', cfg.voice.gptsovitsApiUrl, 60_000), // 60s 一次，TTS 不常用
    );
  }

  // 3. 网络探针（检查云端 API 是否可达，用 baidu 作为互联网可用性指标）
  if (cfg.api.deepseekKey) {
    healthMonitor.registerProbe(createNetworkProbe());
  }

  // 状态变化 → 推送到主窗口
  healthMonitor.on('change', (snapshot) => {
    if (!windowMgr.mainWindow || windowMgr.mainWindow.isDestroyed()) return;

    windowMgr.mainWindow.webContents.send('agent:state-change', {
      state: snapshot.overall === 'healthy' ? 'online' : snapshot.overall,
      reason: `健康状态: ${snapshot.overall}`,
      timestamp: snapshot.timestamp,
    });

    // 托盘状态同步
    if (snapshot.overall === 'healthy') {
      updateTrayStatus('online');
    } else if (snapshot.overall === 'degraded') {
      updateTrayStatus('busy');
    } else if (snapshot.overall === 'unhealthy') {
      updateTrayStatus('offline');
    }
  });

  // 启动监控
  healthMonitor.start();
}

app.whenReady().then(() => {
  // 启动时加载 session（顺便做紧急恢复）
  loadSessions();

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

      // 托盘状态：硬件报警时切到 busy
      updateTrayStatus('busy');
      setTimeout(() => updateTrayStatus('online'), 5000);
    });

    // 注册崩溃自愈监听（窗口创建完再绑）
    setupCrashSurvival();

    // 启动健康监控
    setupHealthMonitor();
  }

  perception.start();

  registerBuiltinTools();

  initPersonalityManager();

  initMaturity();

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

// 退出前紧急写盘（正常退出也走一遍，双保险）
app.on('before-quit', (event) => {
  console.warn('[App] before-quit — emergency flushing sessions');
  emergencyFlush();
});

app.on('window-all-closed', () => {
  perception.stop();
  destroyTray();
  unregisterShortcuts();
  // 退出前最后再刷一次
  emergencyFlush();
  // 清理所有 Python 子进程（防僵尸）
  cleanupAllServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
