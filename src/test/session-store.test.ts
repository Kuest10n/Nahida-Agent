import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendMessage, getSessionMessages, cleanupExpired, resetSessionStore } from '../main/memory/session-store';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function logTest(name: string, passed: boolean): void {
  console.log(passed ? `✅ ${name}` : `❌ ${name}`);
}

async function runTests(): Promise<void> {
  console.log('\n=== session-store.ts 测试 ===\n');

  resetSessionStore();

  let passed = 0;
  let total = 0;

  total++;
  try {
    appendMessage('test-session', 'user', 'Hello');
    appendMessage('test-session', 'assistant', 'Hi there');
    const messages = getSessionMessages('test-session');
    assert(messages.length === 2, '消息数量为 2');
    assert(messages[0].role === 'user' && messages[0].content === 'Hello', '第一条消息正确');
    assert(messages[1].role === 'assistant' && messages[1].content === 'Hi there', '第二条消息正确');
    passed++;
    logTest('追加两条消息 → 消息数量为 2，内容正确', true);
  } catch (e) {
    logTest('追加两条消息 → 消息数量为 2，内容正确', false);
    console.error(e);
  }

  total++;
  try {
    const messages = getSessionMessages('non-existent-session');
    assert(messages.length === 0, '不存在的 session 返回空数组');
    passed++;
    logTest('查询不存在的 session → 返回空数组', true);
  } catch (e) {
    logTest('查询不存在的 session → 返回空数组', false);
    console.error(e);
  }

  total++;
  try {
    resetSessionStore();
    const messages = getSessionMessages('test-session');
    assert(messages.length === 0, '重置后 session 为空');
    passed++;
    logTest('resetSessionStore → session 被清空', true);
  } catch (e) {
    logTest('resetSessionStore → session 被清空', false);
    console.error(e);
  }

  total++;
  try {
    resetSessionStore();
    const oldTime = Date.now() - 31 * 60 * 1000;
    const sessionData = {
      sessionId: 'expired-session',
      lastActivity: oldTime,
      messages: [{ role: 'user', content: 'old message', timestamp: oldTime }],
    };
    const sessionsDir = path.resolve(process.cwd(), 'data', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'expired-session.json'), JSON.stringify(sessionData));

    resetSessionStore();
    cleanupExpired();
    const messages = getSessionMessages('expired-session');
    assert(messages.length === 0, '过期 session 被清理');
    const fileExists = fs.existsSync(path.join(sessionsDir, 'expired-session.json'));
    assert(!fileExists, '过期 session 文件被删除');
    passed++;
    logTest('过期 session → cleanupExpired 后被清理', true);
  } catch (e) {
    logTest('过期 session → cleanupExpired 后被清理', false);
    console.error(e);
  }

  // S1: 并发竞态测试
  total++;
  try {
    resetSessionStore();
    const concurrentSessionId = 'concurrent-test-session';
    const concurrentTasks = 10;
    const messagesPerTask = 100;
    const expectedTotal = concurrentTasks * messagesPerTask;

    // 启动 10 个并发任务，每个 append 100 条消息
    const promises: Promise<void>[] = [];
    for (let i = 0; i < concurrentTasks; i++) {
      const taskPromise = (async () => {
        for (let j = 0; j < messagesPerTask; j++) {
          appendMessage(concurrentSessionId, 'user', `Message ${i}-${j}`);
        }
      })();
      promises.push(taskPromise);
    }

    // 等待所有并发任务完成
    await Promise.all(promises);

    // 验证最终消息数
    const messages = getSessionMessages(concurrentSessionId);
    assert(messages.length === expectedTotal, `并发写入后消息数量应为 ${expectedTotal}，实际为 ${messages.length}`);
    
    // 验证无重复消息（通过检查消息内容的唯一性）
    const uniqueContents = new Set(messages.map(m => m.content));
    assert(uniqueContents.size === expectedTotal, `应无重复消息，唯一消息数应为 ${expectedTotal}，实际为 ${uniqueContents.size}`);

    passed++;
    logTest('并发写入完整性 → 10 个并发任务各 append 100 条消息，最终消息数 = 1000，无丢失无重复', true);
  } catch (e) {
    logTest('并发写入完整性 → 10 个并发任务各 append 100 条消息，最终消息数 = 1000，无丢失无重复', false);
    console.error(e);
  }

  console.log(`\n=== 测试完成：${passed}/${total} 通过 ===\n`);
}

runTests().catch(console.error);