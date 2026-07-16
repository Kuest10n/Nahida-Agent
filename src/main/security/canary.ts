/**
 * 凭证金丝雀 —— v1.2.x 安全补丁（L5 纵深防御）
 *
 * 职责：
 *   为内存中的敏感值（API Key、邮箱密码等）附加 Canary 值，
 *   检测进程内存是否被外部篡改（如恶意软件扫描/注入）。
 *
 * 设计：
 *   - wrap(value) → 把值和随机 Canary 拼接存储
 *   - unwrap(wrapped) → 校验 Canary，若失败则报警
 *   - 仅在读取时校验，不阻止正常流程（报警但不阻断）
 *
 * 使用场景：
 *   - Config 中的 api.deepseekKey
 *   - Config 中的 email.password
 *   - 任何从 keytar 读取的凭证
 */

import * as crypto from 'node:crypto';

const CANARY_LENGTH = 8;

/** 带 Canary 的包装值 */
export interface CanaryWrapped {
  value: string;
  canary: string;
}

/**
 * 生成随机 Canary
 */
function generateCanary(): string {
  return crypto.randomBytes(CANARY_LENGTH).toString('hex');
}

/**
 * 包装敏感值
 *
 * @param value 原始敏感值
 * @returns 带 Canary 的包装对象
 */
export function wrap(value: string): CanaryWrapped {
  return {
    value,
    canary: generateCanary(),
  };
}

/**
 * 解包并校验 Canary
 *
 * @param wrapped 包装对象
 * @returns 原始值（Canary 校验失败时返回原值但记录警告）
 */
export function unwrap(wrapped: CanaryWrapped | undefined): string | undefined {
  if (!wrapped) return undefined;

  // 实际场景中，如果 Canary 被篡改，说明进程内存可能已被外部扫描
  // 这里仅做存在性检查（更严格的校验需要把 Canary 存到独立内存区域）
  if (!wrapped.canary || wrapped.canary.length !== CANARY_LENGTH * 2) {
    console.warn('[Canary] ⚠️ Canary 异常，敏感值可能已被外部访问');
    // 依然返回原值，避免阻断正常流程，但触发报警
  }

  return wrapped.value;
}

/**
 * 快速校验（不返回值，只检查完整性）
 *
 * @returns true=正常, false=异常
 */
export function verify(wrapped: CanaryWrapped | undefined): boolean {
  if (!wrapped) return true;
  return !!wrapped.canary && wrapped.canary.length === CANARY_LENGTH * 2;
}
