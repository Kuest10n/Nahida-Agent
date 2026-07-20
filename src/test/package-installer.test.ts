/**
 * package-installer.ts 路径白名单校验零测试覆盖修复
 *
 * 测试 resolvePackageDir() 函数的安全边界，防止路径遍历攻击。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolvePackageDir } from '../main/community/package-installer';

describe('resolvePackageDir - 路径白名单校验', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-packages-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('应返回 packages/ 内的合法路径', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    const testPackage = path.join(packagesDir, 'test.nahida-package');
    if (!fs.existsSync(testPackage)) {
      fs.mkdirSync(testPackage, { recursive: true });
    }

    const result = resolvePackageDir(testPackage);
    expect(result).toBe(testPackage);

    if (fs.existsSync(testPackage)) {
      fs.rmSync(testPackage, { recursive: true });
    }
  });

  it('应返回 packages/ 内的相对路径', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    const testPackage = 'test.nahida-package';
    const expectedPath = path.join(packagesDir, testPackage);
    if (!fs.existsSync(expectedPath)) {
      fs.mkdirSync(expectedPath, { recursive: true });
    }

    const result = resolvePackageDir(testPackage);
    expect(result).toBe(expectedPath);

    if (fs.existsSync(expectedPath)) {
      fs.rmSync(expectedPath, { recursive: true });
    }
  });

  it('应拒绝路径穿越 ../', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    const maliciousPath = path.join(packagesDir, '../malicious');
    const result = resolvePackageDir(maliciousPath);
    expect(result).toBe(null);
  });

  it('应拒绝 packages/ 外的绝对路径', () => {
    const maliciousPath = path.resolve(process.cwd(), '../etc');
    const result = resolvePackageDir(maliciousPath);
    expect(result).toBe(null);
  });

  it('应拒绝空路径', () => {
    expect(resolvePackageDir('')).toBe(null);
    expect(resolvePackageDir('   ')).toBe(null);
  });

  it('应拒绝非字符串路径', () => {
    expect(resolvePackageDir(undefined as any)).toBe(null);
    expect(resolvePackageDir(null as any)).toBe(null);
    expect(resolvePackageDir(123 as any)).toBe(null);
    expect(resolvePackageDir({} as any)).toBe(null);
  });

  it('应拒绝符号链接指向 packages/ 外', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    const maliciousTarget = path.resolve(process.cwd(), '../malicious');
    const symlinkPath = path.join(packagesDir, 'symlink_malicious');

    try {
      if (!fs.existsSync(maliciousTarget)) {
        fs.mkdirSync(maliciousTarget, { recursive: true });
      }

      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(maliciousTarget, symlinkPath);

      const result = resolvePackageDir(symlinkPath);
      expect(result).toBe(null);
    } finally {
      if (fs.existsSync(maliciousTarget)) fs.rmSync(maliciousTarget, { recursive: true });
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }
  });

  it('应接受符号链接指向 packages/ 内', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    const validTarget = path.join(packagesDir, 'valid.nahida-package');
    const symlinkPath = path.join(packagesDir, 'symlink_valid');

    try {
      if (!fs.existsSync(validTarget)) {
        fs.mkdirSync(validTarget, { recursive: true });
      }

      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(validTarget, symlinkPath);

      const result = resolvePackageDir(symlinkPath);
      expect(result).toBe(validTarget);
    } finally {
      if (fs.existsSync(validTarget)) fs.rmSync(validTarget, { recursive: true });
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }
  });

  it('应拒绝不存在的路径', () => {
    const packagesDir = path.resolve(process.cwd(), 'packages');
    const nonExistentPath = path.join(packagesDir, 'non-existent.nahida-package');
    const result = resolvePackageDir(nonExistentPath);
    expect(result).toBe(null);
  });
});