/**
 * 多 API 动态择模（v0.9.3）
 *
 * 职责：
 *   1. 管理多个 LLM API 端点（本地 ollama + 云端 DeepSeek + 其他 OpenAI 兼容 API）
 *   2. 基于模型负载、延迟、优先级进行动态路由
 *   3. 支持模型健康检查与熔断
 *
 * 设计原则：
 *   - 每个 API 端点独立维护健康状态（成功/失败计数）
 *   - 路由策略：优先级 > 延迟 > 负载均衡
 *   - 熔断机制：连续失败 N 次后暂时隔离该端点
 */

import { getConfig } from '../config/config';

// ── 类型定义 ──────────────────────────────────────────────────

/** API 端点类型 */
export type ApiEndpointType = 'ollama' | 'openai-compatible' | 'anthropic-compatible';

/** API 端点配置 */
export interface ApiEndpoint {
  /** 端点唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 端点类型 */
  type: ApiEndpointType;
  /** API 基础 URL（如 http://localhost:11434 或 https://api.deepseek.com） */
  baseUrl: string;
  /** API Key（可选，本地 ollama 不需要） */
  apiKey?: string;
  /** 支持的模型列表 */
  models: string[];
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
}

/** 端点健康状态 */
export interface EndpointHealth {
  /** 端点 ID */
  endpointId: string;
  /** 连续失败次数 */
  failCount: number;
  /** 最后成功时间戳 */
  lastSuccessAt?: number;
  /** 平均延迟（ms） */
  avgLatencyMs: number;
  /** 是否处于熔断状态 */
  circuitOpen: boolean;
}

/** 模型选择结果 */
export interface ModelSelection {
  /** 选中的端点 */
  endpoint: ApiEndpoint;
  /** 选中的模型名 */
  model: string;
  /** 选择理由 */
  reason: string;
}

/** 模型选择请求 */
export interface ModelSelectionRequest {
  /** 期望的模型档位（local/standard/flash） */
  tier: 'local' | 'standard' | 'flash';
  /** 用户消息（用于判断是否需要特定能力） */
  userMessage?: string;
  /** 是否强制使用本地模型（如网络不可用） */
  forceLocal?: boolean;
}

// ── 常量 ────────────────────────────────────────────────────

/** 熔断阈值：连续失败次数 */
const CIRCUIT_BREAKER_THRESHOLD = 3;
/** 熔断恢复时间（ms）：熔断后多久尝试恢复 */
const CIRCUIT_RECOVERY_MS = 60_000; // 1 分钟
/** 健康检查超时（ms） */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

// ── 模块状态 ──────────────────────────────────────────────────

/** 已注册的 API 端点 */
const endpoints = new Map<string, ApiEndpoint>();

/** 端点健康状态 */
const healthMap = new Map<string, EndpointHealth>();

/** 是否已初始化 */
let initialized = false;

// ── 初始化 ──────────────────────────────────────────────────

/**
 * 初始化模型选择器
 *
 * 从 config 读取默认端点，注册到 endpoints map。
 * 启动时调用一次。
 */
export function initModelSelector(): void {
  if (initialized) return;

  const config = getConfig();

  // 注册本地 ollama 端点
  registerEndpoint({
    id: 'ollama-local',
    name: '本地 Ollama',
    type: 'ollama',
    baseUrl: `http://${config.ollama.host}:${config.ollama.port}`,
    models: [config.models.local, config.models.review],
    priority: 1, // 本地优先级最高（无网络延迟）
    enabled: true,
  });

  // 注册云端 DeepSeek 端点（如果有 API key）
  if (config.api.deepseekKey) {
    registerEndpoint({
      id: 'deepseek-cloud',
      name: 'DeepSeek 云端',
      type: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: config.api.deepseekKey,
      models: [config.models.standard, config.models.flash],
      priority: 10, // 云端优先级较低（有网络延迟）
      enabled: true,
    });
  }

  initialized = true;
  console.log(`[ModelSelector] initialized with ${endpoints.size} endpoints`);
}

/**
 * 注册一个 API 端点
 *
 * 重复注册会覆盖。
 */
export function registerEndpoint(endpoint: ApiEndpoint): void {
  endpoints.set(endpoint.id, endpoint);

  // 初始化健康状态
  healthMap.set(endpoint.id, {
    endpointId: endpoint.id,
    failCount: 0,
    avgLatencyMs: 0,
    circuitOpen: false,
  });
}

// ── 模型选择 ────────────────────────────────────────────────

/**
 * 根据请求选择合适的模型
 *
 * 路由策略：
 *   1. 如果 forceLocal=true，只选本地端点
 *   2. 根据 tier 筛选支持的端点
 *   3. 排除熔断的端点
 *   4. 按优先级排序，选优先级最高的
 *   5. 如果优先级相同，选平均延迟最低的
 *
 * @param req 选择请求
 * @returns 选中的模型信息，无可用端点返回 undefined
 */
export function selectModel(req: ModelSelectionRequest): ModelSelection | undefined {
  if (!initialized) initModelSelector();

  const candidates: Array<{ endpoint: ApiEndpoint; model: string; score: number }> = [];

  for (const endpoint of endpoints.values()) {
    // 跳过未启用的端点
    if (!endpoint.enabled) continue;

    // 强制本地时跳过云端端点
    if (req.forceLocal && endpoint.type !== 'ollama') continue;

    // 根据 tier 筛选模型
    const model = matchModelForTier(endpoint, req.tier);
    if (!model) continue;

    // 检查健康状态
    const health = healthMap.get(endpoint.id);
    if (!health || health.circuitOpen) continue;

    // 计算得分（优先级越小越好，延迟越小越好）
    // 得分 = priority * 1000 + avgLatencyMs（优先级权重远大于延迟）
    const score = endpoint.priority * 1000 + health.avgLatencyMs;

    candidates.push({ endpoint, model, score });
  }

  if (candidates.length === 0) {
    console.warn('[ModelSelector] no available endpoint for tier:', req.tier);
    return undefined;
  }

  // 按得分升序排序，选得分最低的
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];

  if (!best) return undefined;

  return {
    endpoint: best.endpoint,
    model: best.model,
    reason: `priority=${best.endpoint.priority}, latency=${healthMap.get(best.endpoint.id)?.avgLatencyMs ?? 0}ms`,
  };
}

/**
 * 根据 tier 匹配端点支持的模型
 *
 * @param endpoint API 端点
 * @param tier 期望的档位
 * @returns 匹配的模型名，不匹配返回 undefined
 */
function matchModelForTier(endpoint: ApiEndpoint, tier: 'local' | 'standard' | 'flash'): string | undefined {
  const config = getConfig();

  let targetModel: string;
  switch (tier) {
    case 'local':
      targetModel = config.models.local;
      break;
    case 'standard':
      targetModel = config.models.standard;
      break;
    case 'flash':
      targetModel = config.models.flash;
      break;
  }

  // 检查端点是否支持该模型
  if (endpoint.models.includes(targetModel)) {
    return targetModel;
  }

  // 本地端点特殊处理：local tier 可以用 review 模型
  if (tier === 'local' && endpoint.type === 'ollama' && endpoint.models.includes(config.models.review)) {
    return config.models.review;
  }

  return undefined;
}

// ── 健康状态更新 ────────────────────────────────────────────

/**
 * 记录端点调用成功
 *
 * 更新平均延迟，重置失败计数。
 *
 * @param endpointId 端点 ID
 * @param latencyMs 本次调用延迟
 */
export function recordSuccess(endpointId: string, latencyMs: number): void {
  const health = healthMap.get(endpointId);
  if (!health) return;

  health.failCount = 0;
  health.lastSuccessAt = Date.now();

  // 指数移动平均更新延迟（alpha=0.3，新数据权重 30%）
  if (health.avgLatencyMs === 0) {
    health.avgLatencyMs = latencyMs;
  } else {
    health.avgLatencyMs = health.avgLatencyMs * 0.7 + latencyMs * 0.3;
  }

  // 如果处于熔断状态，恢复
  if (health.circuitOpen) {
    health.circuitOpen = false;
    console.log(`[ModelSelector] endpoint ${endpointId} recovered from circuit breaker`);
  }
}

/**
 * 记录端点调用失败
 *
 * 增加失败计数，达到阈值触发熔断。
 *
 * @param endpointId 端点 ID
 */
export function recordFailure(endpointId: string): void {
  const health = healthMap.get(endpointId);
  if (!health) return;

  health.failCount++;

  if (health.failCount >= CIRCUIT_BREAKER_THRESHOLD && !health.circuitOpen) {
    health.circuitOpen = true;
    console.warn(`[ModelSelector] endpoint ${endpointId} circuit breaker triggered (failCount=${health.failCount})`);
  }
}

/**
 * 检查熔断的端点是否可以恢复
 *
 * 遍历所有熔断的端点，如果超过恢复时间，重置失败计数。
 * 在每次模型选择时调用。
 */
export function checkCircuitRecovery(): void {
  const now = Date.now();

  for (const health of healthMap.values()) {
    if (!health.circuitOpen) continue;

    // 检查最后成功时间是否超过恢复时间
    if (health.lastSuccessAt && now - health.lastSuccessAt > CIRCUIT_RECOVERY_MS) {
      health.failCount = 0;
      health.circuitOpen = false;
      console.log(`[ModelSelector] endpoint ${health.endpointId} circuit breaker reset after recovery period`);
    }
  }
}

// ── 查询接口 ────────────────────────────────────────────────

/**
 * 获取所有已注册的端点
 */
export function listEndpoints(): ApiEndpoint[] {
  return Array.from(endpoints.values());
}

/**
 * 获取端点健康状态
 */
export function getEndpointHealth(endpointId: string): EndpointHealth | undefined {
  return healthMap.get(endpointId);
}

/**
 * 获取所有端点的健康状态
 */
export function listAllHealth(): EndpointHealth[] {
  return Array.from(healthMap.values());
}

/**
 * 启用/禁用端点
 */
export function setEndpointEnabled(endpointId: string, enabled: boolean): void {
  const endpoint = endpoints.get(endpointId);
  if (endpoint) {
    endpoint.enabled = enabled;
    console.log(`[ModelSelector] endpoint ${endpointId} ${enabled ? 'enabled' : 'disabled'}`);
  }
}
