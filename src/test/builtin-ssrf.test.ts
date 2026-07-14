/**
 * SSRF 防护边界测试
 *
 * 测试 isSafeUrl() 函数的各种边界情况，确保内网地址、IPv6 回环、
 * 链路本地地址等被正确拦截，防止 SSRF 攻击。
 */

import { describe, it, expect } from 'vitest';
import { getTool, registerBuiltinTools } from '../main/tools/registry';

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
