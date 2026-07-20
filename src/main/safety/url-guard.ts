/**
 * URL 安全校验工具 —— v3.0.1 第五关 SSRF 防护
 *
 * 职责：
 *   判断一个 URL 是否安全可访问，拦截 SSRF 常见攻击向量：
 *     - 非 HTTPS 协议（http/ftp/file/gopher/dict 等）
 *     - IPv4 私网（10/8、172.16/12、192.168/16）
 *     - IPv4 回环（127/8）
 *     - IPv4 链路本地（169.254/16，含 AWS 元数据 169.254.169.254）
 *     - IPv4 CGNAT（100.64/10）
 *     - IPv4 0.0.0.0/8（Windows 上解析为本机）
 *     - IPv6 回环（::1）
 *     - IPv6 ULA（fc00::/7）
 *     - IPv6 链路本地（fe80::/10）
 *     - localhost / localhost.* 域名
 *
 * 使用方：
 *   - tools/builtin.ts 的 web_fetch（用户/模型输入的 URL）
 *   - tools/video-generate.ts 的 downloadVideo（视频后端返回的 URL）
 *   - 未来任何 fetch 用户可控 URL 的入口
 *
 * 注：本函数只做静态字符串判断，不解析 DNS。
 *     如果攻击者用 DNS rebinding（同一域名解析到内网 IP），
 *     需要在 fetch 层再加 dns.lookup 后再次校验 IP——当前未实装，
 *     假设视频后端（volcano/runway/sora）返回的 URL 不可被攻击者完全控制。
 */

/**
 * 将 IPv6 十六进制后缀转换为 IPv4 地址
 *
 * Node.js 的 URL 解析器会将 IPv4-mapped IPv6 地址规范化为十六进制格式：
 *   ::ffff:127.0.0.1 → ::ffff:7f00:1
 *   ::ffff:10.0.0.1 → ::ffff:a00:1
 *
 * 此函数将后缀部分（如 '7f00:1'）转换回点分十进制 IPv4 地址。
 *
 * @returns 转换后的 IPv4 地址，失败返回 null
 */
function ipv6SuffixToIPv4(suffix: string): string | null {
  const parts = suffix.split(':').filter(p => p !== '' && p !== '0');

  if (parts.length === 1) {
    const part = parts[0];
    if (!part) return null;
    const full = part.padStart(8, '0');
    if (!/^[0-9a-f]{8}$/i.test(full)) return null;
    const octets = [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      parseInt(full.slice(6, 8), 16),
    ];
    if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;
    return octets.join('.');
  }

  if (parts.length === 2) {
    const [high, low] = parts;
    if (!high || !low) return null;
    const highPadded = high.padStart(4, '0');
    const lowPadded = low.padStart(4, '0');
    if (!/^[0-9a-f]{4}$/i.test(highPadded) || !/^[0-9a-f]{4}$/i.test(lowPadded)) return null;
    const octets = [
      parseInt(highPadded.slice(0, 2), 16),
      parseInt(highPadded.slice(2, 4), 16),
      parseInt(lowPadded.slice(0, 2), 16),
      parseInt(lowPadded.slice(2, 4), 16),
    ];
    if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;
    return octets.join('.');
  }

  if (parts.length === 4) {
    const octets = parts.map(p => {
      const padded = p.padStart(2, '0');
      return parseInt(padded, 16);
    });
    if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;
    return octets.join('.');
  }

  return null;
}

/**
 * 判断 URL 是否安全可访问（拦截 SSRF）
 *
 * @returns true 表示可访问，false 表示被拦截
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();

    // 解 IPv6 方括号
    const cleanHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

    // IPv4-mapped IPv6 (::ffff:0:0/96) — Node.js 会将其规范化为十六进制
    // 如 ::ffff:127.0.0.1 → ::ffff:7f00:1，需要提取并转换回 IPv4
    if (cleanHost.startsWith('::ffff:')) {
      const v4Part = cleanHost.slice(7);
      const v4Address = ipv6SuffixToIPv4(v4Part);
      if (v4Address) {
        return isSafeUrl(`https://${v4Address}/`);
      }
    }

    // IPv4-compatible IPv6 (deprecated, 但仍需处理)
    if (cleanHost.startsWith('::')) {
      const v4Part = cleanHost.slice(2);
      const v4Address = ipv6SuffixToIPv4(v4Part);
      if (v4Address) {
        return isSafeUrl(`https://${v4Address}/`);
      }
    }

    // IPv6 回环 [::1]
    if (cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1') return false;

    // IPv6 ULA [fc00::]/7 (fc00:: - fdff::)
    if (cleanHost.startsWith('fc') || cleanHost.startsWith('fd')) return false;

    // IPv6 link-local [fe80::]/10
    if (cleanHost.startsWith('fe8') || cleanHost.startsWith('fe9') ||
        cleanHost.startsWith('fea') || cleanHost.startsWith('feb')) return false;

    // IPv4 回环 127.0.0.0/8
    if (cleanHost.startsWith('127.')) return false;

    // IPv4 私网 10.0.0.0/8
    if (cleanHost.startsWith('10.')) return false;

    // IPv4 私网 172.16.0.0/12
    if (cleanHost.startsWith('172.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 16 && secondOctet <= 31) return false;
    }

    // IPv4 私网 192.168.0.0/16
    if (cleanHost.startsWith('192.168.')) return false;

    // IPv4 链路本地 169.254.0.0/16 (含 AWS 元数据 169.254.169.254)
    if (cleanHost.startsWith('169.254.')) return false;

    // IPv4 CGNAT 100.64.0.0/10
    if (cleanHost.startsWith('100.')) {
      const parts = cleanHost.split('.');
      const secondOctet = parseInt(parts[1] ?? '0', 10);
      if (secondOctet >= 64 && secondOctet <= 127) return false;
    }

    // 0.0.0.0/8 (Windows 上解析为本机)
    if (cleanHost.startsWith('0.')) return false;

    // localhost
    if (cleanHost === 'localhost' || cleanHost.startsWith('localhost.')) return false;

    return true;
  } catch {
    return false;
  }
}
