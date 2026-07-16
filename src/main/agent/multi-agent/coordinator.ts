/**
 * 多 Agent 协调器 —— 六顶帽模式管理
 *
 * 职责：
 *   1. 管理六顶帽模式的启用/禁用状态（类似 /think）
 *   2. 并行执行六个专家 Agent 的思考
 *   3. 聚合思考结果，注入主模型 system prompt
 *   4. 提供 /hat 命令接口（启用/禁用六顶帽模式）
 *
 * 模式切换：
 *   - 用户发送 "/hat" 命令 → 切换六顶帽模式（开/关）
 *   - 启用后，每条消息前由六顶帽并行审查
 *   - 结果聚合后作为主模型的思考辅助上下文
 */

import { BaseAgent, type AgentContext, type AgentThought, type AgentId } from './agent-base';
import { SIX_HATS_AGENTS } from './six-hats';

// ── 类型定义 ──────────────────────────────────────────────────

/** 协调器配置 */
export interface CoordinatorConfig {
  /** 是否启用多 Agent（全局开关） */
  enabled: boolean;
  /** 默认模式（开/关） */
  defaultMode: boolean;
  /** 并行执行超时时间（ms） */
  timeoutMs: number;
}

/** 协调器状态 */
export interface CoordinatorState {
  /** 当前模式（开/关） */
  hatModeEnabled: boolean;
  /** 上次切换时间 */
  lastToggleTime: number;
  /** 已执行的思考次数 */
  thoughtCount: number;
}

/** 协调器执行结果 */
export interface CoordinatorResult {
  /** 是否启用了六顶帽模式 */
  hatModeEnabled: boolean;
  /** 各 Agent 的思考结果 */
  thoughts: AgentThought[];
  /** 聚合后的思考摘要（注入 system prompt） */
  summary: string;
  /** 总耗时（ms） */
  totalLatencyMs: number;
  /** 参与思考的 Agent 数量 */
  agentCount: number;
}

// ── 默认配置 ──────────────────────────────────────────────────

const DEFAULT_CONFIG: CoordinatorConfig = {
  enabled: true,
  defaultMode: false,
  timeoutMs: 5000,
};

// ── 协调器类 ──────────────────────────────────────────────────

/**
 * 多 Agent 协调器
 *
 * 管理六顶帽模式，并行执行专家 Agent，聚合结果。
 */
export class MultiAgentCoordinator {
  /** 配置 */
  private config: CoordinatorConfig;
  /** 状态 */
  private state: CoordinatorState;
  /** 已初始化的 Agent 实例 */
  private agents: Map<AgentId, BaseAgent> = new Map();

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      hatModeEnabled: this.config.defaultMode,
      lastToggleTime: Date.now(),
      thoughtCount: 0,
    };
    this.initAgents();
  }

  /**
   * 初始化所有 Agent
   */
  private initAgents(): void {
    for (const AgentClass of SIX_HATS_AGENTS) {
      const agent = new AgentClass();
      this.agents.set(agent.id, agent);
    }
    console.log(`[Coordinator] initialized ${this.agents.size} agents`);
  }

  /**
   * 切换六顶帽模式（开/关）
   *
   * @returns 切换后的状态
   */
  toggleHatMode(): boolean {
    this.state.hatModeEnabled = !this.state.hatModeEnabled;
    this.state.lastToggleTime = Date.now();
    console.log(`[Coordinator] hat mode ${this.state.hatModeEnabled ? 'enabled' : 'disabled'}`);
    return this.state.hatModeEnabled;
  }

  /**
   * 设置六顶帽模式状态
   */
  setHatMode(enabled: boolean): void {
    if (this.state.hatModeEnabled !== enabled) {
      this.state.hatModeEnabled = enabled;
      this.state.lastToggleTime = Date.now();
      console.log(`[Coordinator] hat mode ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * 获取当前模式状态
   */
  isHatModeEnabled(): boolean {
    return this.state.hatModeEnabled && this.config.enabled;
  }

  /**
   * 获取协调器状态
   */
  getState(): CoordinatorState {
    return { ...this.state };
  }

  /**
   * 执行六顶帽思考（并行）
   *
   * @param context 思考上下文
   * @returns 协调器执行结果
   */
  async execute(context: AgentContext): Promise<CoordinatorResult> {
    const startTime = Date.now();

    // 如果未启用六顶帽模式，直接返回空结果
    if (!this.isHatModeEnabled()) {
      return {
        hatModeEnabled: false,
        thoughts: [],
        summary: '',
        totalLatencyMs: 0,
        agentCount: 0,
      };
    }

    // 获取所有可用 Agent
    const enabledAgents = Array.from(this.agents.values()).filter(a => a.isEnabled());

    // 并行执行所有 Agent
    const promises = enabledAgents.map(agent =>
      Promise.race([
        agent.think(context),
        new Promise<AgentThought>((_, reject) =>
          setTimeout(() => reject(new Error(`Agent ${agent.id} timed out`)), this.config.timeoutMs),
        ),
      ]),
    );

    // 等待所有结果（失败的 Agent 跳过）
    const thoughts: AgentThought[] = [];
    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        thoughts.push(result.value);
      } else {
        console.warn(`[Coordinator] agent failed: ${result.reason}`);
      }
    }

    // 按优先级排序
    thoughts.sort((a, b) => b.confidence - a.confidence);

    // 生成聚合摘要
    const summary = this.generateSummary(thoughts);

    // 更新状态
    this.state.thoughtCount++;

    const totalLatencyMs = Date.now() - startTime;

    console.log(`[Coordinator] executed ${thoughts.length} agents in ${totalLatencyMs}ms`);

    return {
      hatModeEnabled: true,
      thoughts,
      summary,
      totalLatencyMs,
      agentCount: thoughts.length,
    };
  }

  /**
   * 生成聚合摘要（注入 system prompt）
   *
   * 将六个 Agent 的思考结果压缩成一段可读的提示文本。
   */
  private generateSummary(thoughts: AgentThought[]): string {
    if (thoughts.length === 0) return '';

    const parts: string[] = [];

    // 白帽（事实）
    const white = thoughts.find(t => t.agentId === 'white');
    if (white) {
      parts.push(`事实数据：${white.content.replace('[白帽·事实] ', '').substring(0, 150)}`);
    }

    // 红帽（情感）
    const red = thoughts.find(t => t.agentId === 'red');
    if (red) {
      parts.push(`用户情绪：${red.content.replace('[红帽·情感] ', '').substring(0, 100)}`);
    }

    // 黑帽（风险）
    const black = thoughts.find(t => t.agentId === 'black');
    if (black) {
      parts.push(`风险提示：${black.content.replace('[黑帽·风险] ', '').substring(0, 100)}`);
    }

    // 黄帽（价值）
    const yellow = thoughts.find(t => t.agentId === 'yellow');
    if (yellow) {
      parts.push(`正向价值：${yellow.content.replace('[黄帽·价值] ', '').substring(0, 100)}`);
    }

    // 绿帽（创意）
    const green = thoughts.find(t => t.agentId === 'green');
    if (green) {
      parts.push(`创意方向：${green.content.replace('[绿帽·创意] ', '').substring(0, 100)}`);
    }

    // 蓝帽（协调）
    const blue = thoughts.find(t => t.agentId === 'blue');
    if (blue) {
      parts.push(`建议流程：${blue.content.replace('[蓝帽·协调] ', '').substring(0, 150)}`);
    }

    if (parts.length > 0) {
      return `\n[六顶帽思考] ${parts.join('；')}`;
    }

    return '';
  }

  /**
   * 获取所有已注册的 Agent
   */
  getAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取指定 Agent
   */
  getAgent(id: AgentId): BaseAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * 重置协调器状态（测试用）
   */
  reset(): void {
    this.state = {
      hatModeEnabled: this.config.defaultMode,
      lastToggleTime: Date.now(),
      thoughtCount: 0,
    };
  }
}

// ── 全局单例 ──────────────────────────────────────────────────

let globalCoordinator: MultiAgentCoordinator | null = null;

/**
 * 获取全局协调器实例
 */
export function getCoordinator(): MultiAgentCoordinator {
  if (!globalCoordinator) {
    globalCoordinator = new MultiAgentCoordinator();
  }
  return globalCoordinator;
}

/**
 * 初始化协调器（启动时调用）
 */
export function initCoordinator(config?: Partial<CoordinatorConfig>): void {
  if (!globalCoordinator) {
    globalCoordinator = new MultiAgentCoordinator(config);
  }
}