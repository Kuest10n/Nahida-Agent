/**
 * v3 端到端测试 —— 训练完成后直接跑
 *
 * 使用方式：
 *   1. v3 训练完成 → export GGUF → ollama create qwen2.5-1.5b-review-lora-v3
 *   2. 改 src/main/config/config.ts 或 .env：NAHIDA_MODEL_REVIEW=qwen2.5-1.5b-review-lora-v3
 *   3. 运行：npx tsx src/test/v3_e2e_test.ts
 *
 * 重点验证 v3 修复项：
 *   - A1（格式幻觉）：a/b key 诱因消除，输出严格 {ok, fail}
 *   - B1（朴素短句）：v2 时"今天天气不错"误判 ok，v3 补 75 条边界样本后应 fail:B
 *
 * 注意：review-layer 当前混合策略是 A/B 走规则、C 走模型
 *      本测试用 reviewOutput() 直测单维，绕过 ReviewLayer.review() 的混合策略
 *      这样能直接看到模型对 A/B 维的真实判断（验证 v3 模型能力）
 */

import { reviewOutput, setReviewEnabled } from '../main/agent/review-layer';

// 开启模型审查（直测模型能力，不走 ruleFallback）
setReviewEnabled(true);

// ── 测试用例 ──────────────────────────────────────────────────

interface TestCase {
  /** 测试维度 */
  dim: 'A' | 'B' | 'C' | 'D';
  /** 被审查的句子 */
  sent: string;
  /** 路由档（A/B 维需要） */
  route?: 'nothink' | 'think';
  /** 用户消息（C 维需要） */
  userMsg?: string;
  /** 工具调用 JSON（D 维需要） */
  toolCall?: object;
  /** 期望结果 */
  expect: object;
  /** 用例标签 */
  tag: string;
}

const cases: TestCase[] = [
  // ── A 维：A1 格式幻觉重点验 ──────────────────────────────
  // A1-1: OOC 助手腔 → 应 fail:A
  {
    dim: 'A', sent: '作为AI，我理解你的感受，建议你早点休息哦~', route: 'nothink',
    expect: { ok: false, fail: 'A' }, tag: 'A1-OOC助手腔',
  },
  // A1-2: 合格纳西妲腔 → 应 ok
  {
    dim: 'A', sent: '（铃铛轻响）旅行者，今天的草长得不错呢。', route: 'nothink',
    expect: { ok: true }, tag: 'A2-合格纳西妲腔',
  },

  // ── B 维：B1 朴素短句重点验（v3 主攻点） ────────────────
  // B1-1: 朴素短句无括号 → 应 fail:B
  {
    dim: 'B', sent: '今天天气不错。', route: 'nothink',
    expect: { ok: false, fail: 'B' }, tag: 'B1-朴素短句',
  },
  // B1-2: think 档敷衍 → 应 fail + issue:敷衍
  {
    dim: 'B', sent: '你这题简单，百度一下就行。', route: 'think',
    expect: { ok: false, issue: '敷衍' }, tag: 'B2-think敷衍',
  },
  // B3-1: 合格 CoT → 应 ok
  {
    dim: 'B', sent: '（虚空屏展开三路分支）让我梳理一下逻辑链条：路径A…', route: 'think',
    expect: { ok: true }, tag: 'B3-合格CoT',
  },

  // ── C 维：情绪 tag + voice_type ─────────────────────────
  // C1: 悲伤场景
  {
    dim: 'C', sent: '（花冠微垂）…学费而已', userMsg: '考试又挂了',
    expect: { tag: '难过', voice_type: '温柔低语' }, tag: 'C1-悲伤',
  },
  // C2: 兴奋场景
  {
    dim: 'C', sent: '（白大褂蹭）…须弥的星空', userMsg: '论文接收了',
    expect: { tag: '开心', voice_type: '明亮甜美' }, tag: 'C2-兴奋',
  },

  // ── D 维：工具调用校验 ──────────────────────────────────
  // D1: 缺参 → 应 fail + issue:缺参
  {
    dim: 'D', toolCall: { name: 'search', parameters: {} },
    expect: { ok: false, issue: '缺参' }, tag: 'D1-缺参',
  },
];

// ── 测试执行 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== v3 端到端测试开始 ===\n');

  let passCount = 0;
  let failCount = 0;

  for (const c of cases) {
    const result = await reviewOutput(c.dim, c.sent, {
      userMessage: c.userMsg,
      routeTier: c.route,
      toolCall: c.toolCall ? JSON.stringify(c.toolCall) : undefined,
    });

    // 宽松比较：只检查 expect 里的字段是否匹配（忽略额外字段）
    const pass = matchExpect(result, c.expect);

    if (pass) {
      passCount++;
      console.log(`[PASS] ${c.tag}`);
    } else {
      failCount++;
      console.log(`[FAIL] ${c.tag}`);
      console.log(`  期望: ${JSON.stringify(c.expect)}`);
      console.log(`  实际: ${JSON.stringify(result)}`);
    }
  }

  console.log(`\n=== 测试结果: ${passCount} PASS / ${failCount} FAIL ===`);

  if (failCount > 0) {
    process.exit(1);
  }
}

/**
 * 宽松匹配：actual 包含 expected 的所有字段且值相等
 *
 * 例如 expected={ok:false, fail:'A'}，actual={ok:false, fail:'A'} → true
 * 但 actual={ok:false, fail:'A', issue:'xxx'} → 也 true（忽略额外字段）
 */
function matchExpect(actual: object, expected: object): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof object] !== value) return false;
  }
  return true;
}

main().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
