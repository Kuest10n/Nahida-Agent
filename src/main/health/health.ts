/**
 * 全局健康监控中心（Health Monitor）—— v0.9.7 L5 基础设施
 *
 * 职责：
 *   监控所有子系统的健康状态，统一管理降级链。
 *
 * 监控的子系统：
 *   - ollama       本地模型服务
 *   - gptsovits    TTS 语音合成
 *   - edge-tts     TTS 备用
 *   - network      网络连通性（云端模型/搜索依赖）
 *   - perception   感知层（GPU/帧率扫描）
 *   - mcp          MCP 工具服务
 *
 * 降级链（从高到低）：
 *   ollama OK → deepseek V4pro → local rule fallback (SOHA 模板)
 *   gptsovits OK → edge-tts → 纯文本（静音）
 *
 * 设计：
 *   - 每个子系统一个 HealthProbe，定时 ping
 *   - 状态变化时触发事件 → 主进程推送 state-change 到渲染层
 *   - 降级由 DegradeStrategy 负责模型层路由，health.ts 只负责"发现问题"
 *   - 纯 TypeScript，不占 GPU，定时探针默认 30s 一次
 */

import { EventEmitter } from 'node:events';

// ── 类型定义 ──────────────────────────────────────────────────

/** 子系统名称 */
export type SubsystemName =
  | 'ollama'
  | 'gptsovits'
  | 'edge_tts'
  | 'network'
  | 'perception'
  | 'mcp';

/** 健康状态 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/** 单个子系统的健康快照 */
export interface SubsystemHealth {
  name: SubsystemName;
  status: HealthStatus;
  /** 最后一次检查时间戳（ms） */
  lastChecked: number;
  /** 最后一次成功时间戳（ms），0 = 从未成功 */
  lastSuccess: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 错误信息（status != healthy 时有值） */
  error?: string;
  /** 延迟（ms），成功时记录 */
  latencyMs?: number;
}

/** 全局健康状态 */
export interface OverallHealth {
  /** 总体状态：所有子系统 healthy → healthy，部分 degraded → degraded，关键系统 down → unhealthy */
  overall: HealthStatus;
  /** 每个子系统的状态 */
  subsystems: Record<SubsystemName, SubsystemHealth>;
  /** 时间戳 */
  timestamp: number;
}

/** 健康检查探针接口 —— 每个子系统实现一个 */
export interface HealthProbe {
  name: SubsystemName;
  /** 检查间隔（ms） */
  intervalMs: number;
  /** 执行检查，返回是否健康 + 延迟/错误 */
  check(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
}

// ── 常量 ──────────────────────────────────────────────────────

/** 默认检查间隔：30 秒 */
const DEFAULT_CHECK_INTERVAL_MS = 30_000;

/** 连续失败 N 次 → unhealthy */
const FAILURE_THRESHOLD_UNHEALTHY = 3;

/** 连续失败 N 次 → degraded（在 unhealthy 之前） */
const FAILURE_THRESHOLD_DEGRADED = 1;

// ── 全局健康管理器 ────────────────────────────────────────────

/**
 * HealthMonitor —— 全局健康监控中心
 *
 * 用法：
 *   const health = new HealthMonitor();
 *   health.registerProbe(ollamaProbe);
 *   health.start();
 *   health.on('change', (snapshot) => { ... });
 *
 * 事件：
 *   'change'    — 任一子系统状态变化，参数 OverallHealth
 *   'degraded'  — 总体状态降级（从 healthy 变 degraded/unhealthy）
 *   'recovered' — 总体状态恢复（从 degraded/unhealthy 变 healthy）
 */
export class HealthMonitor extends EventEmitter {
  /** 子系统健康状态表 */
  private states: Record<SubsystemName, SubsystemHealth>;

  /** 已注册的探针 */
  private probes = new Map<SubsystemName, HealthProbe>();

  /** 定时器句柄 */
  private timers = new Map<SubsystemName, NodeJS.Timeout>();

  /** 是否在运行 */
  private running = false;

  constructor() {
    super();
    this.states = this.initStates();
  }

  /** 初始化所有子系统状态为 unknown */
  private initStates(): Record<SubsystemName, SubsystemHealth> {
    const now = Date.now();
    const names: SubsystemName[] = ['ollama', 'gptsovits', 'edge_tts', 'network', 'perception', 'mcp'];
    const result = {} as Record<SubsystemName, SubsystemHealth>;
    for (const name of names) {
      result[name] = {
        name,
        status: 'unknown',
        lastChecked: now,
        lastSuccess: 0,
        consecutiveFailures: 0,
      };
    }
    return result;
  }

  /**
   * 注册一个探针
   *
   * 运行中也可以注册（会立刻执行一次检查 + 启动定时器）。
   */
  registerProbe(probe: HealthProbe): void {
    this.probes.set(probe.name, probe);

    if (this.running) {
      // 立刻检查一次
      void this.runCheck(probe.name);
      // 启动定时检查
      this.scheduleCheck(probe.name);
    }
  }

  /** 启动所有探针的定时检查 */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[HealthMonitor] started');

    for (const probe of this.probes.values()) {
      // 先跑一次
      void this.runCheck(probe.name);
      // 再定时
      this.scheduleCheck(probe.name);
    }
  }

  /** 停止所有探针 */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    console.log('[HealthMonitor] stopped');
  }

  /** 获取当前全局健康快照 */
  getSnapshot(): OverallHealth {
    const subsystems = { ...this.states };

    // 计算总体状态：
    //   - 关键系统（ollama / perception）任何一个 unhealthy → 总体 unhealthy
    //   - 任何一个 degraded → 总体 degraded
    //   - 全部 healthy 或 unknown → healthy
    let overall: HealthStatus = 'healthy';

    const critical: SubsystemName[] = ['ollama', 'perception'];
    for (const name of critical) {
      if (this.states[name].status === 'unhealthy') {
        overall = 'unhealthy';
        break;
      }
    }

    if (overall === 'healthy') {
      for (const name of Object.keys(this.states) as SubsystemName[]) {
        if (this.states[name].status === 'degraded') {
          overall = 'degraded';
          break;
        }
        // 有 unknown 且数量 > 0 → 不算 degraded，算 healthy（刚启动时）
      }
    }

    return {
      overall,
      subsystems,
      timestamp: Date.now(),
    };
  }

  /** 获取单个子系统状态 */
  getStatus(name: SubsystemName): SubsystemHealth {
    return { ...this.states[name] };
  }

  /**
   * 手动报告一次成功（外部调用，比如 ollama 请求成功了顺手报一下）
   *
   * 比定时探针更及时。探针是兜底，主动报告是快速通路。
   */
  reportSuccess(name: SubsystemName, latencyMs?: number): void {
    const state = this.states[name];
    const prevStatus = state.status;

    state.status = 'healthy';
    state.lastChecked = Date.now();
    state.lastSuccess = Date.now();
    state.consecutiveFailures = 0;
    state.latencyMs = latencyMs;
    state.error = undefined;

    if (prevStatus !== 'healthy') {
      this.emitChange();
    }
  }

  /**
   * 手动报告一次失败
   */
  reportFailure(name: SubsystemName, error?: string): void {
    const state = this.states[name];
    const prevStatus = state.status;

    state.lastChecked = Date.now();
    state.consecutiveFailures += 1;
    state.error = error;

    // 根据连续失败次数更新状态
    if (state.consecutiveFailures >= FAILURE_THRESHOLD_UNHEALTHY) {
      state.status = 'unhealthy';
    } else if (state.consecutiveFailures >= FAILURE_THRESHOLD_DEGRADED) {
      state.status = 'degraded';
    }
    // 1 次失败还是 degraded（阈值就是 1）

    if (prevStatus !== state.status) {
      this.emitChange();
    }
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 调度下一次检查 */
  private scheduleCheck(name: SubsystemName): void {
    const probe = this.probes.get(name);
    if (!probe) return;

    const existing = this.timers.get(name);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.runCheck(name).finally(() => {
        if (this.running) {
          this.scheduleCheck(name);
        }
      });
    }, probe.intervalMs || DEFAULT_CHECK_INTERVAL_MS);

    this.timers.set(name, timer);
  }

  /** 执行一次检查 */
  private async runCheck(name: SubsystemName): Promise<void> {
    const probe = this.probes.get(name);
    if (!probe) return;

    try {
      const result = await probe.check();
      if (result.healthy) {
        this.reportSuccess(name, result.latencyMs);
      } else {
        this.reportFailure(name, result.error || 'probe failed');
      }
    } catch (err) {
      this.reportFailure(name, err instanceof Error ? err.message : String(err));
    }
  }

  /** 触发 change 事件 */
  private emitChange(): void {
    const snapshot = this.getSnapshot();
    this.emit('change', snapshot);

    if (snapshot.overall === 'healthy') {
      this.emit('recovered', snapshot);
    } else if (snapshot.overall === 'degraded' || snapshot.overall === 'unhealthy') {
      this.emit('degraded', snapshot);
    }

    console.log(
      `[HealthMonitor] overall=${snapshot.overall} | ` +
      Object.values(snapshot.subsystems)
        .map(s => `${s.name}=${s.status}`)
        .join(' '),
    );
  }
}

// ── 便捷探针工厂函数 ──────────────────────────────────────────

/**
 * 创建一个简单的 HTTP 探针（ollama / gptsovits / mcp 都能用）
 *
 * 发 GET 请求到 /health 或 /v1/models，200 就算 healthy。
 */
export function createHttpProbe(
  name: SubsystemName,
  url: string,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
): HealthProbe {
  return {
    name,
    intervalMs,
    async check() {
      const start = Date.now();
      try {
        // 用原生 fetch，不要引入新依赖
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const latency = Date.now() - start;

        if (res.ok) {
          return { healthy: true, latencyMs: latency };
        }
        return { healthy: false, error: `HTTP ${res.status}` };
      } catch (err) {
        return {
          healthy: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/**
 * 创建一个简单的网络连通性探针
 *
 *  ping 一个可靠目标（比如 8.8.8.8 的 HTTP，或者 baidu）
 */
export function createNetworkProbe(
  targetUrl = 'https://www.baidu.com',
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
): HealthProbe {
  return createHttpProbe('network', targetUrl, intervalMs);
}

// ── 导出单例（主进程共用一个） ────────────────────────────────

/** 全局健康监控单例 */
export const healthMonitor = new HealthMonitor();

export { DEFAULT_CHECK_INTERVAL_MS, FAILURE_THRESHOLD_UNHEALTHY, FAILURE_THRESHOLD_DEGRADED };
