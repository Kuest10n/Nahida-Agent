/**
 * 三级降级策略（Degrade Strategy）—— 借鉴 Xiaoda degradation_strategy.py
 *
 * 三级模型层级（高 → 低）：
 *   Tier 1 标准  — 云端 DeepSeek V4pro（主力，长链 Plan-Act）
 *   Tier 2 Flash — 云端 DeepSeek V4pro + 短 CoT（超时/429 时降级）
 *   Tier 3 本地  — Qwen3-8B /nothink（断网/503 时降级，纳西妲腔保底）
 *
 * 降级触发条件：
 *   timeout — 请求超时（>30s）
 *   429     — 限流
 *   503     — 服务不可用（含 500/502 等 5xx 非 429）
 *   offline — 网络断开
 *
 * 降级标记带 reason 字段，渲染层从 SOHA.md [特殊场景] 取纳西妲腔模板。
 * 熔断器：连续失败 3 次自动跳到下一 Tier，冷却 60s 后尝试恢复。
 */

// ── 类型定义 ──────────────────────────────────────────────────

/** 模型层级 */
export type ModelTier = 'standard' | 'flash' | 'local';

/** 降级原因 */
export type DegradeReason = 'timeout' | '429' | '503' | 'offline' | 'unavailable';

/** 降级决策（路由层根据此结果选模型） */
export interface DegradeDecision {
  /** 当前应使用的模型层级 */
  tier: ModelTier;
  /** 降级原因（tier < standard 时有值） */
  reason?: DegradeReason;
  /** 是否触发了降级（用于推送 state-change 给渲染层） */
  degraded: boolean;
  /** 模型标识（由配置注入，不写死） */
  modelId: string;
  /** 熔断器是否打开（打开时该 Tier 暂不可用） */
  circuitOpen: boolean;
}

/** 降级提示模板 key（渲染层据此从 SOHA.md 取纳西妲腔模板） */
export type DegradeTemplateKey = 'offline' | 'timeout' | '429' | 'unavailable';

// ── 常量 ──────────────────────────────────────────────────────

/** 熔断器阈值：连续失败 N 次跳到下一 Tier */
const CIRCUIT_FAILURE_THRESHOLD = 3;
/** 熔断器冷却时间：60s 后尝试恢复 */
const CIRCUIT_COOLDOWN_MS = 60_000;
/** 请求超时阈值：30s */
const REQUEST_TIMEOUT_MS = 30_000;

import { getConfig } from '../config/config';

/**
 * Tier → 默认 modelId 映射（从配置层读取）
 */
function getDefaultModelIds(): Record<ModelTier, string> {
  const { models } = getConfig();
  return {
    standard: models.standard,
    flash: models.flash,
    local: models.local,
  };
}

// ── 熔断器（每个 Tier 独立） ──────────────────────────────────

/** 单个 Tier 的熔断状态 */
interface CircuitState {
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 熔断打开时间戳（0 = 未打开） */
  openedAt: number;
}

// ── 降级策略主体 ──────────────────────────────────────────────

/**
 * 降级策略管理器
 *
 * 每个 AgentCore 实例持有一个。调用 `reportSuccess()` / `reportFailure()`
 * 更新熔断器状态，调用 `getDecision()` 获取当前应使用的模型层级。
 */
export class DegradeStrategy {
  /** 三个 Tier 的熔断状态 */
  private circuits: Record<ModelTier, CircuitState> = {
    standard: { consecutiveFailures: 0, openedAt: 0 },
    flash: { consecutiveFailures: 0, openedAt: 0 },
    local: { consecutiveFailures: 0, openedAt: 0 }, // local 不熔断（保底层）
  };

  /** 自定义 modelId（由配置注入，覆盖默认值） */
  private modelIdOverrides: Partial<Record<ModelTier, string>> = {};

  /** 设置模型 ID（从 .env / config.yaml 注入） */
  setModelId(tier: ModelTier, modelId: string): void {
    this.modelIdOverrides[tier] = modelId;
  }

  /**
   * 获取当前降级决策
   *
   * 从最高 Tier 开始找，跳过熔断打开的，找到第一个可用的。
   * local Tier 永不熔断（保底层兜底）。
   */
  getDecision(): DegradeDecision {
    const now = Date.now();
    const tiers: ModelTier[] = ['standard', 'flash', 'local'];
    let lastReason: DegradeReason | undefined;

    for (const tier of tiers) {
      const circuit = this.circuits[tier];
      const isOpen = this.isCircuitOpen(tier, now);

      if (isOpen) {
        // 记录熔断原因，传给下一 Tier 的 decision
        lastReason = this.circuitReason(tier);
        continue;
      }

      // 找到可用 Tier
      const degraded = tier !== 'standard';
      return {
        tier,
        reason: degraded ? lastReason : undefined,
        degraded,
        modelId: this.modelIdOverrides[tier] ?? getDefaultModelIds()[tier],
        circuitOpen: false,
      };
    }

    // 所有 Tier 都熔断（极端情况）→ 强制用 local
    return {
      tier: 'local',
      reason: lastReason ?? 'unavailable',
      degraded: true,
      modelId: this.modelIdOverrides.local ?? getDefaultModelIds().local,
      circuitOpen: true,
    };
  }

  /** 报告调用成功 → 重置该 Tier 熔断器 */
  reportSuccess(tier: ModelTier): void {
    this.circuits[tier].consecutiveFailures = 0;
    this.circuits[tier].openedAt = 0;
  }

  /**
   * 报告调用失败 → 累加失败次数，达到阈值开熔断
   * @param tier  失败的 Tier
   * @param reason 失败原因
   */
  reportFailure(tier: ModelTier, reason: DegradeReason): void {
    // local Tier 不熔断（底层兜底，熔了就没路了）
    if (tier === 'local') return;

    const circuit = this.circuits[tier];
    circuit.consecutiveFailures += 1;

    if (circuit.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuit.openedAt = Date.now();
    }
  }

  /**
   * 将降级原因映射为模板 key（渲染层从 SOHA.md 取纳西妲腔模板）
   *
   * SOHA.md [特殊场景] 模板示例：
   *   offline:    （虚空屏暗了一瞬…云端去须弥朝圣了，先让我本地看着）
   *   timeout:    （草元素光晕晃了晃）…刚才那阵风有点远，我没听清。再问一次？
   *   429:        （指尖停在计算阵列上）…那边排队呢，先换个思路？
   *   unavailable:（虚空屏暗了一瞬…那边的机关阵列今晚有点闹脾气，先让我本地看着）
   */
  static reasonToTemplateKey(reason: DegradeReason): DegradeTemplateKey {
    // 5xx 非 429 归 unavailable
    if (reason === '503') return 'unavailable';
    if (reason === 'timeout') return 'timeout';
    if (reason === '429') return '429';
    if (reason === 'offline') return 'offline';
    return 'unavailable'; // 默认走 unavailable
  }

  // ── 内部方法 ────────────────────────────────────────────────

  /** 检查 Tier 熔断器是否打开（含冷却恢复判定） */
  private isCircuitOpen(tier: ModelTier, now: number): boolean {
    if (tier === 'local') return false; // local 永不熔断

    const circuit = this.circuits[tier];
    if (circuit.openedAt === 0) return false;

    // 冷却期过了 → 关闭熔断，给一次重试机会
    if (now - circuit.openedAt > CIRCUIT_COOLDOWN_MS) {
      circuit.openedAt = 0;
      circuit.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  /** 根据 Tier 推断熔断原因（用于传递给下一 Tier 的 decision） */
  private circuitReason(tier: ModelTier): DegradeReason {
    switch (tier) {
      case 'standard': return 'timeout';  // standard 熔断通常是超时
      case 'flash':    return '429';      // flash 熔断通常是限流
      default:         return 'unavailable';
    }
  }
}

// ── 导出常量供外部引用 ────────────────────────────────────────

export { REQUEST_TIMEOUT_MS, CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_COOLDOWN_MS };
