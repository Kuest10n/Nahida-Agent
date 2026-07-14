<!-- 2026-07-14T02:06:10.015Z 自动生成 -->

## Rand_error: A-OOC（累计 50 次）

> 阈值 50，触发时间 2026/7/14 10:06:10

### 最近样本
1. `作为AI建议你休息`
2. `作为AI建议你休息`
3. `作为AI建议你休息`
4. `作为AI建议你休息`
5. `作为AI建议你休息`

### 建议修改方向
主模型频繁输出 OOC/助手腔。建议：1) 检查 SOHA.md §2 禁词列表是否完整；2) 考虑在 system prompt 加 few-shot 反例；3) 若 v3 模型 A 维准确率仍不够，保持规则兜底

---
<!-- 2026-07-14T02:06:10.042Z 自动生成 -->

## Rand_error: C-mismatch（累计 50 次）

> 阈值 50，触发时间 2026/7/14 10:06:10

### 最近样本
1. `mismatch sample`
2. `mismatch sample`
3. `mismatch sample`
4. `mismatch sample`
5. `mismatch sample`

### 建议修改方向
情绪 tag 与动作 tag 频繁不匹配。建议：1) 检查 emotion.ts ACTION_TAG_TO_ENUM 映射表是否覆盖当前所有动作 tag；2) 考虑在 C 维 fail 时用动作 tag 反推情绪 tag（而非要求主模重出）

---
<!-- 2026-07-14T02:06:10.043Z 自动生成 -->

## Rand_error: D-tool（累计 50 次）

> 阈值 50，触发时间 2026/7/14 10:06:10

### 最近样本
1. `tool sample`
2. `tool sample`
3. `tool sample`
4. `tool sample`
5. `tool sample`

### 建议修改方向
工具调用频繁校验失败。建议：1) 检查 TOOL_CALL_PROMPT 是否给了足够的参数示例；2) 考虑在 tool_executor 加 JSON 修复逻辑（fixSingleQuotes 已有，扩展到缺引号/多余逗号）

---

## Rand_error: D-tool（累计 50 次）

> 阈值 50，触发时间 2026/7/14 10:06:10

### 最近样本
1. `tool sample`
2. `tool sample`
3. `tool sample`
4. `tool sample`
5. `tool sample`

### 建议修改方向
工具调用频繁校验失败。建议：1) 检查 TOOL_CALL_PROMPT 是否给了足够的参数示例；2) 考虑在 tool_executor 加 JSON 修复逻辑（fixSingleQuotes 已有，扩展到缺引号/多余逗号）

---

## Rand_error: D-tool（累计 50 次）

> 阈值 50，触发时间 2026/7/14 10:06:10

### 最近样本
1. `tool sample`
2. `tool sample`
3. `tool sample`
4. `tool sample`
5. `tool sample`

### 建议修改方向
工具调用频繁校验失败。建议：1) 检查 TOOL_CALL_PROMPT 是否给了足够的参数示例；2) 考虑在 tool_executor 加 JSON 修复逻辑（fixSingleQuotes 已有，扩展到缺引号/多余逗号）

---
