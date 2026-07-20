/**
 * 配置类型定义 —— 渲染层和主进程共用
 *
 * 为什么放这里：
 *   渲染层不能直接导入主进程的 TypeScript 文件（编译隔离），
 *   但需要知道 Config 的结构来显示设置界面。
 */

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
  /** 本地 GGUF 模型路径 */
  localModelPath?: string;
  /** 是否使用本地 LLM */
  useLocalLLM?: boolean;
}

/** API key 配置 */
export interface ApiConfig {
  deepseekKey: string | undefined;
}

/** 会话配置 */
export interface SessionConfig {
  maxHistoryTurns: number;
  ttlMinutes: number;
  maxSessions: number;
}

/** STT 后端类型 */
export type STTBackend = 'web-speech' | 'openai-whisper' | 'whisper-cpp';

/** TTS / GPT-SoVITS / RVC 语音配置 */
export interface VoiceConfig {
  ttsAdapter: 'edge-tts' | 'gpt-sovits';
  rvcModelName: string;
  rvcModelVersion: string;
  rvcRoot: string;
  /** RVC 检索索引路径（可选） */
  rvcIndexPath?: string;
  /** 音高调整（半音数，0=不变） */
  rvcF0UpKey?: number;
  /** f0 提取算法 */
  rvcF0Method?: string;
  /** 索引混合率（0-1） */
  rvcIndexRate?: number;
  /** 推理设备：cuda / cpu */
  rvcDevice?: string;
  /** 半精度推理 */
  rvcIsHalf?: boolean;
  edgeVoice: string;
  gptsovitsApiUrl: string;
  gptsovitsRefDir: string;
  gptsovitsModelDir: string;
  /** STT 后端（v2.3） */
  sttBackend?: STTBackend;
  /** Whisper 模型路径（v2.3） */
  whisperModelPath?: string;
  /** Whisper 识别语言（v2.3） */
  whisperLang?: string;
  /** Whisper 推理设备（v2.3） */
  whisperDevice?: string;
  /** 是否启用语音唤醒（v2.3） */
  wakeupEnabled?: boolean;
  /** 唤醒词列表（v2.3） */
  wakeupKeywords?: string[];
}

/** 邮箱配置 */
export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  password: string;
}

/** 第三方 MCP Server 路径配置 */
export interface McpServerPaths {
  qq?: string;
  wechat?: string;
}

/** 生图后端配置（v2.0） */
export interface ImageConfig {
  /** 生图后端：comfyui / dalle / sdwebui */
  backend?: 'comfyui' | 'dalle' | 'sdwebui';
  /** ComfyUI 服务地址，默认 http://127.0.0.1:8188 */
  comfyuiUrl?: string;
  /** SD WebUI 服务地址，默认 http://127.0.0.1:7860 */
  sdwebuiUrl?: string;
  /** DALL·E API Key */
  dalleApiKey?: string;
  /** 默认模型文件名 */
  defaultModel?: string;
  /** 默认图像尺寸 */
  defaultSize?: string;
  /** 默认采样步数 */
  defaultSteps?: number;
  /** 默认 CFG scale */
  defaultCfg?: number;
}

/** 生视频后端配置（v2.1） */
export interface VideoConfig {
  /** 生视频后端：volcano / runway / sora */
  backend?: 'volcano' | 'runway' | 'sora';
  /** 火山引擎 API Key（Access Token） */
  volcanoApiKey?: string;
  /** Runway API Key */
  runwayApiKey?: string;
  /** OpenAI Sora API Key */
  soraApiKey?: string;
  /** 默认模型标识（如 seedance-v1-pro / gen3-alpha / sora-2） */
  defaultModel?: string;
  /** 默认分辨率（如 720p / 1080p） */
  defaultResolution?: string;
  /** 默认时长（秒） */
  defaultDurationSeconds?: number;
  /** 默认宽高比（如 16:9 / 9:16 / 1:1） */
  defaultAspectRatio?: string;
}

/** Vision 输入配置（v2.5，图像理解） */
export interface VisionConfig {
  /** Vision 模型名（如 qwen2-vl / llava / minicpm-v） */
  model?: string;
  /** 是否启用 OCR（v2.7 实装 Tesseract.js） */
  ocrEnabled?: boolean;
  /** OCR 引擎路径（v2.7 起弃用，保留字段向后兼容） */
  ocrEnginePath?: string;
  /** OCR 识别语言（v2.7，Tesseract 语言代码，如 chi_sim+eng） */
  ocrLanguage?: string;
  /** 单次最大图片数 */
  maxImages?: number;
  /** 图片最大边长（超过则等比缩放，省显存） */
  maxImageSize?: number;
  /** v2.19：屏幕监控持久化配置（规则跨重启保留） */
  monitor?: MonitorPersistConfig;
}

/** v2.19：屏幕监控持久化配置（保存到 config.json） */
export interface MonitorPersistConfig {
  /** 默认截图间隔（ms） */
  intervalMs?: number;
  /** 默认帧差阈值（%） */
  threshold?: number;
  /** 默认分析冷却（ms） */
  cooldownMs?: number;
  /** 窗口过滤规则（持久化的白名单/黑名单） */
  windowFilter?: {
    /** 模式：whitelist（只监控匹配的窗口）或 blacklist（不监控匹配的窗口） */
    mode: 'whitelist' | 'blacklist';
    /** 匹配规则列表（字符串数组，持久化时不支持 RegExp） */
    rules: string[];
  };
  /** 是否在应用启动时自动开始监控 */
  autoStart?: boolean;
}

/** 应用配置 */
export interface Config {
  ollama: OllamaConfig;
  models: ModelConfig;
  api: ApiConfig;
  session: SessionConfig;
  voice: VoiceConfig;
  email: EmailConfig;
  mcpServers: McpServerPaths;
  /** 生图配置（v2.0，可选） */
  image?: ImageConfig;
  /** 生视频配置（v2.1，可选） */
  video?: VideoConfig;
  /** Vision 输入配置（v2.5，可选） */
  vision?: VisionConfig;
}