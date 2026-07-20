/**
 * URL 安全校验工具零测试覆盖修复
 *
 * 直接测试 isSafeUrl() 函数本身的边界条件，包括：
 *   - IPv4 私网边界
 *   - IPv6 ULA/链路本地边界
 *   - IPv4-mapped IPv6 地址（SSRF 绕过漏洞修复）
 *   - 非 HTTPS 协议拦截
 *   - 畸形 URL
 */

import { describe, it, expect } from 'vitest';
import { isSafeUrl } from '../main/safety/url-guard';

describe('isSafeUrl - SSRF 防护边界', () => {
  it('应拦截 IPv4 私网地址', () => {
    const urls = [
      'https://10.0.0.1/api',
      'https://10.255.255.255/api',
      'https://172.16.0.1/api',
      'https://172.31.255.255/api',
      'https://192.168.1.1/api',
      'https://192.168.255.255/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应放行 IPv4 私网边界外地址', () => {
    const urls = [
      'https://172.15.255.255/api',
      'https://172.32.0.1/api',
      'https://191.168.1.1/api',
      'https://193.168.1.1/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('应拦截 IPv4 回环地址', () => {
    const urls = [
      'https://127.0.0.1/api',
      'https://127.255.255.255/api',
      'https://localhost/api',
      'https://localhost.localdomain/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 IPv6 回环地址', () => {
    const urls = [
      'https://[::1]/api',
      'https://[0:0:0:0:0:0:0:1]/api',
      'https://[::1]:11434/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 IPv6 ULA 地址', () => {
    const urls = [
      'https://[fc00::]/api',
      'https://[fd00::]/api',
      'https://[fd00::1]:9880/api',
      'https://[fc00:1234:5678::]/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 IPv6 link-local 地址', () => {
    const urls = [
      'https://[fe80::]/api',
      'https://[fe80::1]/api',
      'https://[fe90::]/api',
      'https://[fea0::]/api',
      'https://[feb0::]/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 IPv4-mapped IPv6 地址（SSRF 绕过修复）', () => {
    const urls = [
      'https://[::ffff:127.0.0.1]/api',
      'https://[::ffff:10.0.0.1]/api',
      'https://[::ffff:172.16.0.1]/api',
      'https://[::ffff:192.168.1.1]/api',
      'https://[::ffff:169.254.169.254]/meta-data',
      'https://[::ffff:0:127.0.0.1]/api',
      'https://[::ffff:0:0:127.0.0.1]/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 IPv4-compatible IPv6 地址', () => {
    const urls = [
      'https://[::127.0.0.1]/api',
      'https://[::10.0.0.1]/api',
      'https://[::192.168.1.1]/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截 0.0.0.0/8 和 CGNAT 地址', () => {
    const urls = [
      'https://0.0.0.0/api',
      'https://0.0.0.1/api',
      'https://100.64.0.1/api',
      'https://100.127.255.255/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截链路本地地址 169.254.0.0/16', () => {
    const urls = [
      'https://169.254.169.254/latest/meta-data/',
      'https://169.254.0.1/api',
      'https://169.254.255.255/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应放行合法公网 HTTPS 地址', () => {
    const urls = [
      'https://example.com/page',
      'https://www.google.com/search',
      'https://github.com/user/repo',
      'https://api.openai.com/v1/chat/completions',
      'https://[2001:db8::1]/api',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('应拦截非 HTTPS 协议', () => {
    const urls = [
      'http://example.com/page',
      'ftp://example.com/file',
      'file:///etc/passwd',
      'gopher://example.com/',
      'dict://example.com/',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('应拦截畸形 URL', () => {
    const urls = [
      'not-a-url',
      'https://',
      '',
      'https:///',
      'https://::ffff:127.0.0.1/',
    ];
    for (const url of urls) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });
});