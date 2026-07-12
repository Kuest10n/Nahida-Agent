/**
 * T4 Perception 模块入口
 *
 * 统一导出：
 *   - ProcessScanner：游戏进程扫描
 *   - HardwareMonitor：硬件监控（温度/利用率）
 *   - AlertMonitor：报警逻辑（帧率/温度阈值）
 *
 * 使用方式：
 *   import { ProcessScanner, HardwareMonitor, AlertMonitor } from './perception';
 *
 *   const scanner = new ProcessScanner();
 *   const hardware = new HardwareMonitor();
 *   const alert = new AlertMonitor();
 *
 *   // 联动
 *   scanner.onScan(result => alert.updateScan(result));
 *   hardware.onStatus(status => alert.updateHardware(status));
 *   alert.onAlert(event => console.log('报警:', event));
 *
 *   scanner.start();
 *   hardware.start();
 */

import { ProcessScanner } from './scanner';
import { HardwareMonitor } from './hardware';
import { AlertMonitor } from './alert';

export { ProcessScanner, type ScanResult, type ScannerConfig } from './scanner';
export { HardwareMonitor, type HardwareStatus, type HardwareMonitorConfig } from './hardware';
export { AlertMonitor, type AlertEvent, type AlertType, type AlertLevel, type AlertConfig } from './alert';

/** T4 模块统一管理器（方便一键启停） */
export class PerceptionModule {
  scanner: ProcessScanner;
  hardware: HardwareMonitor;
  alert: AlertMonitor;

  constructor() {
    this.scanner = new ProcessScanner();
    this.hardware = new HardwareMonitor();
    this.alert = new AlertMonitor();

    // 联动：scanner/hardware → alert（保存引用以便 stop 时清理）
    const scanHandler = (result: Parameters<typeof this.alert.updateScan>[0]) => {
      this.alert.updateScan(result);
    };
    const statusHandler = (status: Parameters<typeof this.alert.updateHardware>[0]) => {
      this.alert.updateHardware(status);
    };

    this.scanner.onScan(scanHandler);
    this.hardware.onStatus(statusHandler);

    // 覆盖 stop 方法，确保清理监听器
    const originalStop = this.stop.bind(this);
    this.stop = () => {
      this.scanner.offScan(scanHandler);
      this.hardware.offStatus(statusHandler);
      originalStop();
    };
  }

  /** 启动全部监控 */
  start(): void {
    this.scanner.start();
    this.hardware.start();
    console.log('[Perception] module started');
  }

  /** 停止全部监控 */
  stop(): void {
    this.scanner.stop();
    this.hardware.stop();
    console.log('[Perception] module stopped');
  }

  /** 推入帧率样本（外部调用） */
  pushFps(fps: number): void {
    this.alert.pushFpsSample(fps);
  }

  /** 获取最近一次扫描结果 */
  getLastScan() {
    return this.scanner.getLastResult();
  }

  /** 获取最近一次硬件状态 */
  getLastHardware() {
    return this.hardware.getLastStatus();
  }
}