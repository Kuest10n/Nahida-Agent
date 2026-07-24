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
 *
 * v3.0.1 补充：帧差算法测试（S2）
 *   - calculateGrayDiff 纯函数边界验证
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

import { startMonitor, stopMonitor, getState, calculateGrayDiff } from '../main/vision/screen-monitor';

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

// ── 帧差算法测试（S2 补测）────────────────────────────────────

describe('calculateGrayDiff - 帧差算法', () => {
  it('相同帧应返回 0%', () => {
    const frame = new Uint8Array([100, 100, 100, 100]);
    expect(calculateGrayDiff(frame, frame)).toBe(0);
  });

  it('全黑 vs 全白应返回 100%', () => {
    const black = new Uint8Array([0, 0, 0, 0]);
    const white = new Uint8Array([255, 255, 255, 255]);
    expect(calculateGrayDiff(black, white)).toBe(100);
  });

  it('长度不一致应返回 100%', () => {
    const short = new Uint8Array([0, 0]);
    const long = new Uint8Array([0, 0, 0, 0]);
    expect(calculateGrayDiff(short, long)).toBe(100);
    expect(calculateGrayDiff(long, short)).toBe(100);
  });

  it('单像素差异应精确计算', () => {
    const frame1 = new Uint8Array([0, 0, 0, 0]);
    const frame2 = new Uint8Array([255, 0, 0, 0]);
    // 单像素差值 = 255，总最大差值 = 255 * 4 = 1020
    // 百分比 = 255 / 1020 * 100 = 25%
    expect(calculateGrayDiff(frame1, frame2)).toBeCloseTo(25, 2);
  });

  it('半黑半白应返回约 50%', () => {
    const frame1 = new Uint8Array([0, 0, 0, 0]);
    const frame2 = new Uint8Array([255, 255, 0, 0]);
    // 两像素差值 = 255 * 2 = 510，总最大差值 = 255 * 4 = 1020
    // 百分比 = 510 / 1020 * 100 = 50%
    expect(calculateGrayDiff(frame1, frame2)).toBeCloseTo(50, 2);
  });

  it('差异计算应对称（frame1 vs frame2 === frame2 vs frame1）', () => {
    const frame1 = new Uint8Array([10, 20, 30, 40]);
    const frame2 = new Uint8Array([40, 30, 20, 10]);
    expect(calculateGrayDiff(frame1, frame2)).toBe(calculateGrayDiff(frame2, frame1));
  });

  it('空数组应返回 0%（边界保护，避免 NaN）', () => {
    const empty = new Uint8Array(0);
    expect(calculateGrayDiff(empty, empty)).toBe(0);
    expect(calculateGrayDiff(empty, new Uint8Array([1, 2, 3]))).toBe(0);
    expect(calculateGrayDiff(new Uint8Array([1, 2, 3]), empty)).toBe(0);
  });

  it('随机输入结果应在 0-100 范围内', () => {
    // 生成两个随机 64x64 帧
    const frame1 = new Uint8Array(64 * 64);
    const frame2 = new Uint8Array(64 * 64);
    for (let i = 0; i < 64 * 64; i++) {
      frame1[i] = Math.floor(Math.random() * 256);
      frame2[i] = Math.floor(Math.random() * 256);
    }
    const diff = calculateGrayDiff(frame1, frame2);
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThanOrEqual(100);
  });
});
