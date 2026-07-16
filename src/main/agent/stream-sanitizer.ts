/**
 * 流式输出清洗器 —— 实时剥离 LLM 输出中的内部标签
 *
 * 解决的泄漏问题：
 *   1. Qwen3 思考前缀泄漏
 *   2. [emotion:xxx] 情绪标签泄漏
 *   3. 工具调用标签泄漏
 *
 * 注意：动作括号 `（xxx）` 保留，因为它是人设要求的一部分，
 * 且 Live2D 需要从中抽取动作 tag。
 */

// 构建正则时避免字面量标签冲突
const THINK_OPEN = '<' + 'think>';
const THINK_CLOSE = '<' + '/think>';
const TOOL_OPEN = '<' + 'tool_call>';
const TOOL_CLOSE = '<' + '/tool_call>';

/**
 * 输出清洗：剥离 LLM 输出中的内部标签
 *
 * 解决的泄漏问题：
 *   1. Qwen3 思考前缀（think 标签及其内容）
 *   2. [emotion:xxx] 情绪标签
 *   3. 工具调用标签（工具调用后应被替换，但以防泄漏）
 *
 * 注意：动作括号 `（xxx）` 保留，因为它是人设要求的一部分，
 * 且 Live2D 需要从中抽取动作 tag。
 */
export function sanitizeOutput(text: string): string {
  return text
    // 1. 剥离思考标签及其内容（Qwen3 /think 模式）
    .replace(new RegExp(escapeRegex(THINK_OPEN) + '[\\s\\S]*?' + escapeRegex(THINK_CLOSE) + '\\s*', 'g'), '')
    // 2. 剥离 [emotion:xxx] 情绪标签
    .replace(/\[emotion:[^\]]*\]/g, '')
    // 3. 剥离残留的工具调用标签
    .replace(new RegExp(escapeRegex(TOOL_OPEN) + '[\\s\\S]*?' + escapeRegex(TOOL_CLOSE), 'g'), '')
    .trim();
}

/**
 * 流式清洗器（有状态）—— 用于流式输出场景
 *
 * 内部维护 buffer，处理跨 chunk 的标签（如 <think> 可能分多个 chunk 到达）。
 * 每次 push 一个 chunk，返回可安全展示的文本。
 * done 时调用 flush 获取剩余内容。
 */
export class StreamSanitizer {
  private buffer = '';
  private inThinkBlock = false;

  /**
   * 推入一个 chunk，返回可安全展示的文本
   */
  push(chunk: string): string {
    this.buffer += chunk;

    // 检查是否进入 think 块
    const thinkOpen = THINK_OPEN;

    if (!this.inThinkBlock) {
      // 检查是否有完整的 think 开标签
      const openIdx = this.buffer.indexOf(thinkOpen);
      if (openIdx !== -1) {
        // 开标签前的内容可以输出
        const before = this.buffer.substring(0, openIdx);
        this.buffer = this.buffer.substring(openIdx + thinkOpen.length);
        this.inThinkBlock = true;

        // 在 think 块内查找闭标签
        return before + this.consumeThinkBlock();
      }

      // 没有 think 开标签，检查是否有不完整的开标签（在 buffer 末尾）
      for (let i = 1; i < thinkOpen.length; i++) {
        if (this.buffer.endsWith(thinkOpen.substring(0, i))) {
          // 末尾可能是不完整的开标签，保留这部分，输出前面的
          const safe = this.buffer.substring(0, this.buffer.length - i);
          this.buffer = this.buffer.substring(this.buffer.length - i);
          return sanitizeOutput(safe);
        }
      }

      // 安全输出
      const safe = this.buffer;
      this.buffer = '';
      return sanitizeOutput(safe);
    } else {
      // 已在 think 块内
      return this.consumeThinkBlock();
    }
  }

  /**
   * 结束流，返回剩余可展示文本
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    this.inThinkBlock = false;
    return sanitizeOutput(remaining);
  }

  /**
   * 从 buffer 中消费 think 块内容，返回闭标签后到下一个开标签前的安全文本
   */
  private consumeThinkBlock(): string {
    const thinkClose = THINK_CLOSE;
    let result = '';

    while (this.inThinkBlock) {
      const closeIdx = this.buffer.indexOf(thinkClose);
      if (closeIdx !== -1) {
        // 找到闭标签，think 块结束
        this.buffer = this.buffer.substring(closeIdx + thinkClose.length);
        this.inThinkBlock = false;

        // 继续处理剩余 buffer（可能还有更多 think 块或正常内容）
        result += this.push('');
        break;
      }

      // 检查是否有可能不完整的闭标签在 buffer 末尾
      for (let i = 1; i < thinkClose.length; i++) {
        if (this.buffer.endsWith(thinkClose.substring(0, i))) {
          // 保留可能的不完整闭标签
          this.buffer = this.buffer.substring(this.buffer.length - i);
          return result;
        }
      }

      // buffer 中没有闭标签，全部丢弃（都在 think 块内）
      // 但保留末尾可能不完整的闭标签
      if (this.buffer.length >= thinkClose.length) {
        this.buffer = '';
      }
      return result;
    }

    return result;
  }
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
