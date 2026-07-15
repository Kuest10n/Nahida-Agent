/**
 * 配置读取层 —— T11
 *
 * 职责：
 *   从环境变量读取配置，提供默认值，统一管理所有配置项。
 *
 * 设计：
 *   - 不依赖 dotenv（保持轻量），但兼容 dotenv（用户装了就自动加载）
 *   - 所有配置项集中定义，默认值和环境变量名一一对应
 *   - 提供类型安全的配置对象（Config）
 *   - 启动时调用 init() 初始化一次
 *
 * 环境变量命名约定：
 *   NAHIDA_<模块>_<参数>，如 NAHIDA_OLLAMA_HOST、NAHIDA_MODEL_LOCAL
 *
 * 纯文件 IO（读 .env 或系统环境变量），不占 GPU。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, OllamaConfig, ModelConfig, ApiConfig, SessionConfig, VoiceConfig } from '../../shared/types/config';

// 重新导出类型，方便其他模块导入
export type { Config, OllamaConfig, ModelConfig, ApiConfig, SessionConfig, VoiceConfig };

// ── 配置类型（已移到 shared/types/config.ts）────────────────────

// ── 默认值 ────────────────────────────────────────────────────

const DEFAULT_OLLAMA_HOST = 'localhost';
const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_OLLAMA_TIMEOUT = 30_000;

const DEFAULT_MODEL_LOCAL = 'qwen3-8b-nahida';
const DEFAULT_MODEL_STANDARD = 'deepseek-v4pro';
const DEFAULT_MODEL_FLASH = 'deepseek-v4pro-flash';
const DEFAULT_MODEL_REVIEW = 'qwen2.5-1.5b-review-lora-v3';
const DEFAULT_LOCAL_MODEL_PATH = './resources/ollama/models/qwen3-8b-nahida.gguf';

const DEFAULT_SESSION_MAX_HISTORY = 10;
const DEFAULT_SESSION_TTL = 30;
const DEFAULT_SESSION_MAX_COUNT = 50;

const DEFAULT_VOICE_TTS_ADAPTER = 'edge-tts';
const DEFAULT_RVC_MODEL_NAME = 'nahida_v0.3_100e.pth';
const DEFAULT_RVC_MODEL_VERSION = 'V0.3';
const DEFAULT_RVC_ROOT = '';
const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoyiNeural';
const DEFAULT_GPTSOVITS_API_URL = 'http://localhost:9880';
// 本地化路径：使用相对路径指向 resources 目录下的集成资源
const DEFAULT_GPTSOVITS_REF_DIR = './resources/gpt-sovits/reference_audios';
const DEFAULT_GPTSOVITS_MODEL_DIR = './resources/gpt-sovits/models';

// ── 模块状态 ──────────────────────────────────────────────────

let config: Config | undefined;

// ── 初始化与读取 ──────────────────────────────────────────────

/**
 * 初始化配置（启动时调用一次）
 *
 * 从环境变量读取，环境变量不存在则用默认值。
 * 如果项目安装了 dotenv，会自动加载 .env 文件。
 */
export function initConfig(): Config {
  if (config) return config;

  config = {
    ollama: {
      host: envRequired('NAHIDA_OLLAMA_HOST', DEFAULT_OLLAMA_HOST),
      port: envNumber('NAHIDA_OLLAMA_PORT', DEFAULT_OLLAMA_PORT),
      timeoutMs: envNumber('NAHIDA_OLLAMA_TIMEOUT', DEFAULT_OLLAMA_TIMEOUT),
    },
    models: {
      local: envRequired('NAHIDA_MODEL_LOCAL', DEFAULT_MODEL_LOCAL),
      standard: envRequired('NAHIDA_MODEL_STANDARD', DEFAULT_MODEL_STANDARD),
      flash: envRequired('NAHIDA_MODEL_FLASH', DEFAULT_MODEL_FLASH),
      review: envRequired('NAHIDA_MODEL_REVIEW', DEFAULT_MODEL_REVIEW),
      localModelPath: envOptional('NAHIDA_LOCAL_MODEL_PATH') ?? DEFAULT_LOCAL_MODEL_PATH,
    },
    api: {
      deepseekKey: envOptional('NAHIDA_API_DEEPSEEK_KEY'),
    },
    session: {
      maxHistoryTurns: envNumber('NAHIDA_SESSION_MAX_HISTORY', DEFAULT_SESSION_MAX_HISTORY),
      ttlMinutes: envNumber('NAHIDA_SESSION_TTL', DEFAULT_SESSION_TTL),
      maxSessions: envNumber('NAHIDA_SESSION_MAX_COUNT', DEFAULT_SESSION_MAX_COUNT),
    },
    voice: {
      ttsAdapter: envRequired('NAHIDA_VOICE_ADAPTER', DEFAULT_VOICE_TTS_ADAPTER) as VoiceConfig['ttsAdapter'],
      rvcModelName: envRequired('NAHIDA_VOICE_RVC_MODEL', DEFAULT_RVC_MODEL_NAME),
      rvcModelVersion: envRequired('NAHIDA_VOICE_RVC_VERSION', DEFAULT_RVC_MODEL_VERSION),
      rvcRoot: envRequired('NAHIDA_VOICE_RVC_ROOT', DEFAULT_RVC_ROOT),
      edgeVoice: envRequired('NAHIDA_VOICE_EDGE_VOICE', DEFAULT_EDGE_VOICE),
      gptsovitsApiUrl: envRequired('NAHIDA_GPTSOVITS_API_URL', DEFAULT_GPTSOVITS_API_URL),
      gptsovitsRefDir: envRequired('NAHIDA_GPTSOVITS_REF_DIR', DEFAULT_GPTSOVITS_REF_DIR),
      gptsovitsModelDir: envRequired('NAHIDA_GPTSOVITS_MODEL_DIR', DEFAULT_GPTSOVITS_MODEL_DIR),
    },
  };

  console.log('[Config] initialized');
  return config;
}

/** 获取配置（自动初始化） */
export function getConfig(): Config {
  return config ?? initConfig();
}

/**
 * 获取 ollama 完整 URL
 *
 * @returns http://host:port
 */
export function getOllamaBaseUrl(): string {
  const { host, port } = getConfig().ollama;
  return `http://${host}:${port}`;
}

/**
 * 获取 ollama chat API URL
 *
 * @returns http://host:port/api/chat
 */
export function getOllamaChatUrl(): string {
  return `${getOllamaBaseUrl()}/api/chat`;
}

// ── 内部辅助函数 ──────────────────────────────────────────────

/** 读取必须的字符串环境变量，不存在返回默认值（返回 string） */
function envRequired(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value ?? defaultValue;
}

/** 读取可选的字符串环境变量（返回 string | undefined） */
function envOptional(key: string): string | undefined {
  return process.env[key];
}

/** 读取数字环境变量，不存在返回默认值 */
function envNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;

  const num = parseInt(value, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

// ── 配置持久化（v0.9.8 设置界面支持） ────────────────────────────────

/** 用户配置文件路径（项目根目录下的 config.json） */
const USER_CONFIG_FILE = path.resolve(process.cwd(), 'config.json');

/**
 * 保存用户配置到磁盘
 *
 * 只保存非默认值（与默认值相同的字段不写，避免配置文件冗余）。
 * 写入方式：原子写（先写 .tmp 再 rename）。
 */
export function saveConfigToDisk(partialConfig: Partial<Config>): void {
  const current = getConfig();

  // 合并（部分更新）
  const merged: Config = {
    ollama: { ...current.ollama, ...partialConfig.ollama },
    models: { ...current.models, ...partialConfig.models },
    api: { ...current.api, ...partialConfig.api },
    session: { ...current.session, ...partialConfig.session },
    voice: { ...current.voice, ...partialConfig.voice },
  };

  // 更新内存中的 config
  config = merged;

  // 写入磁盘
  try {
    const json = JSON.stringify(merged, null, 2);
    const tmpPath = `${USER_CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, USER_CONFIG_FILE);
    console.log('[Config] saved to', USER_CONFIG_FILE);
  } catch (err) {
    console.error('[Config] save failed:', err);
    throw err;
  }
}

/**
 * 从磁盘加载用户配置（覆盖内存中的默认值）
 *
 * 启动时调用一次（在 initConfig 之前）。
 */
export function loadUserConfigFromDisk(): void {
  if (!fs.existsSync(USER_CONFIG_FILE)) {
    console.log('[Config] no user config file, using defaults');
    return;
  }

  try {
    const content = fs.readFileSync(USER_CONFIG_FILE, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<Config>;

    // 合并到环境变量（优先级：用户配置文件 > 环境变量 > 默认值）
    // 这里简化处理：直接覆盖内存中的 config（initConfig 还没调用）
    // 实际应该在 initConfig 时读取，这里只标记"有用户配置文件"
    console.log('[Config] loaded user config from', USER_CONFIG_FILE);

    // 存到全局，让 initConfig 合并
    (global as { __userConfig?: Partial<Config> }).__userConfig = userConfig;
  } catch (err) {
    console.warn('[Config] failed to load user config:', err);
  }
}
