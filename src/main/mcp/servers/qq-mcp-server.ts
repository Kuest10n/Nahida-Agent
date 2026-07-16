/**
 * QQ MCP Server 框架 —— v0.8.5
 *
 * 职责：
 *   提供 QQ 消息收发能力的 MCP Server 框架（预留接口）
 *
 * 协议：
 *   stdio 模式，主进程通过 MCP Client 接入
 *
 * 工具清单（预留）：
 *   - qq_send      : 发送 QQ 消息
 *   - qq_receive   : 接收 QQ 消息
 *   - qq_list      : 列出 QQ 好友/群
 *
 * 依赖：
 *   需要配置 QQ Bot API 或第三方 QQ 协议库
 */

import { z } from 'zod';

// ── 类型定义 ──────────────────────────────────────────────────

/** MCP Server 配置 */
interface QQMcpConfig {
  apiEndpoint: string;
  accessToken: string;
}

// ── 工具定义（预留接口） ──────────────────────────────────────

/** 发送 QQ 消息工具 schema */
export const qqSendSchema = z.object({
  target: z.string().describe('目标 QQ 号或群号'),
  content: z.string().describe('消息内容'),
  targetType: z.enum(['user', 'group']).optional().describe('目标类型：user=好友, group=群'),
});

/** 接收 QQ 消息工具 schema */
export const qqReceiveSchema = z.object({
  limit: z.number().int().positive().optional().describe('获取数量限制，默认 10'),
});

/** 列出 QQ 好友/群工具 schema */
export const qqListSchema = z.object({
  type: z.enum(['friends', 'groups']).describe('列表类型：friends=好友, groups=群'),
});

// ── 工具执行函数（预留实现） ──────────────────────────────────

/**
 * 发送 QQ 消息（预留实现）
 *
 * TODO: 集成 QQ Bot API 或第三方协议库
 */
export async function qqSend(_params: z.infer<typeof qqSendSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: 'QQ 消息发送功能尚未实现，需要配置 QQ Bot API' },
  };
}

/**
 * 接收 QQ 消息（预留实现）
 *
 * TODO: 集成 QQ Bot API 或第三方协议库
 */
export async function qqReceive(_params: z.infer<typeof qqReceiveSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: 'QQ 消息接收功能尚未实现，需要配置 QQ Bot API' },
  };
}

/**
 * 列出 QQ 好友/群（预留实现）
 *
 * TODO: 集成 QQ Bot API 或第三方协议库
 */
export async function qqList(_params: z.infer<typeof qqListSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: 'QQ 列表功能尚未实现，需要配置 QQ Bot API' },
  };
}

// ── MCP Server 入口（预留） ───────────────────────────────────

/**
 * 启动 QQ MCP Server
 *
 * TODO: 集成 @modelcontextprotocol/sdk 实现 stdio 服务
 */
export function startQQMcpServer(config: QQMcpConfig): void {
  console.log('[QQ MCP] Server framework loaded (not yet implemented)');
  console.log('[QQ MCP] Required config:', {
    apiEndpoint: config.apiEndpoint,
  });
}
