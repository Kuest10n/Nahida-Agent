/**
 * 云端 API 余额查询 —— v1.2.x 补丁（L1 #29 余额显示）
 *
 * 目前支持 DeepSeek API（https://api.deepseek.com/user/balance）。
 * 后续可扩展 OpenAI / Anthropic / 其他云服务商。
 */

import { getConfig } from '../config/config';

/** 余额信息（单币种） */
export interface BalanceInfo {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

/** 余额查询结果 */
export interface BalanceResult {
  ok: boolean;
  provider: string;
  isAvailable?: boolean;
  balances?: BalanceInfo[];
  error?: string;
  latencyMs: number;
}

/** DeepSeek /user/balance 响应结构 */
interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
}

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';

/**
 * 查询 DeepSeek 账户余额
 *
 * @returns 余额结果（成功/失败均带 latencyMs）
 */
export async function queryDeepSeekBalance(): Promise<BalanceResult> {
  const startTime = Date.now();
  const key = getConfig().api.deepseekKey;

  if (!key) {
    return {
      ok: false,
      provider: 'deepseek',
      error: '未配置 DeepSeek API Key（设置 → API → DeepSeek Key）',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      return {
        ok: false,
        provider: 'deepseek',
        error: `HTTP ${response.status}: ${text}`,
        latencyMs: Date.now() - startTime,
      };
    }

    const data = (await response.json()) as DeepSeekBalanceResponse;
    const balances: BalanceInfo[] = (data.balance_infos ?? []).map((b) => ({
      currency: b.currency,
      totalBalance: b.total_balance,
      grantedBalance: b.granted_balance,
      toppedUpBalance: b.topped_up_balance,
    }));

    return {
      ok: true,
      provider: 'deepseek',
      isAvailable: data.is_available,
      balances,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      provider: 'deepseek',
      error: `查询失败: ${errorMsg}`,
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * 把余额结果格式化成纳西妲语气的文本摘要
 *
 * @param result 余额查询结果
 * @returns 带动作括号的回复文本
 */
export function formatBalanceSummary(result: BalanceResult): string {
  if (!result.ok || !result.balances || result.balances.length === 0) {
    return `（虚空屏暗了一瞬）……余额查询没成功：${result.error ?? '未知错误'}。`;
  }

  const lines = result.balances.map((b) => {
    const total = parseFloat(b.totalBalance);
    return `- ${b.currency}: 剩余 ${total.toFixed(4)}（赠送 ${parseFloat(b.grantedBalance).toFixed(4)} / 充值 ${parseFloat(b.toppedUpBalance).toFixed(4)}）`;
  });

  return `💰 API 余额\n\n${lines.join('\n')}\n\n（指尖轻点虚空屏）……省着点用哦。`;
}
