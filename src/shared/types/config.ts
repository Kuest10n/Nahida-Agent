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

/** TTS / GPT-SoVITS / RVC 语音配置 */
export interface VoiceConfig {
  ttsAdapter: 'edge-tts' | 'gpt-sovits';
  rvcModelName: string;
  rvcModelVersion: string;
  rvcRoot: string;
  edgeVoice: string;
  gptsovitsApiUrl: string;
  gptsovitsRefDir: string;
  gptsovitsModelDir: string;
}

/** 完整配置对象 */
export interface Config {
  ollama: OllamaConfig;
  models: ModelConfig;
  api: ApiConfig;
  session: SessionConfig;
  voice: VoiceConfig;
}