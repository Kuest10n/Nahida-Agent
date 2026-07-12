***

description: 纳西妲 Agent 项目全局铁律——人设红线 + 架构禁令
alwaysApply: true
-----------------

# 纳西妲 Agent 全局规则

## 1. 人设红线（写任何 system prompt / SOHA.md / 角色卡时必须遵守）

- 纳西妲语气：温柔 + 苏格拉底反问 + 自然隐喻（逻辑杂草/虚空检索/心识印记/世界树）
- 禁止输出："作为AI"/"我是人工智能"/"客服腔无脑附和"/"以全知自居"
- 输出末句必须用动作括号收尾，如 `（铃铛轻响）` `（花冠微垂，怀念）` `（虚空屏微光一闪）`，供 Live2D 正则抽 tag
- 正反例写在 SOHA.md Appendix，每次改人设先对照

## 2. 模型分工（Agent 路由层必须遵守）

- **日常对话主模型**：本地 `qwen2.6:7b-instruct`（或 Qwen3-8B），`/no_think`，temp 0.7
- **深入思考**：云端 DeepSeek V4pro + 短 CoT
- **完备分析 / ToT**：云端 V4pro + Plan-Act 长链
- **DeepSeek-R1-7B**：仅用于完备分析的 ToT 支路采样，**禁止**用于日常人设主模型（R1 的 CoT 蒸馏惯性会冲掉纳西妲语气）
- 模型适配层：OpenAI-compatible + Anthropic-like 双协议

## 3. 架构禁令

- Electron 三层分离：main / preload / renderer，**preload 必须用 contextBridge 暴露，禁止关 contextIsolation**
- AG-UI 事件流：主进程 → 渲染层单向推，事件类型 `MODEL_DELTA | TOOL_CALL | STATE_CHANGE | LIVE2D_ACTION | TTS_CHUNK`
- Live2D 动作 tag 由**主进程正则抽**（从流式文本抽 `（xxx）` → 映射 expression/action），IPC 发渲染层，渲染层不负责抽
- 记忆分片：项目内 `memory/` 是源，OpenClaw workspace (`SOUL/IDENTITY/USER/worldbook`) 是镜像，改一处同步另一处
- 禁止功能：游戏代肝（违反米哈游守则）

## 4. 与 AI 协作方式（给我自己看的）

- 我是电力类大一非科班，术语请先解释再给代码
- 模糊需求先拆成"存储/通信/渲染/模型"等具体技术方案再动手，不要直接给一大坨
- 每步 diff 给我看，不要全 Accept 式生成

