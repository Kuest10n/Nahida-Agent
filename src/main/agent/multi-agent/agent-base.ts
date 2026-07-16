/**
 * 多 Agent 协作框架 —— Agent 基础类
 *
 * 设计原则：
 *   - 每个 Agent 专注单一职责（六顶帽中的一顶）
 *   - 统一接口：think() 方法，输入上下文，输出思考结果
 *   - 可组合：协调器聚合多个 Agent 的结果
 *   - 轻量：本地模型优先，避免额外云端开销
 */

import type { WorldbookEntry } from '../../memory/worldbook';
import type { TransformedQuery } from '../../rag/query-transform';

// ── 类型定义 ──────────────────────────────────────────────────

/** Agent 标识 */
export type AgentId = 'white' | 'red' | 'black' | 'yellow' | 'green' | 'blue';

/** Agent 思考结果 */
export interface AgentThought {
  /** Agent ID */
  agentId: AgentId;
  /** Agent 名称 */
  agentName: string;
  /** 帽子颜色 */
  hatColor: string;
  /** 思考内容 */
  content: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 思考耗时（ms） */
  latencyMs: number;
}

/** Agent 上下文 */
export interface AgentContext {
  /** 用户原始消息 */
  userMessage: string;
  /** 变换后的查询 */
  transformedQuery?: TransformedQuery;
  /** 召回的 worldbook 条目 */
  worldbookEntries?: WorldbookEntry[];
  /** 当前会话 ID */
  sessionId?: string;
}

/** Agent 配置 */
export interface AgentConfig {
  /** 是否启用此 Agent */
  enabled: boolean;
  /** 优先级（0-100） */
  priority: number;
}

// ── 基础 Agent 类 ──────────────────────────────────────────────

/**
 * Agent 基类
 *
 * 所有专家 Agent 继承此类，实现 think() 方法。
 */
export abstract class BaseAgent {
  /** Agent ID */
  abstract readonly id: AgentId;
  /** Agent 名称 */
  abstract readonly name: string;
  /** 帽子颜色 */
  abstract readonly color: string;
  /** 配置 */
  protected config: AgentConfig;

  constructor(config: AgentConfig = { enabled: true, priority: 50 }) {
    this.config = config;
  }

  /**
   * 执行思考
   *
   * @param context 思考上下文
   * @returns 思考结果
   */
  abstract think(context: AgentContext): Promise<AgentThought>;

  /**
   * 判断是否可用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 获取优先级
   */
  getPriority(): number {
    return this.config.priority;
  }

  /**
   * 创建思考结果
   */
  protected createThought(
    content: string,
    confidence: number = 0.8,
    latencyMs: number = 0,
  ): AgentThought {
    return {
      agentId: this.id,
      agentName: this.name,
      hatColor: this.color,
      content,
      confidence,
      latencyMs,
    };
  }
}