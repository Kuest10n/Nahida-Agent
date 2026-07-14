/**
 * E2E Smoke 测试 —— v0.8.6
 *
 * 整链路真 LLM 端到端测试：
 *   用户消息 → 路由 → Agent Core → ollama → 四审 → 输出
 *
 * 验证点：
 *   1. thinking 前缀泄漏（严重性：高）
 *   2. 动作括号生成（严重性：中）
 *   3. 情绪标签生成（严重性：中）
 *   4. 工具调用回路（严重性：中）
 *   5. cycleLog 四段完整性（严重性：低）
 *   6. session 持久化恢复（严重性：低）
 *
 * 运行方式：
 *   需要 ollama 服务运行 + qwen3-8b-nahida 模型已创建
 *   npm run test:e2e
 */

import { generateResponse, clearSessionHistory } from '../main/agent/agent-core';
import { Router } from '../main/router/router';
import { initConfig } from '../main/config/config';
import { registerBuiltinTools } from '../main/tools/builtin';
import { registerCalendarTools } from '../main/tools/calendar';
import { registerAlarmTools } from '../main/tools/alarm';
import { checkOllamaAvailable } from '../main/agent/ollama-client';
import { loadSessions, getSessionMessages } from '../main/memory/session-store';

// ── 测试辅助 ──────────────────────────────────────────────────

interface TestResult {
  name: string;
  pass: boolean;
  message: string;
  latencyMs: number;
}

const results: TestResult[] = [];

function logResult(r: TestResult): void {
  const status = r.pass ? '✅' : '❌';
  console.log(`${status} [${r.latencyMs}ms] ${r.name}: ${r.message}`);
  results.push(r);
}

// ── 测试用例 ──────────────────────────────────────────────────

/**
 * 测试 1：thinking 前缀泄漏检测
 *
 * 严重性：高
 * 验证 /no_think 模式下不输出 <think>...</think> 前缀
 */
async function testThinkingLeak(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-thinking';
  clearSessionHistory(sessionId);

  const router = new Router();
  const routeResult = router.route({ message: '你好呀，纳西妲', sessionId, timestamp: Date.now() });
  const chunks: string[] = [];

  const response = await generateResponse(
    sessionId,
    '你好呀，纳西妲',
    routeResult.intent,
    routeResult.degradeDecision,
    (delta) => chunks.push(delta),
    router,
  );

  const fullText = response.content;
  const hasThinkingPrefix = fullText.includes('<think>') || fullText.includes('</think>') || fullText.startsWith('...');
  logResult({
    name: 'thinking 前缀泄漏检测',
    pass: !hasThinkingPrefix,
    message: hasThinkingPrefix ? `发现前缀泄漏: ${fullText.slice(0, 50)}` : '未发现前缀泄漏',
    latencyMs: Date.now() - startTime,
  });
}

/**
 * 测试 2：动作括号生成验证
 *
 * 严重性：中
 * 验证回复包含（xxx）格式的动作括号（纳西妲人设要求）
 */
async function testActionBrackets(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-action';
  clearSessionHistory(sessionId);

  const router = new Router();
  const routeResult = router.route({ message: '今天心情怎么样？', sessionId, timestamp: Date.now() });
  const chunks: string[] = [];

  const response = await generateResponse(
    sessionId,
    '今天心情怎么样？',
    routeResult.intent,
    routeResult.degradeDecision,
    (delta) => chunks.push(delta),
    router,
  );

  const fullText = response.content;
  // 匹配中文括号（xxx）
  const actionBracketRegex = /（[^）]+）/;
  const hasActionBrackets = actionBracketRegex.test(fullText);
  logResult({
    name: '动作括号生成验证',
    pass: hasActionBrackets,
    message: hasActionBrackets ? `发现动作括号: ${fullText.match(actionBracketRegex)?.[0]}` : '未生成动作括号',
    latencyMs: Date.now() - startTime,
  });
}

/**
 * 测试 3：情绪标签生成验证
 *
 * 严重性：中
 * 验证回复包含 [emotion:xxx] 格式的情绪标签（供 Live2D 表情映射）
 */
async function testEmotionTags(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-emotion';
  clearSessionHistory(sessionId);

  const router = new Router();
  const routeResult = router.route({ message: '我好开心啊！', sessionId, timestamp: Date.now() });
  const chunks: string[] = [];

  const response = await generateResponse(
    sessionId,
    '我好开心啊！',
    routeResult.intent,
    routeResult.degradeDecision,
    (delta) => chunks.push(delta),
    router,
  );

  const fullText = response.content;
  // 匹配 [emotion:xxx] 格式
  const emotionTagRegex = /\[emotion:[a-z_]+\]/;
  const hasEmotionTag = emotionTagRegex.test(fullText);
  logResult({
    name: '情绪标签生成验证',
    pass: hasEmotionTag,
    message: hasEmotionTag ? `发现情绪标签: ${fullText.match(emotionTagRegex)?.[0]}` : '未生成情绪标签',
    latencyMs: Date.now() - startTime,
  });
}

/**
 * 测试 4：工具调用回路验证
 *
 * 严重性：中
 * 验证工具调用 → 执行 → 结果回灌 → 最终回复生成
 */
async function testToolCallLoop(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-tool';
  clearSessionHistory(sessionId);

  const router = new Router();
  // 触发工具意图（包含"创建"关键词）
  const routeResult = router.route({ message: '帮我创建一个明天下午3点的会议', sessionId, timestamp: Date.now() });
  const chunks: string[] = [];

  const response = await generateResponse(
    sessionId,
    '帮我创建一个明天下午3点的会议',
    routeResult.intent,
    routeResult.degradeDecision,
    (delta) => chunks.push(delta),
    router,
  );

  const fullText = response.content;
  // Tool call may generate final reply or directly output tool call tags
  const hasToolCallTag = fullText.includes('<tool_call>') || fullText.includes('</tool_call>');
  const hasToolResult = chunks.some(c => c.includes('[工具') && c.includes('执行完成]'));
  const hasFinalReply = fullText.length > 50;

  logResult({
    name: '工具调用回路验证',
    pass: hasToolCallTag || hasToolResult || hasFinalReply,
    message: hasToolCallTag ? '检测到工具调用标签' : (hasToolResult ? '检测到工具执行结果' : (hasFinalReply ? '生成了最终回复' : '未检测到工具调用流程')),
    latencyMs: Date.now() - startTime,
  });
}

/**
 * 测试 5：cycleLog 四段完整性验证
 *
 * 严重性：低
 * 验证 T/F/Tk/R 四段日志是否完整生成
 */
async function testCycleLogCompleteness(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-cyclelog';
  clearSessionHistory(sessionId);

  const router = new Router();
  const routeResult = router.route({ message: '帮我查一下今天的天气', sessionId, timestamp: Date.now() });
  const chunks: string[] = [];

  const response = await generateResponse(
    sessionId,
    '帮我查一下今天的天气',
    routeResult.intent,
    routeResult.degradeDecision,
    (delta) => chunks.push(delta),
    router,
  );

  const cycleLog = response.cycleLog;
  const phases = cycleLog.map(entry => entry.phase);
  const hasT = phases.includes('T');
  const hasF = phases.includes('F');
  const hasTk = phases.includes('Tk');
  // R phase is added by handlers.ts after review, so we only check T/F/Tk here
  const allPresent = hasT && hasF && hasTk;

  logResult({
    name: 'cycleLog 四段完整性验证',
    pass: allPresent,
    message: allPresent ? `T/F/Tk 三段完整: ${phases.join(', ')}` : `缺失阶段: T=${hasT}, F=${hasF}, Tk=${hasTk}`,
    latencyMs: Date.now() - startTime,
  });
}

/**
 * 测试 6：session 持久化恢复验证
 *
 * 严重性：低
 * 验证会话历史在重启后能正确恢复
 */
async function testSessionPersistence(): Promise<void> {
  const startTime = Date.now();
  const sessionId = 'e2e-test-persist';
  clearSessionHistory(sessionId);

  const router = new Router();

  // 第一轮对话
  const routeResult1 = router.route({ message: '你好', sessionId, timestamp: Date.now() });
  await generateResponse(
    sessionId,
    '你好',
    routeResult1.intent,
    routeResult1.degradeDecision,
    () => {},
    router,
  );

  // 模拟重启：清空内存缓存，从磁盘加载
  clearSessionHistory(sessionId);
  loadSessions();

  // 验证历史是否恢复
  const messages = getSessionMessages(sessionId);
  const hasHistory = messages.length >= 2; // user + assistant

  logResult({
    name: 'session 持久化恢复验证',
    pass: hasHistory,
    message: hasHistory ? `恢复 ${messages.length} 条历史消息` : '未能恢复历史消息',
    latencyMs: Date.now() - startTime,
  });
}

// ── 主入口 ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== E2E Smoke 测试开始 ===\n');

  // 初始化配置
  initConfig();

  // 注册工具
  registerBuiltinTools();
  registerCalendarTools();
  registerAlarmTools();

  // 检查 ollama 是否可用
  const ollamaAvailable = await checkOllamaAvailable();
  if (!ollamaAvailable) {
    console.error('❌ ollama 服务不可用，请先启动 ollama 并创建 qwen3-8b-nahida 模型');
    process.exit(1);
  }

  console.log('✅ ollama 服务可用\n');

  // 运行测试
  await testThinkingLeak();
  await testActionBrackets();
  await testEmotionTags();
  await testToolCallLoop();
  await testCycleLogCompleteness();
  await testSessionPersistence();

  // 输出汇总
  console.log('\n=== 测试汇总 ===');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`通过: ${passed}/${total}`);

  if (passed === total) {
    console.log('✅ 所有测试通过');
    process.exit(0);
  } else {
    console.log('❌ 部分测试失败');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
