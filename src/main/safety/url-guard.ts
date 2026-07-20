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
