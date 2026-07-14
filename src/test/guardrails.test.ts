import { ToolGuardrails } from '../main/safety/guardrails';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function logTest(name: string, passed: boolean): void {
  console.log(passed ? `✅ ${name}` : `❌ ${name}`);
}

async function runTests(): Promise<void> {
  console.log('\n=== guardrails.ts 测试 ===\n');

  let passed = 0;
  let total = 0;

  total++;
  try {
    const result = ToolGuardrails.repairJson('{"q": "test",}');
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.q === 'test', '尾逗号修复后值正确');
    passed++;
    logTest('{"q": "test",} → 修复为合法 JSON', true);
  } catch (e) {
    logTest('{"q": "test",} → 修复为合法 JSON', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson("{'name': 'test'}");
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.name === 'test', '单引号转双引号后值正确');
    passed++;
    logTest("{'name': 'test'} → 单引号转双引号", true);
  } catch (e) {
    logTest("{'name': 'test'} → 单引号转双引号", false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{query: "search"}');
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.query === 'search', '缺引号键被补全');
    passed++;
    logTest('{query: "search"} → 缺引号键被补全', true);
  } catch (e) {
    logTest('{query: "search"} → 缺引号键被补全', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson("{'desc': 'it\\'s a test'}");
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.desc === "it's a test", '嵌套单引号正确处理');
    passed++;
    logTest("{'desc': 'it\\'s a test'} → 嵌套单引号正确处理", true);
  } catch (e) {
    logTest("{'desc': 'it\\'s a test'} → 嵌套单引号正确处理", false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('```json\n{"key": "value"}\n```');
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.key === 'value', 'markdown 代码块被去除');
    passed++;
    logTest('markdown 代码块包裹 → 被去除', true);
  } catch (e) {
    logTest('markdown 代码块包裹 → 被去除', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{"my-key": "value"}');
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed['my-key'] === 'value', '键名含连字符正确保留');
    passed++;
    logTest('{"my-key": "value"} → 键名含连字符正确保留', true);
  } catch (e) {
    logTest('{"my-key": "value"} → 键名含连字符正确保留', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{"a": 1, "b": 2,}');
    assert(result !== null, '修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.a === 1 && parsed.b === 2, '多个尾逗号修复');
    passed++;
    logTest('{"a": 1, "b": 2,} → 多个尾逗号修复', true);
  } catch (e) {
    logTest('{"a": 1, "b": 2,} → 多个尾逗号修复', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{invalid}');
    assert(result === null, '无法修复的 JSON 返回 null');
    passed++;
    logTest('{invalid} → 返回 null', true);
  } catch (e) {
    logTest('{invalid} → 返回 null', false);
    console.error(e);
  }

  total++;
  try {
    const guardrails = new ToolGuardrails();
    const result1 = guardrails.check({ toolName: 'test', parameters: {}, sessionId: 'test-session' });
    assert(result1.pass, '第一次调用通过');
    const result2 = guardrails.check({ toolName: 'test', parameters: {}, sessionId: 'test-session' });
    assert(result2.pass, '第二次调用通过');
    const result3 = guardrails.check({ toolName: 'test', parameters: {}, sessionId: 'test-session' });
    assert(result3.pass, '第三次调用通过');
    const result4 = guardrails.check({ toolName: 'test', parameters: {}, sessionId: 'test-session' });
    assert(!result4.pass, '第四次调用被限制');
    passed++;
    logTest('频率限制：10秒内最多3次', true);
  } catch (e) {
    logTest('频率限制：10秒内最多3次', false);
    console.error(e);
  }

  total++;
  try {
    const guardrails = new ToolGuardrails();
    for (let i = 0; i < 6; i++) {
      const result = guardrails.check({ toolName: `tool-${i}`, parameters: {}, sessionId: 'storm-session' });
      if (i === 5) {
        assert(result.degrade, '第6次调用触发降级');
      } else {
        assert(result.pass, '前5次调用通过');
      }
    }
    passed++;
    logTest('风暴检测：一轮对话超过5次调用触发降级', true);
  } catch (e) {
    logTest('风暴检测：一轮对话超过5次调用触发降级', false);
    console.error(e);
  }

  // S2: 混合错误修复边界测试
  total++;
  try {
    const result = ToolGuardrails.repairJson('{"a": \'it\'s "test"\', "b": [1,2,3],}');
    assert(result !== null, '混合错误修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.a === 'it\'s "test"', '单引号、双引号、尾逗号混合场景正确修复');
    assert(Array.isArray(parsed.b) && parsed.b.length === 3, '数组值正确');
    passed++;
    logTest('{"a": \'it\'s "test"\', "b": [1,2,3],} → 单引号、双引号、尾逗号混合修复', true);
  } catch (e) {
    logTest('{"a": \'it\'s "test"\', "b": [1,2,3],} → 单引号、双引号、尾逗号混合修复', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{query: \'search "term"\', limit: 10,}');
    assert(result !== null, '缺引号键 + 单引号 + 尾逗号修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.query === 'search "term"', '缺引号键被补全且值正确');
    assert(parsed.limit === 10, '数值类型正确');
    passed++;
    logTest('{query: \'search "term"\', limit: 10,} → 缺引号键 + 单引号 + 尾逗号混合修复', true);
  } catch (e) {
    logTest('{query: \'search "term"\', limit: 10,} → 缺引号键 + 单引号 + 尾逗号混合修复', false);
    console.error(e);
  }

  total++;
  try {
    const result = ToolGuardrails.repairJson('{"nested": {"key": \'value\'}, "array": [1, 2,],}');
    assert(result !== null, '嵌套对象 + 数组尾逗号修复后不为 null');
    const parsed = JSON.parse(result!);
    assert(parsed.nested.key === 'value', '嵌套对象值正确');
    assert(Array.isArray(parsed.array) && parsed.array.length === 2, '数组值正确');
    passed++;
    logTest('{"nested": {"key": \'value\'}, "array": [1, 2,],} → 嵌套对象 + 数组尾逗号修复', true);
  } catch (e) {
    logTest('{"nested": {"key": \'value\'}, "array": [1, 2,],} → 嵌套对象 + 数组尾逗号修复', false);
    console.error(e);
  }

  console.log(`\n=== 测试完成：${passed}/${total} 通过 ===\n`);
}

runTests().catch(console.error);