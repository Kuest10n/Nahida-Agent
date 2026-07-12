/**
 * 硬件监控器 —— GPU/CPU 温度 + 利用率
 *
 * 职责：
 *   1. 获取 GPU 温度、利用率（通过 systeminformation npm 包）
 *   2. 获取 CPU 温度、利用率
 *   3. 获取内存使用率
 *   4. 定时轮询，供 alert.ts 判断温度过热/硬件瓶颈
 *
 * 依赖：systeminformation（跨平台，Windows 走 WMI）
 */

import si from 'systeminformation';

// ── 类型定义 ──────────────────────────────────────────────────

/** 硬件状态 */
export interface HardwareStatus {
  /** GPU 信息 */
  gpu?: {
    temperature: number; // 摄氏度
    utilization: number; // 0-1
    memoryUsed?: number; // MB
    memoryTotal?: number; // MB
  };
  /** CPU 信息 */
  cpu: {
    temperature?: number; // 摄氏度，部分系统可能拿不到
    utilization: number; // 0-1
  };
  /** 内存信息 */
  memory: {
    used: number; // GB
    total: number; // GB
    utilization: number; // 0-1
  };
  /** 时间戳 */
  timestamp: number;
}

/** 监控器配置 */
export interface HardwareMonitorConfig {
  /** 轮询间隔 ms，默认 5000 */
  intervalMs?: number;
  /** 是否获取 GPU 信息，默认 true */
  enableGpu?: boolean;
}

// ── 监控器主体 ────────────────────────────────────────────────

export class HardwareMonitor {
  private intervalMs: number;
  private enableGpu: boolean;
  private lastStatus: HardwareStatus | null = null;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(status: HardwareStatus) => void> = [];

  constructor(config: HardwareMonitorConfig = {}) {
    this.intervalMs = config.intervalMs ?? 5000;
    this.enableGpu = config.enableGpu ?? true;
  }

  /** 启动定时监控 */
  start(): void {
    if (this.timer) return;

    // 立即获取一次
    this.collect();

    // 定时轮询
    this.timer = setInterval(() => {
      this.collect();
    }, this.intervalMs);

    console.log(`[Hardware] started, interval=${this.intervalMs}ms`);
  }

  /** 停止监控 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Hardware] stopped');
    }
  }

  /** 注册监听器 */
  onStatus(listener: (status: HardwareStatus) => void): void {
    this.listeners.push(listener);
  }

  /** 移除监听器 */
  offStatus(listener: (status: HardwareStatus) => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /** 获取最近一次状态 */
  getLastStatus(): HardwareStatus | null {
    return this.lastStatus;
  }

  /** 手动获取一次状态（不依赖定时器） */
  async getStatus(): Promise<HardwareStatus> {
    return this.collectOnce();
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 定时收集（异步，不阻塞定时器） */
  private collect(): void {
    this.collectOnce()
      .then((status) => {
        this.lastStatus = status;

        // 通知监听器
        for (const listener of this.listeners) {
          try {
            listener(status);
          } catch (e) {
            console.error('[Hardware] listener error:', e);
          }
        }
      })
      .catch((e) => {
        console.error('[Hardware] collect failed:', e);
      });
  }

  /** 单次收集 */
  private async collectOnce(): Promise<HardwareStatus> {
    // 并行获取所有数据，包括 CPU 温度（避免串行等待）
    const [cpuLoad, cpuTemp, memData, gpuData] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature().catch(() => ({ main: undefined })),
      si.mem(),
      this.enableGpu
        ? si.graphics().catch(() => null)
        : Promise.resolve(null),
    ]);

    const gpuResult = gpuData?.controllers?.[0]
      ? {
          temperature: gpuData.controllers[0].temperatureGpu ?? 0,
          utilization: (gpuData.controllers[0].utilizationGpu ?? 0) / 100,
          memoryUsed: gpuData.controllers[0].memoryUsed,
          memoryTotal: gpuData.controllers[0].memoryTotal,
        }
      : undefined;

    return {
      gpu: gpuResult,
      cpu: {
        temperature: cpuTemp.main ?? undefined,
        utilization: cpuLoad.currentLoad / 100,
      },
      memory: {
        used: memData.used / 1024 / 1024 / 1024,
        total: memData.total / 1024 / 1024 / 1024,
        utilization: memData.used / memData.total,
      },
      timestamp: Date.now(),
    };
  }
}