/**
 * exporter.ts 路径白名单校验零测试覆盖修复
 *
 * 测试 safeResolveExportPath() 函数的安全边界，防止路径穿越攻击。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeResolveExportPath } from '../main/memory/exporter';

describe('safeResolveExportPath - 路径白名单校验', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-exporter-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('应返回白名单目录内的合法路径', () => {
    const exportDir = path.resolve(process.cwd(), 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    const testPath = path.join(exportDir, 'test_export.md');
    const result = safeResolveExportPath(testPath);
    expect(result).toBe(testPath);
  });

  it('应返回备用白名单目录内的合法路径', () => {
    const exportDir = path.resolve(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    const testPath = path.join(exportDir, 'test_export.json');
    const result = safeResolveExportPath(testPath);
    expect(result).toBe(testPath);
  });

  it('应拒绝路径穿越 ../', () => {
    const exportDir = path.resolve(process.cwd(), 'exports');
    const maliciousPath = path.join(exportDir, '../../.ssh/authorized_keys');
    const result = safeResolveExportPath(maliciousPath);
    expect(result).toBe(null);
  });

  it('应拒绝多级路径穿越', () => {
    const exportDir = path.resolve(process.cwd(), 'exports');
    const maliciousPath = path.join(exportDir, '../../../etc/passwd');
    const result = safeResolveExportPath(maliciousPath);
    expect(result).toBe(null);
  });

  it('应拒绝相对路径', () => {
    const result = safeResolveExportPath('./exports/test.md');
    expect(result).toBe(null);
  });

  it('应拒绝白名单目录外的绝对路径', () => {
    const maliciousPath = path.resolve(process.cwd(), '../.ssh/authorized_keys');
    const result = safeResolveExportPath(maliciousPath);
    expect(result).toBe(null);
  });

  it('应拒绝空路径', () => {
    expect(safeResolveExportPath('')).toBe(null);
    expect(safeResolveExportPath('   ')).toBe(null);
  });

  it('应拒绝非字符串路径', () => {
    expect(safeResolveExportPath(undefined as any)).toBe(null);
    expect(safeResolveExportPath(null as any)).toBe(null);
    expect(safeResolveExportPath(123 as any)).toBe(null);
    expect(safeResolveExportPath({} as any)).toBe(null);
  });

  it('应拒绝符号链接指向白名单外', () => {
    const exportDir = path.resolve(process.cwd(), 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const maliciousTarget = path.resolve(process.cwd(), '../malicious.txt');
    const symlinkPath = path.join(exportDir, 'symlink_target');

    try {
      if (fs.existsSync(maliciousTarget)) fs.unlinkSync(maliciousTarget);
      fs.writeFileSync(maliciousTarget, 'malicious content');

      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(maliciousTarget, symlinkPath);

      const result = safeResolveExportPath(symlinkPath);
      expect(result).toBe(null);
    } finally {
      if (fs.existsSync(maliciousTarget)) fs.unlinkSync(maliciousTarget);
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }
  });

  it('应接受符号链接指向白名单内', () => {
    const exportDir = path.resolve(process.cwd(), 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const validTarget = path.join(exportDir, 'valid_target.txt');
    const symlinkPath = path.join(exportDir, 'symlink_valid');

    try {
      if (fs.existsSync(validTarget)) fs.unlinkSync(validTarget);
      fs.writeFileSync(validTarget, 'valid content');

      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(validTarget, symlinkPath);

      const result = safeResolveExportPath(symlinkPath);
      expect(result).toBe(validTarget);
    } finally {
      if (fs.existsSync(validTarget)) fs.unlinkSync(validTarget);
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }
  });
});