/**
 * 本地 LLM 客户端 —— 使用 node-llama-cpp 直接加载 GGUF 模型
 *
 * 优势（vs Ollama HTTP API）：
 *   1. 无需外部 Ollama 服务，模型文件随应用分发
 *   2. 减少网络开销，直接内存推理
 *   3. 支持 GPU 加速（CUDA/Metal）
 *   4. 模型路径可配置，支持相对路径
 *
 * 模型存放：resources/ollama/models/*.gguf
 * 配置项：NAHIDA_LOCAL_MODEL_PATH（相对或绝对路径）
 */

import { getConfig } from '../config/config';
import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';

// node-llama-cpp 类型（动态导入，避免构建时依赖）
let LlamaModel: any;
let LlamaContext: any;
let LlamaChatSession: any;

/** 模型实例缓存（避免重复加载） */
let modelInstance: any = null;
let contextInstance: any = null;
let currentModelPath: string | null = null;

/** 加载锁 —— 并发请求时第一个去加载，后面的等 */
let loadingPromise: Promise<void> | null = null;

/**
 * 动态加载 node-llama-cpp
 *
 * 使用动态 import 避免构建时缺少 native 模块的问题
 */
async function loadLlamaCpp(): Promise<void> {
  if (LlamaModel) return;

  try {
    const mod = await import('node-llama-cpp');
    LlamaModel = mod.LlamaModel;
    LlamaContext = mod.LlamaContext;
    LlamaChatSession = mod.LlamaChatSession;
    console.log('[LocalLLM] node-llama-cpp loaded');
  } catch (err) {
    console.error('[LocalLLM] failed to load node-llama-cpp:', err);
    throw new Error('node-llama-cpp not available. Run: npm install node-llama-cpp');
  }
}

/**
 * 解析模型路径（支持相对路径和绝对路径）
 *
 * 优先级：
 *   1. 环境变量 NAHIDA_LOCAL_MODEL_PATH
 *   2. 配置默认值（./resources/ollama/models/qwen3-8b-nahida.gguf）
 *   3. 相对于应用根目录解析
 */
function resolveModelPath(): string {
  const config = getConfig();
  const modelPath = config.models.localModelPath || './resources/ollama/models/qwen3-8b-nahida.gguf';

  // 绝对路径直接返回
  if (isAbsolute(modelPath)) {
    return modelPath;
  }

  // 相对路径：相对于应用根目录（process.cwd()）
  return resolve(process.cwd(), modelPath);
}

/**
 * 加载本地 GGUF 模型
 *
 * 首次调用时加载，后续复用缓存实例。
 * 如果模型路径变化，会重新加载。
 *
 * 并发安全：多个请求同时调用时，第一个去加载，后面的等待同一个 Promise。
 */
async function loadModel(modelPath: string): Promise<void> {
  await loadLlamaCpp();

  // 检查模型文件是否存在
  if (!existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}\nPlease download GGUF model to resources/ollama/models/`);
  }

  // 如果已加载且路径相同，复用
  if (modelInstance && currentModelPath === modelPath) {
    return;
  }

  // 如果正在加载，等待加载完成
  if (loadingPromise) {
    await loadingPromise;
    // 等完再检查一次（如果加载的是同一个路径就直接返回）
    if (modelInstance && currentModelPath === modelPath) {
      return;
    }
    // 如果等完发现路径不一样（中途换了模型），继续往下加载新的
  }

  // 设置加载锁
  loadingPromise = (async () => {
    // 卸载旧模型
    if (modelInstance) {
      console.log('[LocalLLM] unloading previous model');
      modelInstance = null;
      contextInstance = null;
    }

    console.log(`[LocalLLM] loading model: ${modelPath}`);

    try {
      // 加载模型（自动检测 GPU）
      modelInstance = new LlamaModel({
        modelPath,
        useGPU: true,
      });

      // 创建推理上下文
      contextInstance = new LlamaContext({
        model: modelInstance,
        contextSize: 4096,
      });

      currentModelPath = modelPath;
      console.log('[LocalLLM] model loaded successfully');
    } catch (err) {
      console.error('[LocalLLM] failed to load model:', err);
      throw err;
    }
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

/**
 * 本地 LLM 聊天（流式）
 *
 * 接口与 ollama-client.ts 保持一致，方便切换。
 *
 * @param model    模型名（忽略，本地只加载一个模型）
 * @param messages 消息列表（含 system prompt）
 * @param onDelta  流式回调
 * @param options  可选参数（temperature / maxTokens 等）
 * @returns 完整响应文本
 */
export async function localChatStream(
  _model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onDelta: (delta: string, done: boolean) => void,
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const modelPath = resolveModelPath();
  await loadModel(modelPath);

  if (!contextInstance) {
    throw new Error('Model context not initialized');
  }

  // 创建聊天会话
  const session = new LlamaChatSession({ context: contextInstance });

  // 转换消息格式为 node-llama-cpp 的 chat history
  const chatHistory = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  let fullText = '';

  try {
    // 流式推理
    await session.chat(chatHistory, {
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2048,
      onToken: (tokens: string[]) => {
        const delta = tokens.join('');
        fullText += delta;
        onDelta(delta, false);
      },
    });

    onDelta('', true);
    return fullText;
  } catch (err) {
    console.error('[LocalLLM] chat failed:', err);
    throw err;
  }
}

/**
 * 检查本地模型是否可用
 *
 * 轻量级检查：模型文件存在 + node-llama-cpp 已加载
 */
export async function checkLocalModelAvailable(): Promise<boolean> {
  try {
    const modelPath = resolveModelPath();
    if (!existsSync(modelPath)) {
      return false;
    }

    await loadLlamaCpp();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前加载的模型路径
 */
export function getCurrentModelPath(): string | null {
  return currentModelPath;
}

/**
 * 卸载模型（释放内存）
 */
export function unloadModel(): void {
  if (modelInstance) {
    console.log('[LocalLLM] unloading model');
    modelInstance = null;
    contextInstance = null;
    currentModelPath = null;
  }
}
