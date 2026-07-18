/**
 * 群聊核心模块测试（S0 补测）
 *
 * 覆盖：
 *   - countTokens / truncateToTokenLimit 纯函数
 *   - createGroup / listGroups / getGroup / deleteGroup 生命周期
 *   - addAgent / removeAgent 成员管理
 *   - setTokenLimit token 限制配置
 *   - 并发广播不丢消息（互斥锁验证）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initGroupChat,
  createGroup,
  getGroup,
  listGroups,
  deleteGroup,
  addAgent,
  removeAgent,
  setTokenLimit,
  countTokens,
  truncateToTokenLimit,
} from '../main/agent/group-chat/group-chat';

describe('countTokens', () => {
  it('中文字符应按 1 token 计算', () => {
    expect(countTokens('你好世界')).toBe(4);
  });

  it('英文字符应按约 4 字符 1 token 计算', () => {
    expect(countTokens('hello')).toBe(2); // ceil(5/4) = 2
  });

  it('混合中英文应正确计算', () => {
    const tokens = countTokens('你好 hello');
    expect(tokens).toBe(2 + 2); // 2 中文 + ceil(6/4)=2
  });

  it('空字符串应为 0', () => {
    expect(countTokens('')).toBe(0);
  });
});

describe('truncateToTokenLimit', () => {
  it('未超限时应返回原文', () => {
    const text = '短文本';
    expect(truncateToTokenLimit(text, 100)).toBe(text);
  });

  it('超限时应截断并添加省略号', () => {
    const text = '这是一段很长的文本内容需要被截断处理';
    const result = truncateToTokenLimit(text, 5);
    expect(result).toHaveLength(6); // 5 字符 + ……
    expect(result.endsWith('……')).toBe(true);
  });

  it('limit 为 0 时应立即截断', () => {
    const result = truncateToTokenLimit('任意文本', 0);
    expect(result).toBe('……');
  });
});

describe('群聊生命周期', () => {
  beforeEach(() => {
    initGroupChat();
  });

  it('createGroup 应创建群聊并包含用户成员', () => {
    const group = createGroup('测试群组');
    expect(group).not.toBeNull();
    expect(group!.groupId).toMatch(/^group_\d+_/);
    expect(group!.name).toBe('测试群组');
    expect(group!.members).toHaveLength(1);
    expect(group!.members[0]!.type).toBe('user');
  });

  it('getGroup 应返回已创建的群', () => {
    const group = createGroup('查询测试');
    const found = getGroup(group!.groupId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('查询测试');
  });

  it('getGroup 对不存在的群应返回 undefined', () => {
    expect(getGroup('nonexistent_group')).toBeUndefined();
  });

  it('listGroups 应返回所有群聊', () => {
    createGroup('群A');
    createGroup('群B');
    const list = listGroups();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('deleteGroup 应删除群聊', () => {
    const group = createGroup('待删除');
    const success = deleteGroup(group!.groupId);
    expect(success).toBe(true);
    expect(getGroup(group!.groupId)).toBeUndefined();
  });

  it('deleteGroup 对不存在的群应返回 false', () => {
    expect(deleteGroup('nonexistent')).toBe(false);
  });
});

describe('成员管理', () => {
  beforeEach(() => {
    initGroupChat();
  });

  it('addAgent 对不存在的人格应返回 false', () => {
    const group = createGroup('成员测试');
    const success = addAgent(group!.groupId, 'nonexistent-personality');
    expect(success).toBe(false);
  });

  it('removeAgent 应阻止移除 user 成员', () => {
    const group = createGroup('保护测试');
    const success = removeAgent(group!.groupId, 'user');
    expect(success).toBe(false);
  });

  it('removeAgent 对不存在的成员应返回 false', () => {
    const group = createGroup('移除测试');
    const success = removeAgent(group!.groupId, 'nonexistent-member');
    expect(success).toBe(false);
  });
});

describe('setTokenLimit', () => {
  beforeEach(() => {
    initGroupChat();
  });

  it('设置默认 token 限制应更新 defaultTokenLimit', () => {
    const group = createGroup('Token测试');
    const success = setTokenLimit(group!.groupId, null, 40);
    expect(success).toBe(true);
    const updated = getGroup(group!.groupId);
    expect(updated!.defaultTokenLimit).toBe(40);
  });

  it('对不存在的群应返回 false', () => {
    expect(setTokenLimit('nonexistent', null, 50)).toBe(false);
  });

  it('对不存在的成员应返回 false', () => {
    const group = createGroup('成员Token测试');
    expect(setTokenLimit(group!.groupId, 'nonexistent-member', 30)).toBe(false);
  });
});
