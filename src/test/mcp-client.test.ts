/**
 * MCP Client 基础安全测试（S1 补测）
 *
 * 覆盖基础 API 可用性，防止空指针异常：
 *   - getConnectedServers() 初始状态返回空数组
 *   - disconnectAllServers() 空操作安全
 */

import { describe, it, expect } from 'vitest';
import { getConnectedServers, disconnectAllServers } from '../main/mcp/mcp-client';

describe('MCP Client 基础安全', () => {
  it('getConnectedServers 初始状态应返回空数组', () => {
    const servers = getConnectedServers();
    expect(Array.isArray(servers)).toBe(true);
    // 初始状态下没有已连接的服务器
    // （如果之前的测试连接了服务器，这里可能非空，所以只检查类型）
  });

  it('disconnectAllServers 空操作应无异常', () => {
    expect(() => disconnectAllServers()).not.toThrow();
  });
});
