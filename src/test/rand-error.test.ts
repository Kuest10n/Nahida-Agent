import { appendReviewError, getErrorCounts, consumePendingReports, type ReviewErrorType } from '../main/agent/rand-error';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function logTest(name: string, passed: boolean): void {
  console.log(passed ? `✅ ${name}` : `❌ ${name}`);
}

async function runTests(): Promise<void> {
  console.log('\n=== rand-error.ts 测试 ===\n');

  let passed = 0;
  let total = 0;

  total++;
  try {
    for (let i = 0; i < 50; i++) {
      appendReviewError('A-OOC', '作为AI建议你休息');
    }
    const reports = consumePendingReports();
    assert(reports.length === 1, '连续追加 50 条同类型错误生成报告');
    assert(reports[0].type === 'A-OOC', '报告类型正确');
    assert(reports[0].count === 50, '报告计数正确');
    passed++;
    logTest('连续追加 50 条同类型错误 → 生成报告', true);
  } catch (e) {
    logTest('连续追加 50 条同类型错误 → 生成报告', false);
    console.error(e);
  }

  total++;
  try {
    for (let i = 0; i < 10; i++) {
      appendReviewError('B-bracket', '缺少括号的输出');
    }
    const reports = consumePendingReports();
    assert(reports.length === 0, '追加 10 条错误不生成报告');
    passed++;
    logTest('追加 10 条错误 → 不生成报告', true);
  } catch (e) {
    logTest('追加 10 条错误 → 不生成报告', false);
    console.error(e);
  }

  total++;
  try {
    for (let i = 0; i < 30; i++) {
      appendReviewError('A-OOC', 'ooc sample');
      appendReviewError('B-bracket', 'bracket sample');
    }
    const counts = getErrorCounts();
    assert(counts['A-OOC'] >= 30, 'A-OOC 计数正确');
    assert(counts['B-bracket'] >= 30, 'B-bracket 计数正确');
    passed++;
    logTest('多类型混合 → 各类型独立计数', true);
  } catch (e) {
    logTest('多类型混合 → 各类型独立计数', false);
    console.error(e);
  }

  total++;
  try {
    const reportsBefore = consumePendingReports();
    for (let i = 0; i < 50; i++) {
      appendReviewError('C-mismatch', 'mismatch sample');
    }
    for (let i = 0; i < 10; i++) {
      appendReviewError('C-mismatch', 'additional sample');
    }
    const reports = consumePendingReports();
    assert(reports.length === 1, '生成报告后继续追加仍保留部分记录');
    const remaining = getErrorCounts()['C-mismatch'];
    assert(remaining >= 10, '保留最近 10 条记录');
    passed++;
    logTest('报告生成后保留最近 10 条记录', true);
  } catch (e) {
    logTest('报告生成后保留最近 10 条记录', false);
    console.error(e);
  }

  total++;
  try {
    for (let i = 0; i < 100; i++) {
      appendReviewError('D-tool', 'tool sample');
    }
    for (let i = 0; i < 50; i++) {
      appendReviewError('D-tool', 'tool sample');
    }
    const reports = consumePendingReports();
    assert(reports.length >= 1, '超过 MAX_RECORDS_PER_TYPE 仍能生成报告');
    passed++;
    logTest('超过 MAX_RECORDS_PER_TYPE → 仍能生成报告', true);
  } catch (e) {
    logTest('超过 MAX_RECORDS_PER_TYPE → 仍能生成报告', false);
    console.error(e);
  }

  total++;
  try {
    const reports = consumePendingReports();
    assert(reports.length === 0, '无待处理报告时返回空数组');
    passed++;
    logTest('无待处理报告 → 返回空数组', true);
  } catch (e) {
    logTest('无待处理报告 → 返回空数组', false);
    console.error(e);
  }

  console.log(`\n=== 测试完成：${passed}/${total} 通过 ===\n`);
}

runTests().catch(console.error);