/**
 * Ollama 本地模型客户端
 *
 * 通过 HTTP 调用本地 ollama 实例，支持 NDJSON 流式输出，
 * 适配 Qwen3 的 /no_think 和 /think 模式。
 *
 * 不依赖第三方库，用 Electron 内置的 fetch API。
 * ollama 地址和超时从配置层读取（config.ts）。
 */

import { getOllamaBaseUrl, getConfig } from '../config/config';

/** 请求超时（从配置读取） */
function getTimeoutMs(): number {
  return getConfig().ollama.timeoutMs;
}

/** ollama chat 请求体 */
interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    /** KV cache 保活时间，避免冷启动 */
    keep_alive?: string;
  };
}

/** ollama chat 消息（v2.5 扩展 images 字段支持 vision） */
export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** v2.5: vision 模型的图片 base64 列表（不含前缀） */
  images?: string[];
}

/** ollama 流式返回的单行 NDJSON */
interface OllamaStreamChunk {
  message?: { role: string; content: string };
  done: boolean;
  finishReason?: string;
}

/** 流式回调：每收到一段 delta 就调用一次 */
export type StreamCallback = (delta: string, done: boolean) => void;

/**
 * 调用 ollama chat API（流式）
 *
 * @param model    模型名（如 'qwen3-8b-nahida'）
 * @param messages 消息列表（含 system prompt）
 * @param onDelta  流式回调
 * @param options  可选参数（temperature / num_predict 等）
 * @returns 完整响应文本
 */
export async function ollamaChatStream(
  model: string,
  messages: OllamaChatMessage[],
  onDelta: StreamCallback,
  options?: OllamaChatRequest['options'],
): Promise<string> {
  const url = `${getOllamaBaseUrl()}/api/chat`;
  const body: OllamaChatRequest = {
    model,
    messages,
    stream: true,
    options: {
      temperature: 0.7,
      keep_alive: '5m',
      ...options,
    },
  };

  // 使用 AbortController 实现超时
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ollama HTTP ${response.status}: ${await response.text()}`);
    }

    // 读取 NDJSON 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('ollama response body is null');
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });

      // 按换行切割 NDJSON，每行是一个完整 JSON
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // 最后一行可能不完整，留到下次

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const chunk: OllamaStreamChunk = JSON.parse(trimmed);
        const delta = chunk.message?.content ?? '';
        if (delta) {
          fullText += delta;
          onDelta(delta, chunk.done);
        }
        if (chunk.done) {
          onDelta('', true);
          return fullText;
        }
      }
    }

    return fullText;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 检查 ollama 服务是否可用
 *
 * 轻量级 ping，不占 GPU（只查 /api/tags）
 */
export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 列出已安装的 ollama 模型
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json() as { models?: { name: string }[] };
    return data.models?.map(m => m.name) ?? [];
  } catch {
    return [];
  }
}
