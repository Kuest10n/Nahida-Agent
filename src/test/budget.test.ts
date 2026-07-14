import { estimateTokens, trimToBudget, type PromptBlock } from '../main/agent/budget';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function logTest(name: string, passed: boolean): void {
  console.log(passed ? `✅ ${name}` : `❌ ${name}`);
}

async function runTests(): Promise<void> {
  console.log('\n=== budget.ts 测试 ===\n');

  let passed = 0;
  let total = 0;

  total++;
  try {
    assert(estimateTokens('') === 0, '空字符串 token 为 0');
    assert(estimateTokens('test') === 3, '英文 token 估算');
    assert(estimateTokens('你好') === 2, '中文 token 估算');
    passed++;
    logTest('estimateTokens 基本功能', true);
  } catch (e) {
    logTest('estimateTokens 基本功能', false);
    console.error(e);
  }

  total++;
  try {
    const blocks: PromptBlock[] = [
      { tag: 'soha', content: 'x'.repeat(5000), priority: 100 },
      { tag: 'worldbook', content: 'worldbook1', priority: 90 },
      { tag: 'worldbook', content: 'worldbook2', priority: 80 },
    ];
    const result = trimToBudget(blocks);
    assert(result.dropped.length === 2, '常驻块超 ceiling 时 worldbook 被丢弃');
    passed++;
    logTest('常驻块超 ceiling → worldbook 被丢弃', true);
  } catch (e) {
    logTest('常驻块超 ceiling → worldbook 被丢弃', false);
    console.error(e);
  }

  total++;
  try {
    const blocks: PromptBlock[] = [
      { tag: 'soha', content: 'x'.repeat(100), priority: 100 },
      { tag: 'worldbook', content: 'x'.repeat(2000), priority: 90 },
    ];
    const result = trimToBudget(blocks);
    assert(result.dropped[0]?.startsWith('worldbook'), 'worldbook 单块超 800token 被丢弃');
    passed++;
    logTest('worldbook 单块超 800token → 被丢弃', true);
  } catch (e) {
    logTest('worldbook 单块超 800token → 被丢弃', false);
    console.error(e);
  }

  total++;
  try {
    const blocks: PromptBlock[] = [
      { tag: 'soha', content: 'x'.repeat(100), priority: 100 },
      { tag: 'worldbook', content: 'high', priority: 90 },
      { tag: 'worldbook', content: 'low', priority: 80 },
      { tag: 'worldbook', content: 'mid', priority: 85 },
    ];
    const result = trimToBudget(blocks);
    const keptWb = result.kept.filter(b => b.tag === 'worldbook');
    assert(keptWb[0]?.content === 'high', '高优先级 worldbook 先保留');
    assert(keptWb[1]?.content === 'mid', '中优先级 worldbook 次之');
    passed++;
    logTest('多块不同 priority → 高优先级先保留', true);
  } catch (e) {
    logTest('多块不同 priority → 高优先级先保留', false);
    console.error(e);
  }

  total++;
  try {
    const blocks: PromptBlock[] = [
      { tag: 'soha', content: 'x'.repeat(100), priority: 100 },
      { tag: 'shard', content: 'x'.repeat(2000), priority: 50 },
    ];
    const result = trimToBudget(blocks);
    assert(result.dropped[0]?.startsWith('shard'), 'shard 超 ceiling 被丢弃');
    passed++;
    logTest('shard 超 ceiling → 被丢弃', true);
  } catch (e) {
    logTest('shard 超 ceiling → 被丢弃', false);
    console.error(e);
  }

  total++;
  try {
    const blocks: PromptBlock[] = [
      { tag: 'soha', content: 'x'.repeat(100), priority: 100 },
      { tag: 'worldbook', content: 'wb1', priority: 90 },
      { tag: 'shard', content: 'shard1', priority: 50 },
      { tag: 'other', content: 'tool', priority: 70 },
    ];
    const result = trimToBudget(blocks);
    assert(result.kept.length === 4, '所有块都在预算内');
    assert(result.totalTokens > 0, 'token 计算正确');
    passed++;
    logTest('正常预算场景', true);
  } catch (e) {
    logTest('正常预算场景', false);
    console.error(e);
  }

  console.log(`\n=== 测试完成：${passed}/${total} 通过 ===\n`);
}

runTests().catch(console.error);