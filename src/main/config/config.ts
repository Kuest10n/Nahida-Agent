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

// ── 配置类型 ──────────────────────────────────────────────────

/** 完整配置对象 */
export interface Config {
  /** ollama 服务地址 */
  ollama: OllamaConfig;
  /** 模型配置 */
  models: ModelConfig;
  /** API key（可选，云端模型用） */
  api: ApiConfig;
  /** 会话配置 */
  session: SessionConfig;
  /** TTS / RVC 语音配置 */
  voice: VoiceConfig;
}

/** ollama 配置 */
export interface OllamaConfig {
  host: string;
  port: number;
  timeoutMs: number;
}

/** 模型配置 */
export interface ModelConfig {
  /** local tier 模型名 */
  local: string;
  /** standard tier 模型名（云端） */
  standard: string;
  /** flash tier 模型名（云端） */
  flash: string;
  /** 审查模型名 */
  review: string;
}

/** API key 配置 */
export interface ApiConfig {
  /** DeepSeek API key（可选） */
  deepseekKey: string | undefined;
}

/** 会话配置 */
export interface SessionConfig {
  /** 最大历史轮数 */
  maxHistoryTurns: number;
  /** 过期时间（分钟） */
  ttlMinutes: number;
  /** 最大保留会话数 */
  maxSessions: number;
}

/** TTS / RVC / GPT-SoVITS 语音配置 */
export interface VoiceConfig {
  /** TTS 适配器类型：edge-tts（CPU 默认）/ gpt-sovits（GPU，Phase 2 主力）/ rvc（GPU，备选） */
  ttsAdapter: 'edge-tts' | 'gpt-sovits' | 'rvc';
  /** RVC 模型文件名（assets/rvc/ 下） */
  rvcModelName: string;
  /** RVC 模型版本标识 */
  rvcModelVersion: string;
  /** RVC WebUI 根目录（外部依赖，如 F:\RVC20240604Nvidia） */
  rvcRoot: string;
  /** edge-tts voice 名（默认晓伊） */
  edgeVoice: string;
  /** GPT-SoVITS API 地址（默认 http://localhost:9880） */
  gptsovitsApiUrl: string;
  /** GPT-SoVITS 参考音频根目录 */
  gptsovitsRefDir: string;
  /** GPT-SoVITS 模型目录（含 .ckpt + .pth） */
  gptsovitsModelDir: string;
}

// ── 默认值 ────────────────────────────────────────────────────

const DEFAULT_OLLAMA_HOST = 'localhost';
const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_OLLAMA_TIMEOUT = 30_000;

const DEFAULT_MODEL_LOCAL = 'qwen3-8b-nahida';
const DEFAULT_MODEL_STANDARD = 'deepseek-v4pro';
const DEFAULT_MODEL_FLASH = 'deepseek-v4pro-flash';
const DEFAULT_MODEL_REVIEW = 'qwen2.5-1.5b-review-lora-v3';

const DEFAULT_SESSION_MAX_HISTORY = 10;
const DEFAULT_SESSION_TTL = 30;
const DEFAULT_SESSION_MAX_COUNT = 50;

const DEFAULT_VOICE_TTS_ADAPTER = 'edge-tts';
const DEFAULT_RVC_MODEL_NAME = 'nahida_v0.3_100e.pth';
const DEFAULT_RVC_MODEL_VERSION = 'V0.3';
const DEFAULT_RVC_ROOT = '';
const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoyiNeural';
const DEFAULT_GPTSOVITS_API_URL = 'http://localhost:9880';
const DEFAULT_GPTSOVITS_REF_DIR = '';
const DEFAULT_GPTSOVITS_MODEL_DIR = '';

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
