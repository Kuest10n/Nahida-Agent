/**
 * Screen Monitor 资源钳位测试（S1 补测）
 *
 * 覆盖 VULN-004 修复后的资源失控防御：
 *   - intervalMs 钳位到 [500, 60000] ms（防止 1ms 把 CPU/磁盘打满）
 *   - threshold 钳位到 [1, 100]（防止 0% 永远触发或 200% 永不触发）
 *
 * 策略：
 *   - 真跑 startMonitor 的配置钳位纯逻辑（读取返回的 MonitorState.config 验证）
 *   - 仅 mock electron 模块的命名导出（desktopCapturer/screen/nativeImage）以让模块在非 Electron 环境加载
 *   - 不 mock 钳位逻辑本身（Math.max/Math.min 真实执行）
 *   - 每个用例立即 stopMonitor() 防止后台 monitorTick 微任务执行真实截图
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// mock electron：仅提供占位对象，钳位逻辑不依赖这些
// 必须在 import screen-monitor 之前声明（vitest 会自动 hoist）
vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([]),
  },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({ id: 'test' }),
    getAllDisplays: vi.fn().mockReturnValue([{ id: 'test' }]),
  },
  nativeImage: {
    createFromBuffer: vi.fn().mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      getBitmap: vi.fn().mockReturnValue(new Uint8Array(64 * 64 * 4)),
    }),
  },
}));

import { startMonitor, stopMonitor, getState } from '../main/vision/screen-monitor';

describe('Screen Monitor 资源钳位（VULN-004 修复）', () => {
  afterEach(() => {
    // 安全网：确保每个用例结束后监控已停止，不泄漏定时器
    stopMonitor();
  });

  it('intervalMs 应钳位到下界 500ms（防止 1ms 把 CPU 打满）', () => {
    const state = startMonitor({ intervalMs: 10 });
    stopMonitor(); // 立即停止，防止 monitorTick 微任务执行真实截图
    expect(state.config.intervalMs).toBe(500);
  });

  it('intervalMs 应钳位到上界 60000ms（防止配置异常导致监控冻结）', () => {
    const state = startMonitor({ intervalMs: 999999 });
    stopMonitor();
    expect(state.config.intervalMs).toBe(60000);
  });

  it('intervalMs 在合法区间内应保持原值', () => {
    const state1 = startMonitor({ intervalMs: 2000 });
    stopMonitor();
    expect(state1.config.intervalMs).toBe(2000);

    const state2 = startMonitor({ intervalMs: 500 });
    stopMonitor();
    expect(state2.config.intervalMs).toBe(500);

    const state3 = startMonitor({ intervalMs: 60000 });
    stopMonitor();
    expect(state3.config.intervalMs).toBe(60000);
  });

  it('threshold 应钳位到下界 1（防止 0% 永远触发分析）', () => {
    const state = startMonitor({ threshold: 0 });
    stopMonitor();
    expect(state.config.threshold).toBe(1);
  });

  it('threshold 应钳位到上界 100（防止 200% 永不触发）', () => {
    const state = startMonitor({ threshold: 200 });
    stopMonitor();
    expect(state.config.threshold).toBe(100);
  });

  it('threshold 在合法区间内应保持原值', () => {
    const state1 = startMonitor({ threshold: 5 });
    stopMonitor();
    expect(state1.config.threshold).toBe(5);

    const state2 = startMonitor({ threshold: 50 });
    stopMonitor();
    expect(state2.config.threshold).toBe(50);
  });

  it('未提供的配置项不应被钳位（保持 undefined，由默认值逻辑处理）', () => {
    const state = startMonitor({}); // 空配置
    stopMonitor();
    expect(state.config.intervalMs).toBeUndefined();
    expect(state.config.threshold).toBeUndefined();
    expect(state.config.autoAnalyze).toBeUndefined();
  });

  it('startMonitor 返回的 state 应反映钳位后的配置（与 getState 一致）', () => {
    const returnedState = startMonitor({ intervalMs: 1, threshold: 999 });
    const internalState = getState();
    stopMonitor();
    expect(returnedState.config.intervalMs).toBe(500);
    expect(returnedState.config.threshold).toBe(100);
    expect(internalState.config.intervalMs).toBe(500);
    expect(internalState.config.threshold).toBe(100);
  });

  it('重复 startMonitor 应先停止前一个监控（不泄漏定时器）', () => {
    const state1 = startMonitor({ intervalMs: 1000 });
    const state2 = startMonitor({ intervalMs: 2000 });
    stopMonitor();
    // 第二次 startMonitor 应返回新配置
    expect(state2.config.intervalMs).toBe(2000);
    // state1 是旧配置的快照，不应被第二次调用修改
    expect(state1.config.intervalMs).toBe(1000);
  });
});
