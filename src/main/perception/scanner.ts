/**
 * 进程扫描器 —— 识别游戏进程 + 窗口标题
 *
 * 职责：
 *   1. 扫描系统进程，识别米哈游游戏（原神/崩铁/绝区零）
 *   2. 读取窗口标题，判断游戏状态（主界面/战斗/加载）
 *   3. 定时轮询（默认 2s 间隔），供 alert.ts 判断 Low 帧/卡顿
 *
 * 硬件依赖：Windows API（tasklist + PowerShell Get-Process）
 * 不依赖第三方库，纯 Node 原生实现
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ── 游戏进程名映射 ─────────────────────────────────────────────

/** 已知的游戏进程名（可扩展） */
const GAME_PROCESSES: Record<string, { name: string; shortName: string }> = {
  'GenshinImpact.exe': { name: '原神', shortName: 'GI' },
  'YuanShen.exe': { name: '原神', shortName: 'GI' }, // 国服旧名
  'StarRail.exe': { name: '崩坏：星穹铁道', shortName: 'HSR' },
  'ZenlessZoneZero.exe': { name: '绝区零', shortName: 'ZZZ' },
  'HonkaiImpact3.exe': { name: '崩坏3', shortName: 'HI3' },
};

// ── 类型定义 ──────────────────────────────────────────────────

/** 扫描结果 */
export interface ScanResult {
  /** 是否检测到游戏 */
  detected: boolean;
  /** 游戏信息（检测到时填充） */
  game?: {
    name: string;
    shortName: string;
    processId: number;
  };
  /** 窗口标题（如果有） */
  windowTitle?: string;
  /** 扫描时间戳 */
  timestamp: number;
}

/** 扫描器配置 */
export interface ScannerConfig {
  /** 轮询间隔 ms，默认 2000 */
  intervalMs?: number;
  /** 是否启用窗口标题检测，默认 true */
  enableWindowTitle?: boolean;
}

// ── 扫描器主体 ────────────────────────────────────────────────

export class ProcessScanner {
  private intervalMs: number;
  private enableWindowTitle: boolean;
  private lastResult: ScanResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(result: ScanResult) => void> = [];

  constructor(config: ScannerConfig = {}) {
    this.intervalMs = config.intervalMs ?? 2000;
    this.enableWindowTitle = config.enableWindowTitle ?? true;
  }

  /** 启动定时扫描 */
  start(): void {
    if (this.timer) return;

    // 立即扫一次
    this.scan();

    // 定时轮询
    this.timer = setInterval(() => {
      this.scan();
    }, this.intervalMs);

    console.log(`[Scanner] started, interval=${this.intervalMs}ms`);
  }

  /** 停止扫描 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Scanner] stopped');
    }
  }

  /** 注册监听器（每次扫描结果回调） */
  onScan(listener: (result: ScanResult) => void): void {
    this.listeners.push(listener);
  }

  /** 移除监听器 */
  offScan(listener: (result: ScanResult) => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /** 获取最近一次扫描结果 */
  getLastResult(): ScanResult | null {
    return this.lastResult;
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 执行一次扫描 */
  private async scan(): Promise<void> {
    try {
      const processes = await this.listProcesses();

      // 匹配第一个游戏进程
      let gameInfo: ScanResult['game'];
      for (const proc of processes) {
        const game = GAME_PROCESSES[proc.name];
        if (game) {
          gameInfo = {
            name: game.name,
            shortName: game.shortName,
            processId: proc.pid,
          };
          break;
        }
      }

      // 获取窗口标题（如果启用且检测到游戏）
      let windowTitle: string | undefined;
      if (gameInfo && this.enableWindowTitle) {
        windowTitle = await this.getWindowTitle(gameInfo.processId);
      }

      const result: ScanResult = {
        detected: !!gameInfo,
        game: gameInfo,
        windowTitle,
        timestamp: Date.now(),
      };

      this.lastResult = result;

      for (const listener of this.listeners) {
        try {
          listener(result);
        } catch (e) {
          console.error('[Scanner] listener error:', e);
        }
      }
    } catch (e) {
      console.error('[Scanner] scan failed:', e);
    }
  }

  /** 列出所有进程（Windows: tasklist） */
  private async listProcesses(): Promise<Array<{ name: string; pid: number }>> {
    try {
      const { stdout } = await execAsync('tasklist /fo csv /nh', {
        windowsHide: true,
      });

      const lines = stdout.trim().split('\n');
      const processes: Array<{ name: string; pid: number }> = [];

      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)"/);
        if (match && match[1] && match[2]) {
          processes.push({
            name: match[1],
            pid: parseInt(match[2], 10),
          });
        }
      }

      return processes;
    } catch (e: any) {
      if (e.stdout) {
        const lines = e.stdout.trim().split('\n');
        const processes: Array<{ name: string; pid: number }> = [];
        for (const line of lines) {
          const match = line.match(/"([^"]+)","(\d+)"/);
          if (match && match[1] && match[2]) {
            processes.push({
              name: match[1],
              pid: parseInt(match[2], 10),
            });
          }
        }
        return processes;
      }
      throw e;
    }
  }

  /** 获取进程的窗口标题（Windows: PowerShell Get-Process） */
  private async getWindowTitle(pid: number): Promise<string | undefined> {
    try {
      const ps = `
        $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowTitle) { $p.MainWindowTitle }
      `;
      const { stdout } = await execAsync(`powershell -Command "${ps}"`, {
        windowsHide: true,
      });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}