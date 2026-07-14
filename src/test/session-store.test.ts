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

  console.log(`\n=== 测试完成：${passed}/${total} 通过 ===\n`);
}

runTests().catch(console.error);