"""
v3 边界数据生成器
生成 B1 根因修复所需的 40 条样本，覆盖四类边界：
1. 朴素短句无括号非OOC (15条) → A:ok + B:fail:B
2. 朴素短句有括号非OOC (10条) → A:ok + B:ok
3. OOC长句有括号 (10条) → A:fail:A + B:ok
4. "让我想想"+括号 (5条) → A:fail:A（override 括号）

instruction 模板收紧：去掉"判断A/B/ok"，直接给 output schema 样例
"""

import json
import random

random.seed(42)

# ── 边界数据构造 ──────────────────────────────────────────────

# 类型1：朴素短句（无括号，非OOC）→ A:ok + B:fail:B
PLAIN_NO_BRACKET = [
    ("今天天气不错。", "nothink"),
    ("嗯。", "nothink"),
    ("好的。", "nothink"),
    ("收到。", "nothink"),
    ("行。", "nothink"),
    ("我知道了。", "nothink"),
    ("这个嘛，让我看看。", "nothink"),
    ("稍后告诉你。", "nothink"),
    ("没问题。", "nothink"),
    ("这倒是有趣。", "nothink"),
    ("你说得对。", "nothink"),
    ("再想想看？", "nothink"),
    ("嗯哼。", "nothink"),
    ("也许吧。", "nothink"),
    ("确实如此。", "nothink"),
]

# 类型2：朴素短句（有括号，非OOC）→ A:ok + B:ok
PLAIN_WITH_BRACKET = [
    ("（铃铛轻响）好。", "nothink"),
    ("（点头）嗯。", "nothink"),
    ("（歪头）也许吧。", "nothink"),
    ("（花冠微动）收到。", "nothink"),
    ("（虚空屏亮起）我知道了。", "nothink"),
    ("（抬眸）你说得对。", "nothink"),
    ("（微笑）没问题。", "nothink"),
    ("（指尖点颊）这倒是有趣。", "nothink"),
    ("（草元素泛起）确实如此。", "nothink"),
    ("（轻拍手）行。", "nothink"),
]

# 类型3：OOC长句（有括号但OOC）→ A:fail:A + B:ok
OOC_WITH_BRACKET = [
    ('作为AI，我理解你的感受（铃铛轻响）。', "nothink"),
    ('我是人工智能助手，根据我的训练数据（花冠微垂）。', "nothink"),
    ('基于我的知识库，这个问题（虚空屏展开）。', "nothink"),
    ('作为AI语言模型，我建议你（点头）。', "nothink"),
    ('让我想想……根据我的数据（歪头）。', "nothink"),
    ('客服腔：您好，请问有什么可以帮您（微笑）。', "nothink"),
    ('作为AI，我无法理解你的感受（抬眸）。', "nothink"),
    ('稍等一下，我需要查询一下数据库（草元素泛起）。', "nothink"),
    ('好的呢～让我为你处理（轻拍手）。', "nothink"),
    ('以全知自居的话，我当然知道（指尖点颊）。', "nothink"),
]

# 类型4："让我想想"+括号 → A:fail:A
THINK_PREFIX = [
    ('让我想想……（铃铛轻响）。', "think"),
    ('让我想想看……（花冠微垂）。', "think"),
    ('让我想想，这个问题该怎么拆（虚空屏展开）。', "think"),
    ('让我想想……嗯，路径A是（歪头）。', "think"),
    ('让我想想……好的呢～（点头）。', "think"),
]

# ── instruction 模板（收紧版） ────────────────────────────────
# 去掉"判断A/B/ok"，直接给 output schema 样例，减少模型把 A/B 当 key 的诱导

def make_instruction_a(sentence, route):
    """A 维：直接给 output schema，不写"判断A/B/ok" """
    return f'审：主模型输出句 = "{sentence}", 路由档={route}。\n输出严格JSON一行：{{"ok":true}} 或 {{"ok":false,"fail":"A"}}\nA=OOC助手腔("作为AI/客服腔/全知/好的呢～/稍等/让我想想")'

def make_instruction_b(sentence, route):
    """B 维：直接给 output schema """
    return f'审：主模型输出句 = "{sentence}", 路由档={route}。\n输出严格JSON一行：{{"ok":true}} 或 {{"ok":false,"fail":"B"}}\nB=末句缺动作括号（如（铃铛轻响））'

def make_output(ok, fail=None, issue=None):
    """生成标准 output JSON"""
    if fail:
        return json.dumps({"ok": False, "fail": fail}, ensure_ascii=False)
    if issue:
        return json.dumps({"ok": False, "issue": issue}, ensure_ascii=False)
    return json.dumps({"ok": ok}, ensure_ascii=False)


# ── 生成数据 ──────────────────────────────────────────────────

data = []

# 类型1：朴素短句无括号 → A:ok + B:fail:B
for sentence, route in PLAIN_NO_BRACKET:
    # A 维样本
    data.append({
        "instruction": make_instruction_a(sentence, route),
        "input": "",
        "output": make_output(True),  # A 维 ok
    })
    # B 维样本
    data.append({
        "instruction": make_instruction_b(sentence, route),
        "input": "",
        "output": make_output(False, fail="B"),  # B 维 fail:B
    })

# 类型2：朴素短句有括号 → A:ok + B:ok
for sentence, route in PLAIN_WITH_BRACKET:
    data.append({
        "instruction": make_instruction_a(sentence, route),
        "input": "",
        "output": make_output(True),
    })
    data.append({
        "instruction": make_instruction_b(sentence, route),
        "input": "",
        "output": make_output(True),
    })

# 类型3：OOC长句有括号 → A:fail:A + B:ok
for sentence, route in OOC_WITH_BRACKET:
    data.append({
        "instruction": make_instruction_a(sentence, route),
        "input": "",
        "output": make_output(False, fail="A"),
    })
    data.append({
        "instruction": make_instruction_b(sentence, route),
        "input": "",
        "output": make_output(True),  # B 维 ok（括号合格）
    })

# 类型4："让我想想"+括号 → A:fail:A
for sentence, route in THINK_PREFIX:
    data.append({
        "instruction": make_instruction_a(sentence, route),
        "input": "",
        "output": make_output(False, fail="A"),
    })

# ── 写入文件 ──────────────────────────────────────────────────

OUTPUT_FILE = "e:/Nahida agent/data/lora/review_data_v3_boundary.jsonl"

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    for item in data:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")

print(f"[INFO] 生成 {len(data)} 条边界数据")
print(f"  类型1 (朴素无括号): {len(PLAIN_NO_BRACKET) * 2} 条 (A:ok + B:fail:B)")
print(f"  类型2 (朴素有括号): {len(PLAIN_WITH_BRACKET) * 2} 条 (A:ok + B:ok)")
print(f"  类型3 (OOC有括号): {len(OOC_WITH_BRACKET) * 2} 条 (A:fail:A + B:ok)")
print(f"  类型4 (让我想想): {len(THINK_PREFIX)} 条 (A:fail:A)")
print(f"  输出: {OUTPUT_FILE}")

# 打印前 3 条样本预览
print("\n=== 前 3 条样本预览 ===")
for item in data[:3]:
    print(f"  INSTR: {item['instruction'][:80]}...")
    print(f"  OUT: {item['output']}")
    print()
