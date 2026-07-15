/**
 * 加密工具模块 —— 隐私沙箱（v0.9.7 L5 基础设施）
 *
 * 职责：
 *   提供 AES-256-GCM 加解密能力，用于 memory/ 和 session/ 数据加密。
 *
 * 设计：
 *   - 算法：AES-256-GCM（认证加密，防篡改）
 *   - 密钥派生：用户 PIN → PBKDF2 → 256-bit 密钥
 *   - 密钥存储：优先 keytar（系统钥匙环），兜底存在内存里（用户每次启动输 PIN）
 *   - 输出格式：Base64(iv + authTag + ciphertext)，单文件自包含
 *
 * 为什么选 AES-256-GCM：
 *   - Node.js 原生 crypto 模块支持，不引入新依赖
 *   - GCM 模式同时提供加密 + 完整性校验（防篡改）
 *   - 性能好，桌面级数据量（几 MB 顶天）完全够用
 *
 * 纯 CPU 运算，不占 GPU。
 */

import * as crypto from 'node:crypto';

// ── 类型定义 ──────────────────────────────────────────────────

/** 加密算法 */
const ALGORITHM = 'aes-256-gcm';
/** IV 长度（字节） */
const IV_LENGTH = 12; // GCM 推荐 12 字节
/** Auth Tag 长度（字节） */
const TAG_LENGTH = 16;
/** 密钥长度（字节） */
const KEY_LENGTH = 32; // AES-256
/** PBKDF2 迭代次数 */
const PBKDF2_ITERATIONS = 100_000;
/** PBKDF2 盐长度（字节） */
const SALT_LENGTH = 16;
/** 服务名（keytar 用） */
const KEYTAR_SERVICE = 'nahida-agent';
/** 账户名（keytar 用） */
const KEYTAR_ACCOUNT = 'encryption-master-key';

/** 加密结果（拆分存储，便于转 Base64 字符串） */
interface EncryptionResult {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  salt?: Buffer; // PBKDF2 的盐，用 PIN 派生时才有
}

/** 加密模式 */
export type EncryptionMode = 'disabled' | 'pin' | 'keytar';

// ── 模块状态 ──────────────────────────────────────────────────

/** 当前加密密钥（内存中），undefined = 未启用加密 */
let masterKey: Buffer | undefined;
/** 当前加密模式 */
let currentMode: EncryptionMode = 'disabled';
/** keytar 模块（懒加载，避免没装时报错） */
let keytarModule: typeof import('keytar') | null | undefined;

// ── 密钥管理 ──────────────────────────────────────────────────

/**
 * 尝试加载 keytar 模块（懒加载）
 *
 * 没装就返回 null，不影响其他功能。
 */
function tryLoadKeytar(): typeof import('keytar') | null {
  if (keytarModule !== undefined) return keytarModule;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    keytarModule = require('keytar') as typeof import('keytar');
    console.log('[Crypto] keytar loaded — using system keychain');
    return keytarModule;
  } catch {
    keytarModule = null;
    console.log('[Crypto] keytar not available — falling back to PIN mode');
    return null;
  }
}

/**
 * 初始化加密 —— 用 keytar 存储的主密钥（优先）
 *
 * 成功返回 true，失败返回 false（keytar 不可用或没存过密钥）。
 * 失败后可以调用 initWithPin() 用 PIN 模式。
 */
export async function initEncryptionWithKeytar(): Promise<boolean> {
  const keytar = tryLoadKeytar();
  if (!keytar) return false;

  try {
    const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    if (stored) {
      masterKey = Buffer.from(stored, 'hex');
      currentMode = 'keytar';
      console.log('[Crypto] encryption enabled (keytar mode)');
      return true;
    }

    // 没存过 → 生成一个新的随机密钥并存进去
    const newKey = crypto.randomBytes(KEY_LENGTH);
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, newKey.toString('hex'));
    masterKey = newKey;
    currentMode = 'keytar';
    console.log('[Crypto] generated new master key (keytar mode)');
    return true;
  } catch (err) {
    console.warn('[Crypto] keytar init failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * 初始化加密 —— 用用户 PIN 派生密钥
 *
 * @param pin 用户输入的 PIN 码（字符串）
 * @param salt 盐（首次设置时传 undefined 会生成新的；解锁时传之前存的盐）
 * @returns 盐（hex 字符串），需要存在配置里（盐不是秘密，只是防彩虹表）
 */
export function initEncryptionWithPin(pin: string, salt?: string): string {
  const saltBuffer = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(SALT_LENGTH);

  // PBKDF2 派生密钥
  const key = crypto.pbkdf2Sync(
    pin,
    saltBuffer,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256',
  );

  masterKey = key;
  currentMode = 'pin';
  console.log('[Crypto] encryption enabled (PIN mode)');

  return saltBuffer.toString('hex');
}

/** 关闭加密（擦除内存中的密钥） */
export function disableEncryption(): void {
  if (masterKey) {
    // 安全擦除（用随机数据覆盖）
    crypto.randomFillSync(masterKey);
  }
  masterKey = undefined;
  currentMode = 'disabled';
  console.log('[Crypto] encryption disabled');
}

/** 获取当前加密模式 */
export function getEncryptionMode(): EncryptionMode {
  return currentMode;
}

/** 是否启用了加密 */
export function isEncryptionEnabled(): boolean {
  return masterKey !== undefined;
}

// ── 加解密接口 ────────────────────────────────────────────────

/**
 * 加密字符串 → Base64 字符串
 *
 * 输出格式（二进制）：
 *   [salt?][iv][tag][ciphertext]
 *   - salt: 仅 PIN 模式有，16 字节（keytar 模式密钥固定，不需要 salt）
 *   - iv: 12 字节
 *   - tag: 16 字节（GCM 认证标签）
 *   - ciphertext: 剩余全部
 *
 * 最终返回 base64 编码的字符串，方便直接写文件。
 */
export function encryptString(plaintext: string): string {
  if (!masterKey) {
    // 未加密 → 明文返回（加个前缀标识，读的时候好判断）
    return `plain:${plaintext}`;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // PIN 模式把 salt 也打包进去（每次用的同一个 PBKDF2 key，salt 不变，
  // 但打包进去更自包含——以后换 PIN 也能识别）
  const parts: Buffer[] = [iv, tag, ciphertext];

  // keytar 模式不用 salt（密钥固定从系统钥匙环取）
  const result = Buffer.concat(parts);
  return `enc:${result.toString('base64')}`;
}

/**
 * 解密 Base64 字符串 → 明文
 *
 * 自动识别是加密的还是明文的（看前缀）。
 */
export function decryptString(ciphertext: string): string {
  // 明文 → 直接返回
  if (ciphertext.startsWith('plain:')) {
    return ciphertext.slice(6);
  }

  // 加密格式
  if (ciphertext.startsWith('enc:')) {
    if (!masterKey) {
      throw new Error('[Crypto] cannot decrypt: encryption not initialized');
    }

    const raw = Buffer.from(ciphertext.slice(4), 'base64');

    // 解析：[iv(12)][tag(16)][ciphertext(...)]
    if (raw.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('[Crypto] invalid ciphertext: too short');
    }

    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = raw.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return plaintext.toString('utf-8');
  }

  // 无前缀 → 当作明文（兼容旧文件）
  return ciphertext;
}

/**
 * 加密文件（便捷函数）
 *
 * 读文件 → 加密 → 写回。
 * 原子写：先写 .tmp 再 rename。
 */
export function encryptFileSync(filePath: string): void {
  const fs = require('node:fs') as typeof import('node:fs');
  const plaintext = fs.readFileSync(filePath, 'utf-8');
  const encrypted = encryptString(plaintext);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, encrypted, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * 解密文件（便捷函数）
 */
export function decryptFileSync(filePath: string): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const content = fs.readFileSync(filePath, 'utf-8');
  return decryptString(content);
}
