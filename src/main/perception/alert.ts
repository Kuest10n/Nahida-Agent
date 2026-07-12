/**
 * 报警器 —— 帧率/Low帧/温度阈值检测
 *
 * 职责：
 *   1. 收集帧率样本（外部推入），计算平均帧率 + Low帧率（低于阈值的占比）
 *   2. 整合 scanner 的游戏检测结果 + hardware 的温度/利用率数据
 *   3. 触发报警（通过回调），供主进程推送通知给用户
 *
 * 报警类型：
 *   - Low帧：平均帧率 < 阈值 或 Low帧占比 > 阈值
 *   - 过热：GPU/CPU 温度 > 阈值
 *   - 硬件瓶颈：GPU/CPU 利用率持续高 + 帧率低
 */

import type { ScanResult } from './scanner';
import type { HardwareStatus } from './hardware';

// ── 类型定义 ──────────────────────────────────────────────────

/** 报警类型 */
export type AlertType = 'low_fps' | 'overheat_gpu' | 'overheat_cpu' | 'hardware_bottleneck';

/** 报警级别 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/** 报警事件 */
export interface AlertEvent {
  type: AlertType;
  level: AlertLevel;
  message: string;
  data: {
    fpsAvg?: number;
    fpsLow?: number;
    fpsLowRatio?: number;
    gpuTemp?: number;
    cpuTemp?: number;
    gpuUtil?: number;
    cpuUtil?: number;
    game?: string;
  };
  timestamp: number;
}

/** 报警器配置 */
export interface AlertConfig {
  /** 帧率阈值，低于此为 Low 帧，默认 45 */
  lowFpsThreshold?: number;
  /** Low 帧占比阈值（0-1），超过则报警，默认 0.2（20%） */
  lowFpsRatioThreshold?: number;
  /** GPU 温度阈值，默认 85°C */
  gpuTempThreshold?: number;
  /** CPU 温度阈值，默认 90°C */
  cpuTempThreshold?: number;
  /** 硬件利用率阈值，默认 0.95（95%） */
  utilThreshold?: number;
  /** 帧率样本窗口大小，默认 60（约1秒@60fps） */
  fpsWindowSize?: number;
  /** 报警冷却时间 ms，同一类型报警间隔，默认 30000 */
  cooldownMs?: number;
}

// ── 报警器主体 ────────────────────────────────────────────────

export class AlertMonitor {
  // 配置
  private lowFpsThreshold: number;
  private lowFpsRatioThreshold: number;
  private gpuTempThreshold: number;
  private cpuTempThreshold: number;
  private utilThreshold: number;
  private fpsWindowSize: number;
  private cooldownMs: number;

  // 状态
  private fpsSamples: number[] = [];
  private lastScan: ScanResult | null = null;
  private lastHardware: HardwareStatus | null = null;
  private lastAlertTime: Record<AlertType, number> = {
    low_fps: 0,
    overheat_gpu: 0,
    overheat_cpu: 0,
    hardware_bottleneck: 0,
  };
  private listeners: Array<(event: AlertEvent) => void> = [];

  constructor(config: AlertConfig = {}) {
    this.lowFpsThreshold = config.lowFpsThreshold ?? 45;
    this.lowFpsRatioThreshold = config.lowFpsRatioThreshold ?? 0.2;
    this.gpuTempThreshold = config.gpuTempThreshold ?? 85;
    this.cpuTempThreshold = config.cpuTempThreshold ?? 90;
    this.utilThreshold = config.utilThreshold ?? 0.95;
    this.fpsWindowSize = config.fpsWindowSize ?? 60;
    this.cooldownMs = config.cooldownMs ?? 30000;
  }

  /** 推入帧率样本（外部调用，如游戏帧率监控工具） */
  pushFpsSample(fps: number): void {
    this.fpsSamples.push(fps);

    // 保持窗口大小
    if (this.fpsSamples.length > this.fpsWindowSize) {
      this.fpsSamples.shift();
    }

    // 样本够了就检测一次
    if (this.fpsSamples.length >= this.fpsWindowSize) {
      this.checkFps();
    }
  }

  /** 更新游戏扫描结果（从 scanner 推入） */
  updateScan(scan: ScanResult): void {
    this.lastScan = scan;
    this.checkAll();
  }

  /** 更新硬件状态（从 hardware 推入） */
  updateHardware(hardware: HardwareStatus): void {
    this.lastHardware = hardware;
    this.checkAll();
  }

  /** 注册监听器 */
  onAlert(listener: (event: AlertEvent) => void): void {
    this.listeners.push(listener);
  }

  /** 移除监听器 */
  offAlert(listener: (event: AlertEvent) => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 综合检测（整合 scanner + hardware） */
  private checkAll(): void {
    this.checkTemperature();
    this.checkHardwareBottleneck();
  }

  /** 检测帧率 */
  private checkFps(): void {
    if (!this.hasEnoughFpsSamples()) return;

    const { avg, lowRatio } = this.calculateFpsMetrics();

    if (avg < this.lowFpsThreshold || lowRatio > this.lowFpsRatioThreshold) {
      this.emit({
        type: 'low_fps',
        level: avg < 30 ? 'critical' : avg < 45 ? 'warning' : 'info',
        message: `帧率偏低：平均 ${avg.toFixed(1)} fps，Low帧占比 ${(lowRatio * 100).toFixed(1)}%`,
        data: {
          fpsAvg: avg,
          fpsLow: Math.min(...this.fpsSamples),
          fpsLowRatio: lowRatio,
          game: this.lastScan?.game?.name,
        },
        timestamp: Date.now(),
      });
    }
  }

  /** 检测温度 */
  private checkTemperature(): void {
    if (!this.lastHardware) return;

    const { gpu, cpu } = this.lastHardware;

    // GPU 过热
    if (gpu?.temperature && gpu.temperature > this.gpuTempThreshold) {
      this.emit({
        type: 'overheat_gpu',
        level: gpu.temperature > 90 ? 'critical' : 'warning',
        message: `GPU 温度过高：${gpu.temperature.toFixed(1)}°C`,
        data: {
          gpuTemp: gpu.temperature,
          gpuUtil: gpu.utilization,
          game: this.lastScan?.game?.name,
        },
        timestamp: Date.now(),
      });
    }

    // CPU 过热
    if (cpu.temperature && cpu.temperature > this.cpuTempThreshold) {
      this.emit({
        type: 'overheat_cpu',
        level: cpu.temperature > 95 ? 'critical' : 'warning',
        message: `CPU 温度过高：${cpu.temperature.toFixed(1)}°C`,
        data: {
          cpuTemp: cpu.temperature,
          cpuUtil: cpu.utilization,
          game: this.lastScan?.game?.name,
        },
        timestamp: Date.now(),
      });
    }
  }

  /** 检测硬件瓶颈（利用率高 + 帧率低） */
  private checkHardwareBottleneck(): void {
    if (!this.lastHardware || !this.hasEnoughFpsSamples()) return;

    const { avg: avgFps } = this.calculateFpsMetrics();
    const { gpu, cpu } = this.lastHardware;

    // GPU 瓶颈：GPU利用率高 + 帧率低
    if (gpu?.utilization && gpu.utilization > this.utilThreshold && avgFps < this.lowFpsThreshold) {
      this.emit({
        type: 'hardware_bottleneck',
        level: 'warning',
        message: `GPU 瓶颈：利用率 ${(gpu.utilization * 100).toFixed(1)}%，帧率 ${avgFps.toFixed(1)} fps`,
        data: {
          fpsAvg: avgFps,
          gpuUtil: gpu.utilization,
          gpuTemp: gpu.temperature,
          game: this.lastScan?.game?.name,
        },
        timestamp: Date.now(),
      });
    }

    // CPU 瓶颈：CPU利用率高 + 帧率低
    if (cpu.utilization > this.utilThreshold && avgFps < this.lowFpsThreshold) {
      this.emit({
        type: 'hardware_bottleneck',
        level: 'warning',
        message: `CPU 瓶颈：利用率 ${(cpu.utilization * 100).toFixed(1)}%，帧率 ${avgFps.toFixed(1)} fps`,
        data: {
          fpsAvg: avgFps,
          cpuUtil: cpu.utilization,
          cpuTemp: cpu.temperature,
          game: this.lastScan?.game?.name,
        },
        timestamp: Date.now(),
      });
    }
  }

  /** 判断是否有足够的帧率样本 */
  private hasEnoughFpsSamples(): boolean {
    return this.fpsSamples.length >= this.fpsWindowSize;
  }

  /** 计算帧率指标（避免重复计算） */
  private calculateFpsMetrics(): { avg: number; lowRatio: number } {
    const sum = this.fpsSamples.reduce((a, b) => a + b, 0);
    const avg = sum / this.fpsSamples.length;
    const lowCount = this.fpsSamples.filter((f) => f < this.lowFpsThreshold).length;
    const lowRatio = lowCount / this.fpsSamples.length;
    return { avg, lowRatio };
  }

  /** 发射报警（带冷却） */
  private emit(event: AlertEvent): void {
    // 检查冷却时间
    const lastTime = this.lastAlertTime[event.type] ?? 0;
    if (Date.now() - lastTime < this.cooldownMs) {
      return; // 还在冷却中
    }

    this.lastAlertTime[event.type] = Date.now();

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[Alert] listener error:', e);
      }
    }
  }
}