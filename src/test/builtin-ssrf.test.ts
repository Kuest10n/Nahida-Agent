/**
 * SSRF 防护边界测试
 *
 * 测试 isSafeUrl() 函数的各种边界情况，确保内网地址、IPv6 回环、
 * 链路本地地址等被正确拦截，防止 SSRF 攻击。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTool } from '../main/tools/registry';
import { registerBuiltinTools } from '../main/tools/builtin';
import { downloadVideo } from '../main/tools/video-generate';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: () => true,
    mkdirSync: () => {},
    writeFileSync: () => {},
  };
});

// 注册内置工具
registerBuiltinTools();

async function testUrl(url: string): Promise<{ ok: boolean; data: unknown }> {
  const tool = getTool('web_fetch');
  if (!tool) throw new Error('web_fetch tool not registered');
  const result = await tool.execute({ url }, { sessionId: 'test', userMessage: '' });
  return { ok: result.ok, data: result.data };
}

describe('SSRF 防护 - isSafeUrl 边界用例', () => {
  it('应拦截 IPv4 私网地址', async () => {
    const urls = [
      'https://10.0.0.1/api',
      'https://10.255.255.255/api',
      'https://172.16.0.1/api',
      'https://172.31.255.255/api',
      'https://192.168.1.1/api',
      'https://192.168.255.255/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
      expect(result.data).toContain('URL 安全校验失败');
    }
  });

  it('应拦截 IPv4 回环地址', async () => {
    const urls = [
      'https://127.0.0.1/api',
      'https://127.255.255.255/api',
      'https://localhost/api',
      'https://localhost.localdomain/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截 IPv6 回环地址', async () => {
    const urls = [
      'https://[::1]/api',
      'https://[0:0:0:0:0:0:0:1]/api',
      'https://[::1]:11434/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截 IPv6 ULA 地址', async () => {
    const urls = [
      'https://[fc00::]/api',
      'https://[fd00::]/api',
      'https://[fd00::1]:9880/api',
      'https://[fc00:1234:5678::]/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截 IPv6 link-local 地址', async () => {
    const urls = [
      'https://[fe80::]/api',
      'https://[fe80::1]/api',
      'https://[fe90::]/api',
      'https://[fea0::]/api',
      'https://[feb0::]/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截 0.0.0.0/8 和 CGNAT 地址', async () => {
    const urls = [
      'https://0.0.0.0/api',
      'https://0.0.0.1/api',
      'https://100.64.0.1/api',
      'https://100.127.255.255/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截链路本地地址 169.254.0.0/16', async () => {
    const urls = [
      'https://169.254.169.254/latest/meta-data/',
      'https://169.254.0.1/api',
      'https://169.254.255.255/api',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应放行合法公网 HTTPS 地址（不被 SSRF 防护拦截）', async () => {
    const urls = [
      'https://example.com/page',
      'https://www.google.com/search',
      'https://github.com/user/repo',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      // 公网地址通过安全检查后可能因网络原因失败，但不能是 SSRF 拦截
      if (!result.ok) {
        expect(String(result.data)).not.toContain('URL 安全校验失败');
      }
    }
  });

  it('应拦截非 HTTPS 协议', async () => {
    const urls = [
      'http://example.com/page',
      'ftp://example.com/file',
      'file:///etc/passwd',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it('应拦截畸形 URL', async () => {
    const urls = [
      'not-a-url',
      'https://',
    ];
    for (const url of urls) {
      const result = await testUrl(url);
      expect(result.ok).toBe(false);
    }
  });
});

describe('SSRF 防护 - video-generate downloadVideo 集成（S2 补测）', () => {
  let originalFetch: typeof fetch;
  let fetchCallCount = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCallCount = 0;

    const fakeVideoBuffer = new ArrayBuffer(8);
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeVideoBuffer,
        body: null,
      } as unknown as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('downloadVideo 应拒绝 192.168.x.x 内网 URL（SSRF-01 验证）', async () => {
    const result = await downloadVideo('https://192.168.1.1/api/secret-video', 'volcano');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝 10.x.x.x 内网 URL', async () => {
    const result = await downloadVideo('https://10.0.0.1/internal/video', 'runway');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝 172.16-31.x.x 内网 URL', async () => {
    const result = await downloadVideo('https://172.16.0.100/video', 'sora');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝 localhost 回环 URL', async () => {
    const result = await downloadVideo('https://localhost:8080/secret.mp4', 'volcano');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝 127.0.0.1 回环 URL', async () => {
    const result = await downloadVideo('https://127.0.0.1/api/leak', 'runway');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝 IPv6 回环 [::1]', async () => {
    const result = await downloadVideo('https://[::1]/video.mp4', 'volcano');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝链路本地 169.254.x.x（AWS 元数据）', async () => {
    const result = await downloadVideo('https://169.254.169.254/latest/meta-data/', 'sora');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应拒绝非 HTTPS 协议的 URL', async () => {
    const result = await downloadVideo('http://example.com/video.mp4', 'volcano');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('安全校验失败');
    expect(fetchCallCount).toBe(0);
  });

  it('downloadVideo 应允许合法公网 HTTPS URL（fetch 应被调用）', async () => {
    const result = await downloadVideo('https://example.com/valid-video.mp4', 'volcano');

    expect(result.ok).toBe(true);
    expect(result.videoPath).toBeDefined();
    expect(fetchCallCount).toBe(1);
  });
});
