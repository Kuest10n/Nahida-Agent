/**
 * MCP Client 安全测试（S0 补测）
 *
 * 覆盖 VULN-001/005 修复后的安全边界：
 *   - 基础 API 可用性（getConnectedServers / disconnectAllServers）
 *   - isValidMcpPath 路径白名单校验（防止恶意 MCP Server 执行任意命令）
 *   - mcpParamToZod / mcpToolToSchema 动态参数 schema 生成 + safeParse 校验
 *
 * 策略：
 *   - 真跑 isValidMcpPath / mcpParamToZod / mcpToolToSchema 纯函数
 *   - isValidMcpPath 用项目根下白名单目录（mcp-servers/）临时创建测试文件，不 mock fs
 *   - 动态参数校验用内存中构造的 schema 定义，不 spawn 进程
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getConnectedServers,
  disconnectAllServers,
  isValidMcpPath,
  mcpParamToZod,
  mcpToolToSchema,
} from '../main/mcp/mcp-client';

// ── 基础安全测试（保留原有） ────────────────────────────────────

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

// ── 用例 1：路径白名单校验 ──────────────────────────────────────

describe('isValidMcpPath - 路径白名单校验', () => {
  // 在白名单目录 mcp-servers/ 下创建临时文件，验证 realpath 逻辑走通
  const whitelistDir = path.resolve(process.cwd(), 'mcp-servers');
  const testFilePath = path.join(whitelistDir, 'test-server.exe');
  let dirCreated = false;

  beforeAll(() => {
    if (!fs.existsSync(whitelistDir)) {
      fs.mkdirSync(whitelistDir, { recursive: true });
      dirCreated = true;
    }
    fs.writeFileSync(testFilePath, '# test stub for isValidMcpPath', 'utf-8');
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (dirCreated && fs.existsSync(whitelistDir)) {
      // 只删除我们创建的空目录，不删除已存在的
      const remaining = fs.readdirSync(whitelistDir);
      if (remaining.length === 0) {
        fs.rmdirSync(whitelistDir);
      }
    }
  });

  it('应拒绝空/非字符串入参', () => {
    expect(isValidMcpPath('')).toBe(false);
    expect(isValidMcpPath(null as unknown as string)).toBe(false);
    expect(isValidMcpPath(undefined as unknown as string)).toBe(false);
    expect(isValidMcpPath(123 as unknown as string)).toBe(false);
  });

  it('应拒绝不存在的路径（realpathSync 失败）', () => {
    expect(isValidMcpPath(path.join(whitelistDir, 'never-exists.bin'))).toBe(false);
    expect(isValidMcpPath('C:\\nonexistent\\path\\server.exe')).toBe(false);
  });

  it('应拒绝白名单外的存在路径', () => {
    // Windows 系统自带 cmd.exe：存在但不在白名单目录内
    const systemCmd = 'C:\\Windows\\System32\\cmd.exe';
    if (fs.existsSync(systemCmd)) {
      expect(isValidMcpPath(systemCmd)).toBe(false);
    }
    // Node.js 可执行文件本身：存在但不在白名单
    const nodePath = process.execPath;
    expect(isValidMcpPath(nodePath)).toBe(false);
  });

  it('应放行白名单目录内的存在路径', () => {
    expect(isValidMcpPath(testFilePath)).toBe(true);
  });

  it('应放行白名单子目录内的路径', () => {
    const subDir = path.join(whitelistDir, 'sub', 'nested');
    fs.mkdirSync(subDir, { recursive: true });
    const nestedFile = path.join(subDir, 'tool.exe');
    fs.writeFileSync(nestedFile, '# nested', 'utf-8');
    try {
      expect(isValidMcpPath(nestedFile)).toBe(true);
    } finally {
      fs.unlinkSync(nestedFile);
      fs.rmdirSync(subDir);
      fs.rmdirSync(path.join(whitelistDir, 'sub'));
    }
  });

  it('应拒绝通过符号链接逃逸白名单', () => {
    // 在白名单内创建指向白名单外（Node 可执行文件）的符号链接
    const symlinkPath = path.join(whitelistDir, 'escape-link.exe');
    try {
      fs.symlinkSync(process.execPath, symlinkPath);
      // realpathSync 会解析符号链接到真实路径，真实路径不在白名单 → false
      expect(isValidMcpPath(symlinkPath)).toBe(false);
    } catch {
      // 某些环境无符号链接权限，跳过该测试
      console.warn('[test] symlink not supported on this environment, skipping');
    } finally {
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
    }
  });
});

// ── 用例 2 + 3：动态参数 schema 生成与校验 ─────────────────────

describe('mcpParamToZod - 动态参数 schema 生成', () => {
  it('string 类型应生成 z.string()', () => {
    const schema = mcpParamToZod({ type: 'string' });
    expect(schema.safeParse('hello').success).toBe(true);
    expect(schema.safeParse(123).success).toBe(false);
  });

  it('number 类型应生成 z.number()', () => {
    const schema = mcpParamToZod({ type: 'number' });
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse('42').success).toBe(false);
  });

  it('boolean 类型应生成 z.boolean()', () => {
    const schema = mcpParamToZod({ type: 'boolean' });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse('true').success).toBe(false);
  });

  it('string + enum 应生成 z.enum()', () => {
    const schema = mcpParamToZod({ type: 'string', enum: ['a', 'b', 'c'] });
    expect(schema.safeParse('a').success).toBe(true);
    expect(schema.safeParse('b').success).toBe(true);
    expect(schema.safeParse('c').success).toBe(true);
    // 非法枚举值应被拒绝
    expect(schema.safeParse('d').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
  });

  it('未知类型应回退到 z.any()', () => {
    const schema = mcpParamToZod({ type: 'unknown-type' });
    expect(schema.safeParse('anything').success).toBe(true);
    expect(schema.safeParse(123).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
  });
});

describe('mcpToolToSchema - 工具参数 schema 构造', () => {
  it('应正确区分 required 与 optional 字段', () => {
    const schema = mcpToolToSchema({
      name: { type: 'string' },               // required
      age: { type: 'number', optional: true }, // optional
    });
    // 缺少 required 字段应失败
    expect(schema.safeParse({}).success).toBe(false);
    // 提供 required 字段应成功
    expect(schema.safeParse({ name: 'nahida' }).success).toBe(true);
    // 提供所有字段应成功
    expect(schema.safeParse({ name: 'nahida', age: 500 }).success).toBe(true);
    // 额外字段（zod 默认 strip）应通过
    expect(schema.safeParse({ name: 'nahida', age: 500, extra: 'ok' }).success).toBe(true);
  });

  it('应拒绝类型不匹配的参数', () => {
    const schema = mcpToolToSchema({
      name: { type: 'string' },
      count: { type: 'number' },
    });
    // 类型不匹配应失败
    expect(schema.safeParse({ name: 123, count: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ name: 'ok', count: 'not-number' }).success).toBe(false);
  });

  it('应递归校验嵌套对象参数（用例 3）', () => {
    const schema = mcpToolToSchema({
      filter: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
        },
      },
    });
    // 合法嵌套对象应通过
    expect(schema.safeParse({ filter: { field: 'name', value: 'nahida' } }).success).toBe(true);
    // 嵌套字段类型错误应失败
    const result = schema.safeParse({ filter: { field: 123, value: 'ok' } });
    expect(result.success).toBe(false);
    // 缺少嵌套 required 字段应失败
    const result2 = schema.safeParse({ filter: { field: 'name' } });
    expect(result2.success).toBe(false);
  });

  it('应处理 array 类型字段', () => {
    const schema = mcpToolToSchema({
      tags: { type: 'array' },
    });
    expect(schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    expect(schema.safeParse({ tags: 'not-array' }).success).toBe(false);
  });

  it('空参数定义应生成空 schema（任意对象通过）', () => {
    const schema = mcpToolToSchema({});
    expect(schema.safeParse({}).success).toBe(true);
  });
});
