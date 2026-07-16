/**
 * 微信 MCP Server 框架 —— v0.8.5
 *
 * 职责：
 *   提供微信消息收发能力的 MCP Server 框架（预留接口）
 *
 * 协议：
 *   stdio 模式，主进程通过 MCP Client 接入
 *
 * 工具清单（预留）：
 *   - wechat_send      : 发送微信消息
 *   - wechat_receive   : 接收微信消息
 *   - wechat_list      : 列出微信好友/群
 *
 * 依赖：
 *   需要配置微信 Bot API 或第三方微信协议库
 */

import { z } from 'zod';

// ── 类型定义 ──────────────────────────────────────────────────

/** MCP Server 配置 */
interface WechatMcpConfig {
  apiEndpoint: string;
  accessToken: string;
}

// ── 工具定义（预留接口） ──────────────────────────────────────

/** 发送微信消息工具 schema */
export const wechatSendSchema = z.object({
  target: z.string().describe('目标微信号或群名'),
  content: z.string().describe('消息内容'),
  targetType: z.enum(['user', 'group']).optional().describe('目标类型：user=好友, group=群'),
});

/** 接收微信消息工具 schema */
export const wechatReceiveSchema = z.object({
  limit: z.number().int().positive().optional().describe('获取数量限制，默认 10'),
});

/** 列出微信好友/群工具 schema */
export const wechatListSchema = z.object({
  type: z.enum(['friends', 'groups']).describe('列表类型：friends=好友, groups=群'),
});

// ── 工具执行函数（预留实现） ──────────────────────────────────

/**
 * 发送微信消息（预留实现）
 *
 * TODO: 集成微信 Bot API 或第三方协议库
 */
export async function wechatSend(_params: z.infer<typeof wechatSendSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '微信消息发送功能尚未实现，需要配置微信 Bot API' },
  };
}

/**
 * 接收微信消息（预留实现）
 *
 * TODO: 集成微信 Bot API 或第三方协议库
 */
export async function wechatReceive(_params: z.infer<typeof wechatReceiveSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '微信消息接收功能尚未实现，需要配置微信 Bot API' },
  };
}

/**
 * 列出微信好友/群（预留实现）
 *
 * TODO: 集成微信 Bot API 或第三方协议库
 */
export async function wechatList(_params: z.infer<typeof wechatListSchema>): Promise<{
  ok: boolean;
  data: unknown;
}> {
  // 预留实现
  return {
    ok: false,
    data: { message: '微信列表功能尚未实现，需要配置微信 Bot API' },
  };
}

// ── MCP Server 入口（预留） ───────────────────────────────────

/**
 * 启动微信 MCP Server
 *
 * TODO: 集成 @modelcontextprotocol/sdk 实现 stdio 服务
 */
export function startWechatMcpServer(config: WechatMcpConfig): void {
  console.log('[Wechat MCP] Server framework loaded (not yet implemented)');
  console.log('[Wechat MCP] Required config:', {
    apiEndpoint: config.apiEndpoint,
  });
}
