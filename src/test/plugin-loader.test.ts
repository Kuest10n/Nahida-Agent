/**
 * Plugin Loader 沙箱安全测试（S0 补测）
 *
 * 覆盖 VULN-002/003/006 修复后的安全边界：
 *   - validateCommandArgs / validateToolParams 参数校验（路径穿越/超长/嵌套）
 *   - loadPluginSandboxed 沙箱隔离（BLOCKED_MODULES 拦截 + vm.runInNewContext 上下文隔离）
 *
 * 策略：
 *   - 真跑 validateCommandArgs / validateToolParams / loadPluginSandboxed
 *   - loadPluginSandboxed 用 os.tmpdir() 下临时文件承载插件代码字符串，不写 plugins/
 *   - 不 mock vm 模块（沙箱隔离效果必须真实验证）
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateCommandArgs,
  validateToolParams,
  loadPluginSandboxed,
} from '../main/plugins/plugin-loader';

// ── 辅助：在 tmpdir 下创建临时插件文件 ──────────────────────────

function createTempPlugin(code: string): { indexPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nahida-plugin-test-'));
  const indexPath = path.join(tmpDir, 'index.js');
  fs.writeFileSync(indexPath, code, 'utf-8');
  return {
    indexPath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ── 用例 2：参数校验路径穿越 ────────────────────────────────────

describe('validateCommandArgs - 命令参数校验', () => {
  it('应拒绝路径遍历（..）', () => {
    expect(validateCommandArgs(['../etc/passwd'])).toBe(false);
    expect(validateCommandArgs(['foo', '../../etc/shadow'])).toBe(false);
    expect(validateCommandArgs(['a/../b'])).toBe(false);
  });

  it('应拒绝绝对路径与路径分隔符', () => {
    expect(validateCommandArgs(['/usr/bin/bash'])).toBe(false);
    expect(validateCommandArgs(['C:\\Windows\\System32\\cmd.exe'])).toBe(false);
    expect(validateCommandArgs(['sub/dir'])).toBe(false);
  });

  it('应拒绝非字符串元素与非数组入参', () => {
    expect(validateCommandArgs([123] as unknown as string[])).toBe(false);
    expect(validateCommandArgs('not-array' as unknown as string[])).toBe(false);
    expect(validateCommandArgs(null as unknown as string[])).toBe(false);
    expect(validateCommandArgs(undefined as unknown as string[])).toBe(false);
  });

  it('应拒绝超长参数（> 1024 字符）', () => {
    expect(validateCommandArgs(['a'.repeat(2000)])).toBe(false);
  });

  it('应放行合法参数', () => {
    expect(validateCommandArgs([])).toBe(true);
    expect(validateCommandArgs(['hello'])).toBe(true);
    expect(validateCommandArgs(['--port', '8080'])).toBe(true);
  });
});

describe('validateToolParams - 工具参数校验', () => {
  it('应拒绝字符串值中的路径遍历', () => {
    expect(validateToolParams({ path: '../../etc/shadow' })).toBe(false);
    expect(validateToolParams({ query: 'foo', payload: '../secret' })).toBe(false);
  });

  it('应拒绝超长字符串（> 4096）', () => {
    expect(validateToolParams({ data: 'x'.repeat(5000) })).toBe(false);
  });

  it('应递归校验嵌套对象', () => {
    expect(validateToolParams({ outer: { inner: '../bad' } })).toBe(false);
    expect(validateToolParams({ arr: ['ok', { x: '../../etc' }] })).toBe(false);
    expect(validateToolParams({ deep: { a: { b: { c: '../leak' } } } })).toBe(false);
  });

  it('应放行合法参数', () => {
    expect(validateToolParams({})).toBe(true);
    expect(validateToolParams({ name: 'nahida', age: 500, active: true })).toBe(true);
    expect(validateToolParams({ nested: { ok: true, list: [1, 2, 3] } })).toBe(true);
    expect(validateToolParams({ nullable: null, undef: undefined })).toBe(true);
  });

  it('应拒绝 null/非对象入参', () => {
    expect(validateToolParams(null as unknown as Record<string, unknown>)).toBe(false);
    expect(validateToolParams('string' as unknown as Record<string, unknown>)).toBe(false);
    expect(validateToolParams(42 as unknown as Record<string, unknown>)).toBe(false);
  });
});

// ── 用例 1 + 用例 3：沙箱隔离 ──────────────────────────────────

describe('loadPluginSandboxed - 沙箱隔离', () => {
  it('应阻止 require child_process（VULN-002 修复）', () => {
    const { indexPath, cleanup } = createTempPlugin(`
      try {
        require('child_process');
        module.exports.bypassed = true;
      } catch (e) {
        module.exports.error = e.message;
      }
    `);
    try {
      const result = loadPluginSandboxed(indexPath) as Record<string, unknown>;
      expect(result.bypassed).toBeUndefined();
      expect(result.error).toEqual(expect.stringContaining('安全策略'));
    } finally {
      cleanup();
    }
  });

  it('应阻止 node: 前缀变体与 fs/http/vm/process 等新增拦截项', () => {
    const blocked = [
      'node:child_process',
      'node:fs',
      'node:http',
      'node:https',
      'node:vm',
      'node:process',
      'node:crypto',
      'node:net',
      'fs',
      'http',
      'vm',
      'process',
      'os',
      'cluster',
      'worker_threads',
    ];
    const code = `
      const blocked = ${JSON.stringify(blocked)};
      const results = {};
      for (const m of blocked) {
        try {
          require(m);
          results[m] = 'bypassed';
        } catch (e) {
          results[m] = e.message.includes('安全策略') ? 'blocked' : 'other-error';
        }
      }
      module.exports.results = results;
    `;
    const { indexPath, cleanup } = createTempPlugin(code);
    try {
      const result = loadPluginSandboxed(indexPath) as { results: Record<string, string> };
      for (const [mod, status] of Object.entries(result.results)) {
        expect(status, `module "${mod}" should be blocked`).toBe('blocked');
      }
    } finally {
      cleanup();
    }
  });

  it('沙箱上下文应隔离 process / Buffer 等 Node 全局（VULN-006 修复）', () => {
    // 注意：vm.runInNewContext 把 context 作为 globalThis，所以 sandboxedRequire
    // 本身会出现在 globalThis.require 上 —— 这是预期行为（注入受限 require）。
    // 真正要验证的是：未注入的 Node 全局（process / Buffer / setImmediate / global）不可访问，
    // 且 globalThis.require 是受限版本（会拦截危险模块）。
    const { indexPath, cleanup } = createTempPlugin(`
      module.exports.hasProcess = typeof process;
      module.exports.hasBuffer = typeof Buffer;
      module.exports.hasSetImmediate = typeof setImmediate;
      module.exports.hasGlobal = typeof global;
      // globalThis.require 存在但应是受限的 sandboxedRequire
      module.exports.globalRequireType = typeof globalThis.require;
      try {
        globalThis.require('child_process');
        module.exports.globalRequireBypassed = true;
      } catch (e) {
        module.exports.globalRequireBlocked = e.message.includes('安全策略');
      }
    `);
    try {
      const result = loadPluginSandboxed(indexPath) as {
        hasProcess: string;
        hasBuffer: string;
        hasSetImmediate: string;
        hasGlobal: string;
        globalRequireType: string;
        globalRequireBypassed?: boolean;
        globalRequireBlocked?: boolean;
      };
      // 未注入的 Node 全局应为 'undefined'
      expect(result.hasProcess).toBe('undefined');
      expect(result.hasBuffer).toBe('undefined');
      expect(result.hasSetImmediate).toBe('undefined');
      expect(result.hasGlobal).toBe('undefined');
      // globalThis.require 存在但应是受限版本（拦截危险模块）
      expect(result.globalRequireType).toBe('function');
      expect(result.globalRequireBypassed).toBeUndefined();
      expect(result.globalRequireBlocked).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('沙箱应注入受限的 require（仅放行非危险模块）', () => {
    // 验证 sandboxedRequire 本身存在且可调用
    // 不实际 require 危险模块（已在上游测试覆盖）
    const { indexPath, cleanup } = createTempPlugin(`
      module.exports.requireType = typeof require;
      module.exports.moduleType = typeof module;
      module.exports.exportsType = typeof exports;
      module.exports.consoleType = typeof console;
      module.exports.promiseType = typeof Promise;
    `);
    try {
      const result = loadPluginSandboxed(indexPath) as Record<string, string>;
      expect(result.requireType).toBe('function');
      expect(result.moduleType).toBe('object');
      expect(result.exportsType).toBe('object');
      expect(result.consoleType).toBe('object');
      expect(result.promiseType).toBe('function');
    } finally {
      cleanup();
    }
  });
});
