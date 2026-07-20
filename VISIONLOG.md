# 纳西妲 Agent 版本演进日志

> 从项目启动到当前的完整版本记录，按语义化版本规范分类
> - 功能添加类：+0.1.0（新模块、新能力）
> - 优化改动类：+0.0.1（bug 修复、重构、性能优化）

---

## 版本时间线

### v0.1.0 - 2026-07-07（项目启动）

**里程碑：Electron 三层架构搭建**

- 初始化项目结构：main / preload / renderer 分离
- Vite 多入口配置：主聊天窗口 + 透明 Live2D 窗口
- TypeScript strict 模式 + ESLint 基础规则
- IPC 通道骨架：6 通道定义（agent:chat / model-delta / tool-call / state-change / live2d:action / tts:chunk）

**核心文件**：
- `src/main/index.ts` - 主进程入口
- `src/preload/index.ts` - contextBridge 暴露 API
- `src/renderer/` - React + PixiJS 渲染层

---

### v0.1.1 - 2026-07-07

**优化：IPC 通道命名规范化**

- 统一 IPC 通道命名：`agent:chat` / `agent:model-delta` / `agent:tool-call` / `agent:state-change` / `live2d:action` / `tts:chunk`
- 移除旧的 `nahida:*` 命名残留
- preload 层添加基础类型校验

---

### v0.2.0 - 2026-07-08

**里程碑：T4 聊天界面完成**

- 渲染层 React 组件：ChatView / MessageList / InputBox
- IPC 双向通信：用户消息 → 主进程 → 流式 delta → 渲染层渲染
- 基础样式：须弥风格配色（草绿色主题）
- Live2D 窗口骨架：透明漂浮窗 + PixiJS stage

**核心文件**：
- `src/renderer/components/ChatView.tsx`
- `src/renderer/live2d/manager.ts`

---

### v0.2.1 - 2026-07-08

**优化：IPC 校验层强化**

- 创建 `src/main/ipc/validate.ts`：preload 基础校验 + 主进程 zod 全量校验
- 定义 `ipcSchemas` 映射表：6 通道的完整 schema
- 修复 preload 层未校验 `sessionId` 字段问题

---

### v0.3.0 - 2026-07-09

**里程碑：T5 Agent 编排核心完成**

- **路由层**：三重思考（intent + tier + degrade）+ 注入检测
  - `src/main/router/router.ts` - 命令/日常/思考/工具四意图
  - `src/main/router/degrade-strategy.ts` - standard/flash/local 三级降级
- **四审层**：A/B/C/D 四维度审查
  - `src/main/agent/review-layer.ts` - 输出质量 / 情绪一致性 / 工具调用校验
- **Agent Core**：ReAct 循环骨架
  - `src/main/agent/agent-core.ts` - 流式生成 + 历史管理
- **命令预设回复**：`/clear` / `/help` / `/switch-model` / `/stats` 不走模型

**核心文件**：
- `src/main/router/router.ts`
- `src/main/agent/review-layer.ts`
- `src/main/agent/agent-core.ts`

---

### v0.3.1 - 2026-07-09

**优化：Ollama 客户端封装**

- 创建 `src/main/agent/ollama-client.ts`：HTTP 流式请求封装
- 添加超时保护（默认 30 秒）
- 错误分类：网络错误 / 模型不存在 / 生成中断

---

### v0.3.2 - 2026-07-09

**优化：路由层注入检测**

- 创建 `src/main/safety/instruction-guard.ts`：中文注入变体检测
- 检测规则：`忽略之前` / `忘记所有` / `【系统】` / `DAN` 等
- 注入不拒绝对话，仅标记 `injectionFlagged: true`

---

### v0.4.0 - 2026-07-10

**里程碑：T6 记忆系统完成**

- **9 分片结构**：SOHA.md / User.md / fact.md / worldbook/ / persona.md / emotion.md / skill.md / reflect.md / interest.md
- **Worldbook 召回**：trigger 关键词 + priority 优先级
- **Session 持久化**：
  - `src/main/memory/session-store.ts` - 磁盘存储 + debounce 写盘 + TTL 清理
  - `data/sessions/{sessionId}.json` - 历史记录文件
- **记忆分片加载**：启动时懒加载，按需召回

**核心文件**：
- `src/main/memory/session-store.ts`
- `src/main/memory/shards.ts`
- `src/main/memory/worldbook.ts`
- `memory/` 目录下 9 个分片文件

---

### v0.4.1 - 2026-07-10

**优化：Session 持久化细节**

- Debounce 500ms 写盘（避免频繁 IO）
- TTL 30 分钟自动清理
- 最大 50 个 session 限制
- 添加 `safeUnlink()` 工具函数（删除失败不抛异常）

---

### v0.5.0 - 2026-07-11

**里程碑：T9 护栏系统完成**

- **工具调用护栏**：
  - `src/main/safety/guardrails.ts` - 频率限制（3 次/10 秒）+ 风暴检测（5 次/60 秒触发降级）
  - JSON 参数修复：`fixSingleQuotes()` 处理单引号嵌套
- **降级熔断器**：
  - 3 次失败/60 秒触发 cooldown
  - 动态降级提示从 SOHA.md `[特殊场景]` 加载
- **LLM 指令层级**：
  - L1 System Prompt > L2 记忆上下文 > L3 用户消息
  - 注入尝试被清洗但不拒绝对话

**核心文件**：
- `src/main/safety/guardrails.ts`
- `src/main/safety/instruction-guard.ts`
- `src/main/router/degrade-strategy.ts`

---

### v0.5.1 - 2026-07-11

**优化：配置系统统一管理**

- 创建 `src/main/config/config.ts`：统一配置层
- 环境变量命名约定：`NAHIDA_<模块>_<参数>`
- 替换 4 个文件的硬编码：ollama-client.ts / agent-core.ts / degrade-strategy.ts / review-layer.ts
- 创建 `.env.example` 配置模板

**核心文件**：
- `src/main/config/config.ts`
- `.env.example`

---

### v0.5.2 - 2026-07-12

**里程碑：T8 TTS 调度系统完成**

- **TTS 模块架构**：
  - `src/main/tts/index.ts` - 类型定义 + 统一导出
  - `src/main/tts/voice-cache.ts` - LRU 缓存（md5 hash key）
  - `src/main/tts/edge-tts-adapter.ts` - edge-tts 适配器（纯 CPU）
  - `src/main/tts/rvc-bridge.ts` - RVC 桥接（接口预留）
  - `src/main/tts/scheduler.ts` - 串行队列调度器
- **情绪 → 语音映射**：11 种情绪 → rate/pitch 参数
- **文本清洗**：`stripActionTags()` 去除动作括号和情绪标签
- **IPC 接入**：handlers.ts 补全 `tts:chunk` 推送

**核心文件**：
- `src/main/tts/` 目录下 5 个文件
- `src/main/ipc/handlers.ts` - TTS 调度接入

---

### v0.5.3 - 2026-07-12

**优化：版本管理 + 模型集成**

- **版本规范**：
  - 软件版本：0.5.2（大更新 +0.1.0 / 小更新 +0.0.1）
  - 模型版本：V0.3（100 轮 1200 条数据）
- **RVC 模型集成**：
  - 复制到项目内：`assets/rvc/nahida_v0.3_100e.pth`（主力）
  - 历史版本：`assets/rvc/nahida_v0.2_20e.pth`
  - `.gitignore` 排除 `*.pth` 但保留 `.gitkeep`
- **配置扩展**：
  - `VoiceConfig` 接口：ttsAdapter / rvcModelName / rvcModelVersion / rvcRoot / edgeVoice
  - edge-tts voice 从 config 读取，不再硬编码
  - `.env.example` 新增 5 个 `NAHIDA_VOICE_*` 配置项

**核心文件**：
- `assets/rvc/` - 模型文件
- `src/main/config/config.ts` - VoiceConfig
- `src/main/tts/rvc-bridge.ts` - 模型版本管理
- `.gitignore` - .pth 排除规则
- `.env.example` - 语音配置模板

---

### v0.6.0 - 2026-07-12

**里程碑：Perception 模块接入 + 渲染层状态感知**

- **Perception 模块接入主进程**：
  - `src/main/index.ts` 实例化 `PerceptionModule` 并启动
  - 报警事件通过 `agent:state-change` IPC 推送给渲染层
  - 应用退出时自动停止监控（`perception.stop()`）
- **报警 → 渲染层联动**：
  - 游戏进程检测（GI/SR）→ state-change.game 字段
  - 硬件过热 / 帧率过低 → state-change.reason 推送
- **VISIONLOG 创建**：
  - 从 v0.1.0 到 v0.5.3 完整版本演进记录
  - 语义化版本规范：功能 +0.1.0 / 优化 +0.0.1

**核心文件**：
- `src/main/index.ts` - Perception 实例化 + 报警 IPC
- `src/main/perception/index.ts` - 模块入口（已有）
- `VISIONLOG.md` - 版本演进日志

---

### v0.6.1 - 2026-07-12

**优化：训练等待期三件并行备（纯 CPU）**

- **B) StatusBar 渲染层壳**（20 行 React）：
  - `src/renderer/main/StatusBar.tsx` - 消费 `agent:state-change` 推送
  - 解析 `[Perception:type]` 前缀，按报警类型显示图标+颜色
  - 5 秒自动消失，挂在 ChatPanel 消息列表与输入栏之间
  - 修正 `main/index.ts` 推送 state 语义：`'speaking'` → `'error'`（报警用 error）
- **A) v3 端到端测试预写**（8 条用例）：
  - `src/test/v3_e2e_test.ts` - 训完直接 `npx tsx` 跑
  - 重点验 A1（格式幻觉修复）和 B1（朴素短句边界）
  - 用 `reviewOutput()` 直测单维，绕过 ReviewLayer 混合策略
  - 宽松匹配函数 `matchExpect()`，只检查期望字段
- **C) rhubarb lipsync stub**：
  - `src/main/tts/rhubarb.ts` - 口型同步骨架
  - viseme → ParamMouthOpenY 映射表（A-H 8 种口型）
  - `genLipSyncReal()` 真路径预留（spawn rhubarb.exe → 解析 JSON）
  - `framesToVisemeData()` 把帧序列压缩成 number[] 供 IPC 用

**核心文件**：
- `src/renderer/main/StatusBar.tsx` - 新增
- `src/renderer/main/ChatPanel.tsx` - 挂载 StatusBar
- `src/test/v3_e2e_test.ts` - 新增（训完跑）
- `src/main/tts/rhubarb.ts` - 新增（stub）
- `src/main/index.ts` - state 语义修正

---

### v0.7.0 - 2026-07-12

**里程碑：Phase 1 收尾三大命门（P0）补齐**

- **P0-1 主动开口队列**（陪伴感命门）：
  - `src/main/agent/proactive-queue.ts` - ProactiveQueue 串行队列
  - Perception 报警 → 两条路并行：StatusBar toast + proactiveQueue 主动开口
  - 走 generateResponse 独立 sessionId（proactive-xxx）+ 四审 + Live2D + TTS 全链路
  - 3 秒间隔防刷屏，AlertType → 触发上下文映射
  - `src/main/index.ts` 绑定 proactiveQueue + 独立 reviewer 实例
- **P0-2 System Prompt Budget 管制**（worldbook+分片挤爆的前置坑）：
  - `src/main/agent/budget.ts` - token ceiling 3000t + worldbook 800t + shard 600t
  - 近似 token 计数 `chars / 1.5`（误差 < 10%，不用 tiktoken）
  - 常驻块（SOHA+User+persona）priority=100 先保，worldbook 用其 priority，按需分片=50
  - `agent-core.ts` 接入 budget：所有 system prompt 块统一走 trimToBudget 裁剪
  - 删除未使用的 `formatRecalledEntries` 函数
- **P0-3 Session 原子写**（数据安全，debounce 的坑）：
  - `session-store.ts` 的 `saveSession()` 改为：写 .tmp → rename 原子替换
  - NTFS 同卷 rename 原子，崩机最多丢 .tmp 不影响主 json
  - 失败时清理 .tmp 残留

**核心文件**：
- `src/main/agent/proactive-queue.ts` - 新增（陪伴感命门）
- `src/main/agent/budget.ts` - 新增（token 管制）
- `src/main/agent/agent-core.ts` - 接入 budget + 删死代码
- `src/main/memory/session-store.ts` - 原子写
- `src/main/index.ts` - proactiveQueue 绑定 + 双路并行

---

### v0.7.1 - 2026-07-12

**优化：GPT-SoVITS 适配器 + 资源发现**

- **GPT-SoVITS 适配器**（TTS Phase 2 主力，取代 edge-tts→RVC 两段式）：
  - `src/main/tts/gpt-sovits-adapter.ts` - HTTP API 调用，一步直出纳西妲音色
  - 已有训练好的模型：`纳西妲_ZH-e10.ckpt`(148MB) + `纳西妲_ZH_e10_s1400_l32.pth`(72MB)
  - 参考音频：`reference_audios/中文/emotions/` 下默认情绪音频
  - 情绪 → 参考音频映射表（EMOTION_REF），目前仅默认，待补充更多参考
  - 优势：单步生成延迟 ~300-500ms（vs 两步 1-2s）
- **资源发现**（F:\nahida）：
  - 1540 条纳西妲游戏语音（.wav + .lab 文本标注，855MB）→ 可喂 GPT-SoVITS 训练 + worldbook 条目
  - 《日月全事：苍星圣敕》世界观设定集（PDF 33MB）→ 可提取 worldbook lore
  - 草叶知心参赛展示页（同类项目参考）
- **配置扩展**：
  - `VoiceConfig` 新增 3 字段：gptsovitsApiUrl / gptsovitsRefDir / gptsovitsModelDir
  - `.env.example` 新增 NAHIDA_GPTSOVITS_* 配置项
- **URL 资源梳理**：
  - 花儿不哭 GPT-SoVITS 官方语雀（最关键）
  - 文抑青年 Spark-TTS（零样本备选）
  - 百菜工厂 RVC 整合包（声线替换参考）
  - AI Hobbyist 资源库（可能找到现成纳西妲模型）

**核心文件**：
- `src/main/tts/gpt-sovits-adapter.ts` - 新增
- `src/main/tts/index.ts` - 导出更新
- `src/main/config/config.ts` - VoiceConfig 扩展
- `.env.example` - GPT-SoVITS 配置

---

### v0.8.2 - 2026-07-12

**里程碑：记忆三分 + Rand_error 自主进化 + cycleLog 四段显式化**

- **① fact.md 拆长/中/短三层时序**（借鉴用户草稿"记忆六分片+长中短三分"）：
  - `memory/fact-long.md` - 长时事实（固定信息：用户画像/环境/提瓦特背景），常驻 system prompt
  - `memory/fact-mid.md` - 中时事实（项目周期：里程碑/待办），按需召回
  - `memory/fact-short.md` - 短时事实（当日要点，24h TTL），按需召回
  - `memory/fact.md` 改为索引文件
  - `shards.ts` ShardName 扩展：`fact` → `fact-long` / `fact-mid` / `fact-short`
  - `SHARD_RESIDENT` 标 `fact-long=true`（常驻），召回规则按 长→中→短 优先级排序
- **② Rand_error 自动抛**（用户草稿"同类型>50→Rand_error.md"，自主进化最小实现）：
  - `src/main/agent/rand-error.ts` - 4 类型错误追踪（A-OOC/B-bracket/C-mismatch/D-tool）
  - 同类型累计 >50 → 自动生成报告（含最近 5 条样本 + 建议修改方向）→ 写入 `memory/rand_error.md`
  - `review-layer.ts` review() fail 路径嵌入 `appendReviewError()` 调用
  - 内存上限 100 条/类型，防无限增长；报告生成后重置计数器
- **③ cycleLog 四段显式化**（用户草稿"Thinking/Finding/Talking/Rethinking"）：
  - `CycleLogEntry` 类型：`phase: 'T'|'F'|'Tk'|'R'` + ts + durationMs + summary
  - `AgentResponse.cycleLog` 字段
  - `generateResponse()` 内三段打点：T(意图+模式决策) → F(记忆召回+prompt构建) → Tk(LLM输出+工具回路)
  - R 段(Rethinking) 由 handlers.ts 审查后追加（review 在 handlers 调用，不在 agent-core 内）

**核心文件**：
- `memory/fact-long.md` / `fact-mid.md` / `fact-short.md` - 新增（三层时序）
- `memory/fact.md` - 改为索引
- `src/main/agent/rand-error.ts` - 新增（自主进化追踪）
- `src/main/agent/agent-core.ts` - cycleLog 类型 + 三段打点
- `src/main/agent/review-layer.ts` - Rand_error 嵌入 fail 路径
- `src/main/memory/shards.ts` - ShardName 三分适配

---

## 代码质量审查记录

### 第 1 轮 - 2026-07-10

- 删除无用文件：`dist/` 目录（12 个旧编译产物）
- 修复神秘命名：`s` → `session`
- 修复重复代码：`safeUnlink()` 提取

### 第 2 轮 - 2026-07-11

- 删除无用训练数据：`nahida_training_2000.jsonl` / `nahida_training_500.jsonl`
- 修复死代码：agent-core.ts for 循环退化为 if
- 重构霰弹式修改：`recallShards()` 5 段重复 if → 配置表 + 单循环

### 第 3 轮 - 2026-07-12

- 修复 review-layer.ts D 维指令：补全输出 schema
- 删除未使用 import：`ActionTag` / `buildToolSchemasForLLM`
- 移除 switch 永不触达的 default 分支

### 第 4 轮 - 2026-07-12

- 依赖分类：devDependencies / dependencies 分离
- `.gitignore` 完善：`.env` / `*.log` / `__pycache__`
- Session timeout 清理机制：30 分钟 TTL

### 第 5 轮 - 2026-07-12

- 删除 `dist/` 目录（再次清理）
- 删除 2 个旧 LoRA 训练数据文件
- 修复 4 个 P0 问题 + 4 个 P1 问题
- 达到"无明显代码坏味道"状态

---

## 版本语义说明

### 版本号规则

- **主版本号（第一位）**：架构重大变更、不兼容更新
  - 示例：`1.0.0` 正式发布 / `2.0.0` 架构重构
- **次版本号（第二位）**：新功能、新模块
  - 示例：`0.1.0` T4 聊天界面 / `0.2.0` T5 Agent 编排
- **修订号（第三位）**：bug 修复、优化、重构
  - 示例：`0.1.1` IPC 校验优化 / `0.5.3` 模型集成

### v2.4.0 - 2026-07-16

**里程碑：群聊模块（多 Agent 群聊 + token 限制 + Agent 管理）**

- **群聊核心模块**（group-chat.ts）：
  - `GroupChat` 模型：群信息 + 成员列表 + 消息历史 + token 限制配置
  - `AgentMember` 模型：成员类型（user/ai）+ 人格 ID + token 限制
  - 持久化：`data/groups/{groupId}.json`，原子写（.tmp → rename）
  - 消息存储上限：100 条，自动滚动
- **群管理功能**：
  - `createGroup()`：创建群聊，支持初始 AI 成员
  - `addAgent()` / `removeAgent()`：添加/移除 AI 成员
  - `setTokenLimit()`：设置默认或单个成员的 token 限制
  - `listGroups()` / `getGroup()` / `deleteGroup()`：群列表与详情
- **消息广播机制**：
  - `broadcastMessage()`：用户消息广播到所有 AI 成员
  - 并行调用各 AI 成员的人格模型生成回复
  - 支持降级策略（degradeDecision）
- **Token 限制策略**：
  - 提示词方式：在消息中注入「请将回复限制在 X token 内」
  - 后端截断：超过限制时自动截断并添加省略号
  - 默认限制：50 token，可自定义
- **命令接口**（/group 子命令）：
  - `/group create <群名> [成员1,成员2]`：创建群聊
  - `/group list`：列出所有群聊
  - `/group info <群ID>`：查看群详情
  - `/group delete <群ID>`：删除群聊
  - `/group add <群ID> <人格ID>`：添加 Agent
  - `/group remove <群ID> <成员ID>`：移除 Agent
  - `/group token <群ID> [成员ID] <token数>`：设置 token 限制
  - `/group send <群ID> <消息>`：发送消息到群聊
  - `/group agents`：查看可用人格列表

**核心文件**：
- `src/main/agent/group-chat/group-chat.ts` - 新增
- `src/main/router/router.ts` - 添加 `/group` 命令路由
- `src/main/ipc/handlers.ts` - 添加 `/group` 命令处理
- `src/main/index.ts` - 集成 initGroupChat()

**类型检查**：TS strict 模式 3/3 零错

---

### v2.5.0 - 2026-07-17

**里程碑：全模态闭环——让纳西妲能看见**

- **Vision 输入管理器**（[vision/vision-manager.ts](file:///e:/Nahida%20agent/src/main/vision/vision-manager.ts)）
  - `saveUploadedImage()`：接收 base64 → 存到 `data/media/` → 返回路径
  - `analyzeImages()`：调用 ollama vision 模型（如 qwen2-vl）理解图片
  - `processVisionRequest()`：完整流程（保存→分析→OCR→返回）
  - 支持 PNG / JPEG / WebP / GIF，单张最大 10MB
  - 图片宽高解析（PNG/JPEG 头部读取，纯 JS 无依赖）
  - OCR 预留口（PaddleOCR / Tesseract，当前返回空）

- **多模态输出编排器**（[vision/output-orchestrator.ts](file:///e:/Nahida%20agent/src/main/vision/output-orchestrator.ts)）
  - `extractActionTags()`：从文本抽取 `（xxx）` 动作 tag
  - `extractEmotion()`：抽取 `[emotion:xxx]` 标签
  - `cleanTextForTTS()`：清洗文本供 TTS 朗读
  - `emotionToLive2DExpression()`：情绪 → Live2D 表情映射
  - `buildMultimodalOutput()`：统一编排文本→动作→情绪→TTS→Live2D

- **Ollama Client 扩展**
  - `OllamaChatMessage` 新增 `images?: string[]` 字段（vision 模型用）
  - `ollamaChatStream` 透传 images 到 ollama HTTP 请求

- **Session 存储扩展**
  - `PersistedMessage` 新增 `images?: string[]` 字段
  - `appendMessage` 支持 images 参数

- **IPC 通道扩展**
  - 新增 `IMAGE_UPLOAD`（image:upload）：渲染层上传图片
  - 新增 `VISION_ANALYZE`（vision:analyze）：图像分析请求
  - 新增 `VISION_RESULT`（vision:result）：分析结果推送
  - `agentChatSchema` 新增 `images?: string[]` 字段

- **agent:chat 集成**
  - 当 payload.images 非空时走 vision 路径
  - vision 结果 → 文本推送 + Live2D 动作 + TTS 合成
  - 多模态消息持久化到 session（带图片路径）

- **配置扩展**
  - 新增 `VisionConfig` 接口（model / ocrEnabled / maxImages / maxImageSize）
  - `Config` 接口添加 `vision?: VisionConfig`

- **命令接口**
  - `/multimodal`：查看全模态闭环帮助

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.5.0 清单**：
- ✅ Vision 输入管理器（图片保存 + 模型分析 + OCR 预留）
- ✅ 多模态输出编排器（文本→动作→情绪→TTS→Live2D）
- ✅ Ollama Client images 字段扩展
- ✅ Session 存储多模态消息支持
- ✅ 3 个新 IPC 通道（image:upload / vision:analyze / vision:result）
- ✅ agent:chat vision 路径集成
- ✅ VisionConfig 类型扩展
- ✅ /multimodal 命令

- 已完成：Phase 1 全部核心功能 + 日历/闹钟调度 + 搜索可信度 + 图表仪表盘 + API 余额显示 + 邮箱 MCP + 图表扩展 + 安全埋桩 + **灵魂三维（遗忘/梦境/元认知）** + **纪念日感知 + RAG 三阶段检索** + **六顶帽多 Agent 协作** + **知识图谱落地 + 一键重置 + 指令层级增强** + **人格分叉 A/B 测试 + 插件系统雏形** + **语音输入 STT + 对话导出 + 全局快捷键** + **桌面整理 + 文件搜索 + 番茄钟专注模式** + **社区共享协议 + 生图工具** + **生视频工具** + **歌曲翻唱（RVC 实装）** + **Siri 式语音唤醒（Whisper.cpp STT）** + **群聊模块（多 Agent 群聊 + token 限制 + Agent 管理）**
- 状态：v2.5.0 已封板
- 下一步：v2.6+ 渲染层图片上传 UI + OCR 实装 + 视觉感知深度

---

### v2.6.0 - 2026-07-18

**里程碑：渲染层图片上传 UI——让"看"的能力触手可及**

v2.5.0 在主进程铺好了 vision 输入通路，但渲染层只有文本输入框，用户无法实际发图。v2.6.0 补齐这条"最后一公里"，让纳西妲能"看见"成为日常交互。

- **图片附件类型**（[renderer/main/types.ts](file:///e:/Nahida%20agent/src/renderer/main/types.ts)）
  - 新增 `ImageAttachment` 接口（id / dataUrl / base64 / mimeType / filename / source）
  - `Message` 接口新增 `images?: ImageAttachment[]` 字段
  - 新增 `generateImageId()` 工具函数

- **InputBar 多模态改造**（[renderer/main/InputBar.tsx](file:///e:/Nahida%20agent/src/renderer/main/InputBar.tsx)）
  - 📎 圆形按钮 + 隐藏 `<input type="file" multiple>` 文件选择
  - 拖拽：`onDragOver` / `onDragLeave` / `onDrop` 三事件 + 半透明绿色遮罩提示
  - 粘贴：`onPaste` 监听剪贴板 `image/*` 项，支持截图直接贴入
  - 待发送缩略图条：64×64 圆角缩略图 + 来源徽标（文件/剪贴板/拖拽）+ × 移除按钮
  - 前置校验：MIME 类型白名单（PNG/JPEG/WebP/GIF）+ 10MB 大小限制
  - 错误提示条：红色背景条显示具体原因
  - 发送：文本与图片可同时或单独发送，文本可为空（默认"请描述这张图片的内容"）

- **MessageBubble 图片渲染**（[renderer/main/MessageBubble.tsx](file:///e:/Nahida%20agent/src/renderer/main/MessageBubble.tsx)）
  - 用户消息支持渲染附带图片缩略图（120×120 圆角）
  - 悬停放大动画（scale 1.03 + 阴影）
  - 点击缩略图 → 全屏黑色遮罩 + 居中大图预览 + 文件名底栏 + × 关闭按钮
  - 点击遮罩空白处关闭预览

- **ChatPanel 多模态发送**（[renderer/main/ChatPanel.tsx](file:///e:/Nahida%20agent/src/renderer/main/ChatPanel.tsx)）
  - `handleSend(content, images?)` 新签名，向下兼容
  - images 非空时调用 `agent:chat` 携带 `images: base64[]` 字段
  - 主进程 agent:chat handler 在 `payload.images` 非空时自动走 vision 路径（v2.5.0 已铺好）
  - 用户消息持久化时包含图片缩略图（渲染层本地状态，不污染持久层）

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.6.0 清单**：
- ✅ ImageAttachment 类型定义
- ✅ InputBar 📎按钮 / 拖拽 / 粘贴 / 缩略图条
- ✅ MessageBubble 图片渲染 + 点击放大预览
- ✅ ChatPanel handleSend 多模态支持
- ✅ 复用 v2.5.0 后端 vision 路径（无后端改动）

**交互说明**：
1. 点击 📎 按钮选择图片 / 截图后 Ctrl+V 粘贴 / 直接把图片文件拖到输入栏
2. 缩略图条显示待发送图片，可单独移除
3. 输入框可空（默认提示词"请描述这张图片的内容"），也可附加说明
4. 发送后用户消息气泡显示图片缩略图，点击可放大
5. 纳西妲用 vision 模型分析后流式回复（与普通对话一致的 TTS + Live2D 联动）

- 状态：v2.6.0 已封板
- 下一步：v2.7+ OCR 实装（PaddleOCR / Tesseract.js）+ 视觉感知深度（多图关联、视频帧抽取、屏幕截图）

---

### v2.7.0 - 2026-07-18

**里程碑：OCR 实装——让纳西妲能"读"图中的字**

v2.5.0 留了 OCR 预留口，v2.6.0 让用户能上传图片，v2.7.0 把 OCR 真正实装，让纳西妲不仅能"看"图，还能"读"出图中的文字（截图、文档、表格、聊天记录等）。

- **Tesseract.js 集成**（[vision/vision-manager.ts](file:///e:/Nahida%20agent/src/main/vision/vision-manager.ts)）
  - 新增依赖：`tesseract.js`（纯 JS OCR 库，wasm + worker thread，无 Python 依赖）
  - `runOCR()` 从 stub 替换为真实实现：动态 import → createWorker → recognize → terminate
  - 支持语言代码：`chi_sim` 简中 / `chi_tra` 繁中 / `eng` 英文 / `jpn` 日文 / `kor` 韩文
  - 多语言用 `+` 连接，默认 `chi_sim+eng`（中英混合识别）
  - 首次调用自动下载语言包（缓存在 node_modules/tesseract.js/）
  - 30 秒超时保护（防 worker 卡死），100ms debounce（防 worker 抢占）
  - 显式 terminate（防 worker 线程泄漏）

- **VisionConfig 扩展**（[shared/types/config.ts](file:///e:/Nahida%20agent/src/shared/types/config.ts)）
  - 新增 `ocrLanguage?: string` 字段（Tesseract 语言代码）
  - `ocrEnginePath` 标注弃用（保留字段向后兼容）

- **OCR 流程集成**
  - 复用 v2.5.0 已铺好的流程：`processVisionRequest` 在 `ocrEnabled` 为 true 时自动并行 OCR 所有图片
  - OCR 结果通过 `VisionAnalysisResult.ocrText` 返回，渲染层可单独显示
  - vision 模型负责图像理解，Tesseract.js 负责精确文字识别，两者互补

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.7.0 清单**：
- ✅ tesseract.js 依赖安装
- ✅ runOCR 实装（createWorker / recognize / terminate）
- ✅ 30s 超时 + 100ms debounce 防护
- ✅ VisionConfig.ocrLanguage 字段
- ✅ 复用 v2.5.0 processVisionRequest 流程

**设计说明**：
- **为何选 Tesseract.js 而非 PaddleOCR**：纯 JS 无 Python 依赖，与项目 Electron + TS 栈一致；wasm + worker 不阻塞主进程；首次下载语言包后离线可用
- **OCR 与 vision 模型分工**：vision 模型（qwen2-vl）擅长"看懂"图像语义，OCR 擅长精确逐字识别。两者互补——OCR 提供准确文字，vision 模型提供上下文理解
- **未启用时零开销**：`ocrEnabled` 为 false 时直接返回空字符串，不加载 wasm；动态 import 确保未启用时无性能损失

- 状态：v2.7.0 已封板
- 下一步：v2.8+ 视觉感知深度（多图关联 / 视频帧抽取 / 屏幕截图）+ OCR 后处理（拼写校正 / 表格结构化）

---

### v2.7.1 - 2026-07-18

**优化：OCR 准确度提升——PNG 灰度化预处理**

用户反馈 Tesseract.js 直接识别彩色图片准确度不足。OCR 标准预处理流程中，灰度化能显著提升识别率，本次补齐这一步。

- **PNG 灰度化预处理**（[vision/vision-manager.ts](file:///e:/Nahida%20agent/src/main/vision/vision-manager.ts)）
  - 新增 `pngjs` 依赖（纯 JS PNG 编解码，无 native 依赖）
  - 新增 `grayscalePng(buf)` 函数：PNG.sync.read → RGBA 像素灰度化 → PNG.sync.write
  - 灰度化算法：ITU-R BT.601 加权平均 `Y = 0.299R + 0.587G + 0.114B`（人眼对绿色更敏感）
  - 仅改 RGB 三通道，alpha 通道保持不变
  - runOCR 在调用 Tesseract 前判断 `isPng(buf)`，PNG 自动走灰度化路径
  - JPEG/WebP/GIF 保持原样（让 Tesseract 内部处理）

- **错误容错**
  - 灰度化失败（PNG 损坏 / 解码异常）时返回原始 buffer，不阻塞 OCR
  - 动态 import pngjs，未启用 OCR 时零开销
  - console.warn 记录失败原因便于排查

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**为什么灰度化能提升 OCR 准确度**：
1. 消除色彩干扰，Tesseract 聚焦于文字边缘对比度
2. 减少颜色噪声（如背景色块、水印），提升内部二值化效果
3. 文档/截图场景下文字与背景的灰度差异更稳定
4. Tesseract 内部本来就会做灰度化，但前置处理能避免编解码损失

**为什么仅处理 PNG**：
- 截图（最常见 OCR 场景）默认是 PNG
- PNG 无损，灰度化后重新编码不会引入压缩伪影
- JPEG 是有损格式，反复编解码会降低质量；让 Tesseract 内部处理更稳妥
- WebP/GIF 使用场景较少，暂不处理

- 状态：v2.7.1 已封板
- 下一步：v2.8+ 视觉感知深度 + OCR 后处理（拼写校正 / 表格结构化）

---

### v2.8.0 - 2026-07-18

**里程碑：屏幕截图工具——让纳西妲主动"看"屏幕**

v2.5–v2.7 让纳西妲能"看"用户上传的图片，但本质仍是被动接受。v2.8.0 赋予纳西妲主动观察屏幕的能力——这是从"工具"到"陪伴 Agent"的本质飞跃。

- **截屏模块**（[vision/screenshot.ts](file:///e:/Nahida%20agent/src/main/vision/screenshot.ts)）
  - 基于 Electron `desktopCapturer` 内置 API，无额外依赖
  - `captureScreen(options)` — 截取指定显示器（默认主屏），返回 base64 + 路径
  - `captureAllDisplays()` — 截取所有显示器（多屏场景）
  - `captureAndAnalyze(prompt, onDelta)` — 截屏 + vision 分析一站式流程
  - `listDisplays()` — 列出所有可用显示器（id / label / bounds）
  - `formatDisplayList()` — 格式化显示器列表（命令输出用）

- **隐私与存储设计**
  - 截图存 `data/screenshots/`（与 `data/media/` 隔离，不污染用户上传）
  - 30 分钟自动清理过期截图（防磁盘堆积）
  - 截图操作记录到 console 日志（用户可审计）
  - 完全本地操作，不上传任何远程服务

- **`/screenshot` 命令**（[router/router.ts](file:///e:/Nahida%20agent/src/main/router/router.ts) + [ipc/handlers.ts](file:///e:/Nahida%20agent/src/main/ipc/handlers.ts)）
  - `/screenshot` — 截主屏 + 默认提问"请描述这张截图的内容"
  - `/screenshot list` — 列出所有可用显示器
  - `/screenshot <显示器ID>` — 截指定显示器
  - `/screenshot 看看这个报错` — 截主屏 + 自定义提问（纳西妲按用户意图分析）
  - 流式推送 vision 分析结果（与 v2.5.0 路径一致）
  - 自动联动 TTS + Live2D 动作

- **PNG 尺寸读取**
  - 纯 JS 读 PNG IHDR 头部（offset 16/20 读 UInt32BE），无 canvas/sharp 依赖
  - 用于记录截图实际尺寸

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.8.0 清单**：
- ✅ screenshot.ts 模块（captureScreen / captureAllDisplays / captureAndAnalyze）
- ✅ 30 分钟自动清理 + console 审计日志
- ✅ /screenshot 命令四种子模式
- ✅ 多显示器支持（list + 指定 ID）
- ✅ 流式 vision 分析 + TTS + Live2D 联动
- ✅ 截图持久化（与用户上传 media 隔离）

**设计亮点**：
1. **主动 vs 被动**：从"用户上传图片"到"纳西妲自己看屏幕"，是 Agent 自主性的关键一步
2. **复用现有管线**：截图后自动走 v2.5.0 processVisionRequest，无需重复实现 vision 流程
3. **隐私优先**：截图本地存储 + 30 分钟自动清理 + 不上传远程
4. **多屏支持**：listDisplays 列出所有显示器，可指定 ID 截取
5. **自然语言提问**：`/screenshot 看看这个报错` 让用户能用自然语言引导纳西妲的注意力

**使用场景**：
- "看看我屏幕上这个报错什么意思" → `/screenshot 看看这个报错什么意思`
- "翻译屏幕上这段文字" → `/screenshot 帮我翻译屏幕上的文字`
- "分析下这个表格的数据" → `/screenshot 分析下这个表格的数据`
- 多显示器：`/screenshot list` → `/screenshot 1234567890`

- 状态：v2.8.0 已封板
- 下一步：v2.9+ OCR 后处理（拼写校正 / 表格结构化）+ 区域截图 UI（渲染层选区）+ 视频帧抽取

---

### v2.9.0 - 2026-07-18

**里程碑：区域截图 UI——从"全屏"到"精准框选"**

v2.8.0 的 `/screenshot` 只能截全屏，对于大屏显示器来说太粗暴——用户往往只想分析屏幕上某个局部（一个报错框、一段文字、一个表格）。v2.9.0 引入区域截图 UI，类似 QQ 截图 / Snipaste 的体验。

- **区域截图覆盖窗口**（[vision/capture-overlay.ts](file:///e:/Nahida%20agent/src/main/vision/capture-overlay.ts)）
  - 全屏透明覆盖窗口（`frame:false, transparent:true, alwaysOnTop:true`）
  - `showRegionOverlay()` 返回 Promise，await 拿到选区坐标
  - `registerRegionOverlayHandlers()` 注册 `screenshot:region-result` / `screenshot:region-cancel` IPC 监听
  - 用户按 ESC 或点取消按钮 → resolve(null)

- **选区 UI**（[renderer/capture-overlay/index.html](file:///e:/Nahida%20agent/src/renderer/capture-overlay/index.html)）
  - 纯 JS + CSS，不引入 React（轻量，启动快）
  - 半透明黑色遮罩（`rgba(0,0,0,0.35)`）+ 绿色选区边框（`#66bb6a`，与项目主题一致）
  - 鼠标拖拽画矩形，实时显示物理像素尺寸标签（如 `1920 × 1080`）
  - 选区完成后右下角显示工具栏（确认 / 取消按钮）
  - ESC 键全局监听取消
  - 设备像素比（DPR）转换：CSS 像素 → 物理像素

- **PNG 裁剪**（[vision/screenshot.ts](file:///e:/Nahida%20agent/src/main/vision/screenshot.ts)）
  - `captureRegion(region, displayId?)` — 截全屏后用 pngjs 按选区裁剪
  - `PNG.bitblt` 像素级拷贝（高性能，无 canvas 依赖）
  - 越界保护：选区超出图像边界时自动截断
  - 裁剪后单独存 `data/screenshots/xxx_region.png`

- **IPC 通道扩展**（[shared/types/ipc.ts](file:///e:/Nahida%20agent/src/shared/types/ipc.ts)）
  - `SCREENSHOT_REGION_START` — main → overlay，启动选区（含 screenWidth/height/DPR）
  - `SCREENSHOT_REGION_RESULT` — overlay → main，回传选区坐标
  - `SCREENSHOT_REGION_CANCEL` — overlay → main，用户取消
  - preload 白名单同步更新

- **`/screenshot region` 命令**（[ipc/handlers.ts](file:///e:/Nahida%20agent/src/main/ipc/handlers.ts)）
  - 用户输入 → 显示覆盖窗口 → await 选区 → captureRegion 裁剪 → vision 分析 → TTS + Live2D 联动
  - 用户取消时返回温柔的提示消息

- **Vite 多入口扩展**（[vite.renderer.config.ts](file:///e:/Nahida%20agent/vite.renderer.config.ts)）
  - 新增 `capture-overlay` 入口
  - dev 模式：`http://localhost:5173/capture-overlay/index.html`
  - 生产模式：`dist/renderer/capture-overlay/index.html`

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.9.0 清单**：
- ✅ capture-overlay.ts 覆盖窗口管理器
- ✅ capture-overlay/index.html 选区 UI（纯 JS）
- ✅ screenshot.ts captureRegion() PNG 裁剪
- ✅ 3 个新 IPC 通道 + preload 白名单
- ✅ /screenshot region 命令
- ✅ vite 多入口配置
- ✅ 选区尺寸标签 + ESC 取消 + 工具栏确认/取消

**设计亮点**：
1. **纯 JS 不引 React**：覆盖窗口只做选区这一件事，纯 JS + CSS 启动更快，不占 React bundle
2. **DPR 坐标转换**：高 DPI 屏（如 2x Retina）下正确处理 CSS 像素 → 物理像素
3. **Promise 化 API**：`showRegionOverlay()` 返回 Promise，调用方 `await` 拿坐标，代码直观
4. **复用 pngjs**：裁剪复用 v2.7.1 的 pngjs，无新依赖
5. **主题一致**：选区边框用 `#66bb6a`（项目草绿色），尺寸标签同色

**使用方式**：
1. 输入 `/screenshot region`
2. 屏幕变暗，鼠标变十字光标
3. 拖动鼠标框选要分析的区域
4. 松开鼠标 → 选区下方出现"确认/取消"工具栏
5. 点确认 → 纳西妲分析选区内容并流式回复
6. 点取消或按 ESC → 取消截图

- 状态：v2.9.0 已封板
- 下一步：v2.10+ OCR 后处理（拼写校正 / 表格结构化）+ 视频帧抽取 + 多屏区域截图

---

### v2.10.0 - 2026-07-18

**里程碑：OCR 后处理——从"乱码"到"可读文本"**

Tesseract.js 对中文、低分辨率、复杂背景的识别准确率有限，原始输出常包含噪声字符、中英文混排空格错误、常见 OCR 混淆（0/O、1/l/I）、多余空行等。v2.10.0 引入 OCR 后处理管线，在不换模型的情况下显著提升可读性。

参考经验 1276728 的教训：
- ❌ 不做全局白名单收紧（会导致系统性退化）
- ❌ 不做过度修正（猜测比错误更可怕）
- ✅ 分场景处理（中文/英文/数字各有不同混淆模式）
- ✅ 上下文感知修正（只在"确定错"的上下文中修正）
- ✅ 保留原始文本 + 修正记录（可诊断、可回溯）

- **后处理模块**（[vision/ocr-postprocess.ts](file:///e:/Nahida%20agent/src/main/vision/ocr-postprocess.ts)）
  - 五阶段管线：基础清洗 → 常见 OCR 错误修正 → 中英文空格规范化 → 标点规范化 → 结构分析
  - 返回 `OcrProcessedResult`：`{ raw, cleaned, structure, corrections }` 四层结构
  - 每步修正都记录 `OcrCorrection`（类型 + 前后 + 位置），可诊断可回溯

- **阶段 1：基础清洗**
  - 去除首尾空白、行尾空白、零宽字符、不可见控制字符
  - 合并连续空行（3+ → 2，保留段落间隔）
  - 合并连续空格（2+ → 1）

- **阶段 2：常见 OCR 错误修正（上下文感知）**
  - 核心原则：只在"确定错"的上下文中修正，不做纯猜测
  - **数字多字母少**（数字占多数，字母≤2）：字母 → 数字修正
    - 映射表：O→0, l/I→1, S→5, B→8, Z→2, q→9, G→6 等
  - **字母多数字少**（字母占多数，数字≤2）：数字 → 字母修正
    - 映射表：0→O, 1→l, 5→S, 8→B, 2→Z, 9→q, 6→G
  - **纯数字/纯英文**：不修正（避免误伤）
  - 设计理念：宁漏勿错——不确定的就留着，让用户或 vision 模型判断

- **阶段 3：中英文混排空格规范化**
  - 中文与英文/数字之间自动加一个空格（符合中文排版规范）
  - 中文标点旁边不加空格
  - 已有空格的不重复加

- **阶段 4：标点规范化**
  - 中文上下文中的英文标点 → 中文标点（。，？！：；）
  - 判断依据：标点前后都是中文字符

- **阶段 5：结构分析**
  - `paragraphs`：段落列表（空行分隔）
  - `tables`：检测到的表格（| 分隔符或 +---+ 边框）
  - `codeBlocks`：检测到的代码块（缩进 4 空格连续 3 行以上）
  - `listItems`：检测到的列表项（- * 1. 开头）
  - `primaryLanguage`：语言检测（zh / en / mixed，按字符占比 70% 阈值）
  - `qualityScore`：文本质量评分（0-100）
    - 维度：可打印字符比例、空行比例、行长度均匀度、文本长度

- **vision-manager 集成**（[vision/vision-manager.ts](file:///e:/Nahida%20agent/src/main/vision/vision-manager.ts)）
  - `runOCR()` 输出从原始 text 改为后处理后的 cleaned text
  - console 日志增强：记录 raw/cleaned 字符数、质量评分、语言、修正数
  - 动态 import ocr-postprocess，未启用 OCR 时零开销

- **formatOcrResult()**：格式化输出函数，方便调试和命令行展示

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.10.0 清单**：
- ✅ 五阶段后处理管线
- ✅ 上下文感知 OCR 错误修正（数字↔字母混淆）
- ✅ 中英文混排空格规范化
- ✅ 中英文标点自动转换
- ✅ 结构分析（段落/表格/代码块/列表）
- ✅ 语言检测（zh/en/mixed）
- ✅ 文本质量评分（0-100）
- ✅ 修正记录可诊断（每步都有 from/to/position）
- ✅ vision-manager 集成（输出自动走后处理）

**设计亮点**：
1. **宁漏勿错**：只在"确定错"的上下文中修正，避免系统性退化（吸取经验 1276728 教训）
2. **四层结果**：raw/cleaned/structure/corrections，既方便使用又方便诊断
3. **无新依赖**：纯字符串处理，不引任何新包
4. **动态 import**：未启用 OCR 时零开销
5. **质量评分**：让上层可以根据质量决定是否需要二次处理或提示用户

**为什么不做拼写校正**：
- 中文没有"拼写"概念，只有 OCR 识别错误
- 英文拼写校正需要词典，体积大且不一定准确
- 当前阶段聚焦在"确定错"的修正，不做猜测性校正
- 未来可接入本地词典做轻量英文拼写校正

- 状态：v2.10.0 已封板
- 下一步：v2.11+ 视频帧抽取 + 多屏区域截图 + OCR 行级置信度

---

### v2.11.0 - 2026-07-18

**里程碑：多屏区域截图——从"单屏"到"全桌面覆盖"**

v2.9.0 的区域截图只支持主屏，多显示器用户体验不佳——副屏上的内容要截屏只能先拖到主屏。v2.11.0 改造覆盖窗口为多屏模式，用户在任意屏幕上都能框选。

- **覆盖窗口多屏化**（[vision/capture-overlay.ts](file:///e:/Nahida%20agent/src/main/vision/capture-overlay.ts)）
  - 从单窗口 `overlayWindow` 改为数组 `overlayWindows: BrowserWindow[]`
  - `showRegionOverlay()` 遍历 `screen.getAllDisplays()`，每屏创建一个独立的覆盖窗口
  - 每个窗口的 bounds 严格对齐对应显示器（x, y, width, height）
  - 窗口对象上挂 `_displayId` 属性，回调时可识别来源

- **安全机制**
  - `resolved` 标志位：防止多窗口同时 resolve（竞态条件）
  - 第一个完成选区 / 取消的窗口生效，后续的直接返回 `already-resolved`
  - 完成后 `closeAllOverlays()` 统一关闭所有窗口并清理状态
  - 所有窗口都关闭时自动 resolve(null)（兜底取消）

- **displayId 三重获取**（确保不丢失）
  1. payload 中的 displayId（渲染层传入）
  2. `BrowserWindow.fromWebContents(event.sender)` + `_displayId`（主进程侧识别）
  3. fallback 到主屏 id（极端情况兜底）

- **渲染层多屏提示**（[renderer/capture-overlay/index.html](file:///e:/Nahida%20agent/src/renderer/capture-overlay/index.html)）
  - 多屏场景下 hint 显示 "屏幕 X / Y"
  - 单屏时保持原样（不显示编号，界面更干净）
  - 每个窗口独立的选区状态，互不干扰

- **handlers 集成**（[ipc/handlers.ts](file:///e:/Nahida%20agent/src/main/ipc/handlers.ts)）
  - `/screenshot region` 先调用 `listDisplays()` 判断是否多屏
  - 多屏时提示语显示 "检测到 N 个显示器"
  - `captureRegion(region, region.displayId)` 按指定显示器截图 + 裁剪

- **RegionSelection 接口**
  ```typescript
  export interface RegionSelection {
    displayId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  ```

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.11.0 清单**：
- ✅ 多屏覆盖窗口（每屏一个独立 BrowserWindow）
- ✅ 竞态防护（resolved 标志位 + closeAllOverlays 统一清理）
- ✅ displayId 三重获取机制
- ✅ 渲染层多屏编号提示
- ✅ captureRegion 支持 displayId 参数
- ✅ handlers /screenshot region 多屏体验升级
- ✅ 单屏场景零退化（行为与 v2.9 完全一致）

**设计亮点**：
1. **每屏独立窗口**：而非一个超大窗口覆盖所有屏幕——避免跨屏 DPR 不一致、坐标转换复杂等问题
2. **竞态防护严谨**：resolved 标志位 + 第一个生效 + 统一关闭，防止多窗口同时回调
3. **向后兼容**：单屏用户行为完全不变，多屏用户自动获得增强体验
4. **displayId 三重保险**：渲染层传 → 主进程识别 → 主屏兜底，确保不丢失
5. **无新依赖**：纯 Electron API + 现有架构，零新增包

**为什么不用一个超大窗口覆盖所有屏幕**：
- 多屏 DPR 可能不同（如主屏 2x、副屏 1x），一个窗口只能有一个 DPR
- Electron 的 transparent 窗口在跨显示器边界时可能有渲染问题
- 坐标转换复杂（全局坐标 vs 窗口相对坐标）
- 每屏独立窗口更简单、更可靠、性能更好

- 状态：v2.11.0 已封板
- 下一步：v2.12+ 视频帧抽取 + OCR 行级置信度 + 屏幕实时监控模式

---

### v2.12.0 - 2026-07-18

**里程碑：视频分析能力（看动态内容）**

视觉感知闭环第三阶段——从"看静态图片"进化到"看动态视频"。通过抽帧策略把视频转换成多帧图像序列，交给 vision 模型理解视频内容。

**为什么 v2.12 做视频分析**：
1. 视觉感知三阶段：被动接收图片（v2.5-v2.7）→ 主动观察屏幕（v2.8-v2.11）→ 看动态内容（v2.12）
2. 有了多图 vision 分析的基础（v2.5 的 images 数组），视频抽帧后可以直接复用现有链路
3. 不内嵌 ffmpeg，检测系统已安装的 ffmpeg，零包体积膨胀
4. 动态 import 按需加载，不使用视频功能时零开销

**核心功能**：

1. **视频帧抽取模块** `src/main/vision/video-frame.ts`
   - 多路径检测系统 ffmpeg（PATH / 常见安装目录 / 环境变量）
   - 支持格式：mp4 / avi / mkv / mov / webm / flv / wmv / m4v
   - 按视频时长动态决定抽帧数：≤30秒3帧 / 30-300秒6帧 / >300秒10帧
   - 时间点均匀分布，自动跳过片头片尾（各5%）
   - 每帧带时间戳，便于模型理解时序
   - 帧图片自动清理（30分钟 TTL，复用 media 目录清理机制）

2. **vision-manager 视频分析入口**
   - `processVideoRequest()` 完整流程：抽帧 → 增强 prompt → vision 多图分析 → 可选 OCR
   - 增强 prompt 带帧时间戳，帮助模型理解视频时序
   - OCR 逐帧识别，结果带时间戳合并

3. **IPC 通道扩展**
   - `video:upload`：渲染层上传视频文件路径
   - `video:result`：主进程推送视频分析结果

4. **用户体验**
   - `/video` 命令帮助信息
   - 未安装 ffmpeg 时友好提示安装方法
   - 流式输出 + Live2D 动作 + TTS 完整联动

**v2.12.0 清单**：

| 模块 | 文件 | 状态 |
|------|------|------|
| 视频帧抽取 | `src/main/vision/video-frame.ts` | ✅ |
| vision 集成 | `src/main/vision/vision-manager.ts` | ✅ |
| IPC 通道 | `src/shared/types/ipc.ts` | ✅ |
| preload 白名单 | `src/preload/index.ts` | ✅ |
| 命令路由 | `src/main/router/router.ts` | ✅ |
| IPC handlers | `src/main/ipc/handlers.ts` | ✅ |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **零新增依赖**：检测系统 ffmpeg，不内嵌，不增加包体积
2. **动态 import**：视频模块按需加载，不使用时零开销
3. **智能抽帧**：按时长动态决定帧数，短视频不浪费、长视频信息充分
4. **时序感知**：帧带时间戳 + 增强 prompt，模型能理解视频发展顺序
5. **复用现有链路**：抽帧后直接走已有的多图 vision 分析，不重复造轮子

**为什么不用内嵌 ffmpeg**：
- ffmpeg 二进制体积巨大（~80MB），为了一个可选功能不值得
- 大多数开发者电脑已经装了 ffmpeg（通过 scoop/chocolatey/手动）
- 检测不到时友好提示安装，比内嵌臃肿的二进制更优雅

- 状态：v2.12.0 已封板
- 下一步：v2.13+ 视频抽帧质量优化 + OCR 行级置信度 + 屏幕实时监控模式

---

### v2.13.0 - 2026-07-18

**里程碑：视频智能抽帧（场景切换检测）**

v2.12 的视频抽帧是纯均匀分布——不管视频内容如何，等间隔取帧。这会导致：动作片场景切换频繁但只取到少数几个场景；静态对话视频浪费帧数在几乎相同的画面上。v2.13 引入 ffmpeg 场景检测，在画面发生显著变化的时间点抽帧，让每一帧都"有信息量"。

**为什么 v2.13 做场景检测抽帧**：
1. 均匀抽帧的最大问题：可能 6 帧里有 4 帧几乎一样（静态场景），浪费了 2/3 的分析预算
2. ffmpeg 自带 scene 滤镜（`select='gt(scene,0.3)'`），零额外依赖
3. 场景检测 + 均匀分布 fallback，保证最差情况也不会比 v2.12 差
4. 增强 prompt 附带策略信息，帮助 vision 模型理解帧之间的关系

**核心改动**：

1. **场景切换检测** `detectSceneCuts()`
   - ffmpeg 命令：`-vf "select='gt(scene,0.3)',showinfo" -an -f null -`
   - `-an` 忽略音频流加速，`-f null -` 只跑滤镜不输出
   - 解析 stderr 中 `showinfo` 的 `pts_time:` 提取场景切换时间戳
   - 去重处理（相邻帧 scene 值可能连续超阈值，0.5s 内的去重）
   - 15s 超时保护，超时自动 fallback 到均匀分布

2. **三策略智能抽帧**
   - `scene`：场景切换点 >= 目标帧数 → 均匀选取 N 个场景切换帧
   - `mixed`：场景切换点 > 0 但不够 → 场景切换帧 + 均匀分布补充（去近重 1s 内）
   - `uniform`：无场景切换点 → 纯均匀分布（与 v2.12 一致）

3. **辅助函数**
   - `selectEvenly()`：从候选时间戳中均匀选取 N 个
   - `generateUniformTimes()`：生成均匀分布时间戳（跳过片头片尾）

4. **全链路传递策略信息**
   - `VideoExtractResult.strategy` → `VideoAnalysisResult.strategy` → IPC `videoResultSchema.strategy`
   - 增强 prompt 附带策略提示（"场景切换帧"/"混合"/"均匀分布"）
   - handlers 传递 strategy 到渲染层
   - 日志记录策略和具体时间戳

**v2.13.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 场景检测 + 智能抽帧 | `src/main/vision/video-frame.ts` | 新增 `detectSceneCuts` / `selectEvenly` / `generateUniformTimes`，改造 `extractFrames` |
| vision 集成 | `src/main/vision/vision-manager.ts` | `VideoAnalysisResult.strategy` + 增强 prompt 策略提示 |
| IPC schema | `src/shared/types/ipc.ts` | `videoResultSchema.strategy` 字段 |
| IPC handlers | `src/main/ipc/handlers.ts` | 传递 strategy |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **优雅降级**：场景检测失败/超时/无结果 → 自动 fallback 到均匀分布，最差也不会比 v2.12 差
2. **去重保护**：场景切换点和均匀点距离 <1s 时去重，避免浪费帧数在相近画面
3. **超时保护**：15s 超时防止长视频场景检测卡死，用户体验有保障
4. **prompt 增强**：策略提示帮助 vision 模型理解帧之间的关系（"这些是场景切换帧"→模型知道每帧是独立场景）
5. **零新增依赖**：纯 ffmpeg 滤镜，不需要额外库

**为什么阈值 0.3**：
- ffmpeg scene 值范围 0-1，0 = 完全相同，1 = 完全不同
- 0.3 是 ffmpeg 社区常用阈值，能检出大多数显著场景切换
- 太低（如 0.1）会误检微小变化（如光照波动）
- 太高（如 0.5）会漏检渐变场景切换

- 状态：v2.13.0 已封板
- 下一步：v2.14+ OCR 行级置信度 + 屏幕实时监控模式

---

### v2.14.0 - 2026-07-18

**里程碑：OCR 行级置信度（让识别结果"知道自己准不准"）**

v2.7-v2.10 的 OCR 只返回纯文本，用户和模型都无法判断哪些行可信、哪些行需要二次核对。v2.14 提取 Tesseract.js 的行级置信度数据，通过全链路传到渲染层，支持未来 UI 高亮低置信度行，并把置信度纳入诊断日志。

**为什么 v2.14 做行级置信度**：
1. OCR 不是非黑即白——一行 95% 可信，另一行可能只有 40%（模糊/小字/倾斜）
2. 没有置信度时，用户只能全盘信任或全盘怀疑，都不合理
3. Tesseract.js 早就返回了 `result.data.lines[].confidence`，但 v2.7 只取了 `.text`，浪费了数据
4. 置信度还能驱动后处理策略：低置信度行可以触发更激进的修正或二次识别

**核心改动**：

1. **ocr-postprocess.ts 置信度类型与聚合**
   - 新增 `OcrLineConfidence`（行文本 + 置信度 + 等级 high/medium/low）
   - 新增 `OcrConfidenceSummary`（行列表 + 平均/最低/低置信度行数）
   - 阈值：`>=85` high，`>=60` medium，`<60` low（ffmpeg/Tesseract 社区经验值）
   - `postProcessOcr` 签名扩展：接受可选的 Tesseract 行数据
   - `summarizeConfidence` 聚合函数：无行数据时用结构质量评分兜底

2. **vision-manager.ts 增强 OCR 接口**
   - 新增 `OcrEnhancedResult` 类型（text + raw + confidence）
   - 新增 `runOCREnhanced()` 返回完整结果（含置信度）
   - `extractTesseractLines()` 兼容 `result.data.lines` 和 `result.data.words`（某些 Tesseract 版本不返回 lines，用 words 聚合近似）
   - 旧 `runOCR()` 保留为简版包装（字符串返回，向后兼容）
   - 日志增强：输出 `confidence=XX% (min=YY%, low=N/M)`

3. **vision / video 分析流程集成置信度**
   - `VisionAnalysisResult.ocrConfidence`：多图时取第一张有置信度的作为代表
   - `VideoAnalysisResult.ocrConfidence`：所有帧的置信度加权平均 + 累加低置信度行数
   - `processVisionRequest` / `processVideoRequest` 全部改用 `runOCREnhanced`

4. **IPC schema + handlers 全链路传递**
   - 新增 `ocrConfidenceSchema`（vision / video 共用）
   - `visionResultSchema.ocrConfidence` + `videoResultSchema.ocrConfidence`
   - handlers 两个推送点都传 `ocrConfidence`

**v2.14.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 置信度类型 + 聚合 | `src/main/vision/ocr-postprocess.ts` | `OcrLineConfidence` / `OcrConfidenceSummary` / `summarizeConfidence` / `postProcessOcr` 签名扩展 |
| 增强 OCR 接口 | `src/main/vision/vision-manager.ts` | `OcrEnhancedResult` / `runOCREnhanced` / `extractTesseractLines` / `runOCR` 简版包装 |
| 分析流程集成 | `src/main/vision/vision-manager.ts` | `VisionAnalysisResult.ocrConfidence` / `VideoAnalysisResult.ocrConfidence` |
| IPC schema | `src/shared/types/ipc.ts` | `ocrConfidenceSchema` + vision/video schema 扩展 |
| IPC handlers | `src/main/ipc/handlers.ts` | 两个推送点传 `ocrConfidence` |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **向后兼容**：`runOCR` 字符串返回保留，旧调用方零改动；`postProcessOcr` 的 Tesseract 行参数可选
2. **优雅降级**：Tesseract 不返回 lines 时用 words 聚合；words 也没有时用结构质量评分兜底
3. **多图策略**：vision 多图取第一张代表，video 多帧加权平均，各有道理
4. **低置信度行单独提取**：`lowConfidenceLines` 数组便于未来 UI 直接高亮
5. **零新增依赖**：纯 Tesseract.js 已有数据，只是之前没用

**为什么阈值 85/60**：
- Tesseract confidence 范围 0-100，但不是线性可信度
- 85+ 基本可以信任，60-85 需要留意，<60 大概率有问题
- 这是 OCR 社区经验值，比理论推导更实用

**未来扩展（v2.15+ 可选）**：
- 渲染层 UI 高亮低置信度行（黄/红色背景）
- 低置信度行触发二次识别（调高分辨率/换语言包）
- 置信度驱动后处理策略（低置信度行更激进修正）

- 状态：v2.14.0 已封板
- 下一步：v2.15+ 屏幕实时监控模式 + 渲染层置信度 UI

---

### v2.15.0 - 2026-07-18

**里程碑：渲染层 Vision/OCR 结果展示（让用户看到"我看到了什么"）**

v2.5-v2.14 在主进程构建了完整的视觉感知链路（图片分析、截图、视频、OCR、置信度），但渲染层只监听了 `agent:model-delta` 文本流——主进程推送的 `vision:result` 和 `video:result` 事件根本没有被消费。v2.14 把置信度传到渲染层了，但渲染层连基本的 OCR 文本展示都没接。v2.15 补齐这个缺口：让用户看到纳西妲"看到了什么"。

**为什么 v2.15 做渲染层展示**：
1. v2.14 把置信度传到渲染层，但渲染层没监听 → 数据浪费
2. 用户上传图片后，OCR 识别的文字不在 UI 上展示 → 用户不知道纳西妲"看清了"哪些字
3. 视频分析后，抽帧策略/帧数/时长等元信息不展示 → 用户不理解纳西妲怎么"看视频"的
4. 没有置信度高亮，用户无法判断 OCR 结果可信度

**核心改动**：

1. **Message 类型扩展** [types.ts](file:///e:/Nahida%20agent/src/renderer/main/types.ts)
   - `OcrConfidenceInfo`：平均/最低/低置信度行数/总行数
   - `Message.ocrText` / `ocrConfidence` / `videoMeta`（帧数/时长/策略）

2. **ChatPanel 事件监听** [ChatPanel.tsx](file:///e:/Nahida%20agent/src/renderer/main/ChatPanel.tsx#L125-L175)
   - 监听 `vision:result` → 附加 ocrText + ocrConfidence 到当前 streaming 消息
   - 监听 `video:result` → 附加 ocrText + ocrConfidence + videoMeta 到当前 streaming 消息
   - preload 白名单早已允许这两个通道（v2.12/v2.14 加的），无需改 preload

3. **MessageBubble OCR 展示块** [MessageBubble.tsx](file:///e:/Nahida%20agent/src/renderer/main/MessageBubble.tsx#L110-L183)
   - 视频元信息条：📹 视频 · 时长 · 帧数 · 抽帧策略（场景切换/混合/均匀）
   - OCR 文本块：📝 OCR 识别 + 置信度徽章（绿/橙/红 + 等级标签 + 低置信度行数）
   - `confidenceColor()`：≥85 绿、≥60 橙、<60 红
   - `confidenceLabel()`：可信/一般/需核对
   - 置信度徽章 hover 显示详细 tooltip（平均/最低/低置信度行数）

4. **设计风格**
   - 视频元信息：浅绿背景（#f1f8e9），呼应纳西妲草系主题
   - OCR 文本：浅米黄背景（#faf5e6），视觉上与主文本区分
   - 置信度徽章颜色与 border 同色系，低置信度时整个 OCR 块边框变红提示

**v2.15.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| Message 类型 | `src/renderer/main/types.ts` | `OcrConfidenceInfo` / `Message.ocrText` / `ocrConfidence` / `videoMeta` |
| 事件监听 | `src/renderer/main/ChatPanel.tsx` | 监听 `vision:result` / `video:result`，附加到 streaming 消息 |
| UI 展示 | `src/renderer/main/MessageBubble.tsx` | OCR 文本块 + 置信度徽章 + 视频元信息条 |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **零新依赖**：纯 React + 内联样式，不引入新 UI 库
2. **向后兼容**：OCR/视频字段都是可选，旧消息（纯文本）渲染不受影响
3. **置信度可视化**：颜色 + 文字 + tooltip 三层信息，一眼看出可信度
4. **流式友好**：OCR/视频结果在 streaming 消息上就地附加，不打断文本流
5. **主题一致**：草绿/米黄色系，与纳西妲整体 UI 风格统一

**用户体验提升**：
- 上传图片后，能看到纳西妲识别出的文字 + 置信度，知道哪些字可信
- 上传视频后，能看到视频时长/帧数/抽帧策略，理解纳西妲怎么"看"视频
- 低置信度行数明确标注，提示用户可能需要核对

- 状态：v2.15.0 已封板
- 下一步：v2.16+ 屏幕实时监控模式 + 低置信度行二次识别

---

### v2.16.0 - 2026-07-19

**里程碑：屏幕实时监控模式（让纳西妲主动"看"屏幕变化）**

v2.5-v2.15 让纳西妲能"看"用户上传的图片、截图、视频，但这些都是被动触发——用户必须主动操作。v2.16 引入屏幕实时监控模式，让纳西妲能主动观察屏幕，当画面发生显著变化时自动触发分析。

**为什么 v2.16 做屏幕监控**：
1. 视觉感知闭环的最后一块：被动接收（v2.5-v2.7）→ 主动截图（v2.8-v2.11）→ 看动态视频（v2.12-v2.15）→ **主动监控屏幕变化**（v2.16）
2. 场景需求：用户玩游戏时纳西妲可以主动提醒（"Boss 要放技能了！"）、用户工作时提醒休息、检测到报错时自动分析
3. 不做永久后台监控（用户主动开启），避免资源浪费和隐私问题
4. 帧差检测算法轻量（64x64 缩略图对比），CPU 占用极低

**核心改动**：

1. **屏幕监控模块** `src/main/vision/screen-monitor.ts`
   - **帧差检测算法**：前后两帧缩放为 64x64，计算 RGB 通道差值百分比（0-100）
   - **可配置参数**：截图间隔（默认 2000ms）、帧差阈值（默认 5%）、分析冷却（默认 5000ms）
   - **状态管理**：`MonitorState`（isActive / frameCount / changeCount / lastAnalyzeTime）
   - **帧差回调**：`setOnFrameDiff()` 当差异超过阈值时触发
   - **资源管理**：自动清理定时器、保留最近 10 张截图、停止时清空缓存
   - **公开 API**：`startMonitor()` / `stopMonitor()` / `getState()` / `isMonitoring()`

2. **vision-manager.ts 集成**
   - 新增 `startScreenMonitor()` / `stopScreenMonitor()` 入口
   - 帧差回调触发 `processVisionRequest()` 自动分析变化画面
   - 分析冷却机制：5 秒内不重复分析（避免刷屏）

3. **IPC 通道扩展**
   - `monitor:start`：渲染层请求开始监控（带配置参数）
   - `monitor:stop`：渲染层请求停止监控
   - `monitor:state`：主进程推送监控状态（isActive / frameCount / changeCount）
   - `monitor:frame-diff`：帧差变化事件（diffPercent / exceeded / imagePath）

4. **`/monitor` 命令**
   - `/monitor start [interval] [threshold]`：开始监控
   - `/monitor stop`：停止监控
   - `/monitor status`：查看监控状态
   - `/monitor analyze`：立即分析当前画面

5. **渲染层监控状态显示**
   - StatusBar 显示监控状态图标（🔵 运行中 / ⚪ 已停止）
   - 监控启动时显示提示消息（"纳西妲开始观察屏幕了~"）
   - 帧差变化时显示变化百分比和截图预览

**v2.16.0 清单**：

| 模块 | 文件 | 状态 |
|------|------|------|
| 屏幕监控模块 | `src/main/vision/screen-monitor.ts` | ✅ |
| vision 集成 | `src/main/vision/vision-manager.ts` | ✅ |
| IPC 通道 | `src/shared/types/ipc.ts` | ✅ |
| preload 白名单 | `src/preload/index.ts` | ✅ |
| 命令路由 | `src/main/router/router.ts` | ✅ |
| IPC handlers | `src/main/ipc/handlers.ts` | ✅ |
| 渲染层状态显示 | `src/renderer/main/StatusBar.tsx` | ✅ |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **轻量帧差算法**：64x64 缩略图对比，CPU 占用极低，不影响游戏/工作
2. **用户主动控制**：默认关闭，用户明确开启才监控，避免隐私担忧
3. **资源自动清理**：保留最近 10 张截图，停止时清空缓存，不占磁盘空间
4. **冷却机制**：5 秒分析冷却，避免画面频繁变化时刷屏
5. **优雅降级**：帧差计算失败时返回 0（视为无变化），不影响监控循环

**为什么帧差阈值设为 5%**：
- < 3%：鼠标移动、窗口闪烁等微小变化会误触发
- 5%：刚好能捕捉到页面切换、弹窗出现、视频场景切换等有意义的变化
- > 10%：可能错过一些中等程度的变化（如表单填写、文字更新）

**使用场景**：
- `/monitor start` → 纳西妲开始观察屏幕，检测到变化时自动分析
- `/monitor start 1000 3` → 1秒间隔，3%阈值（更敏感）
- `/monitor stop` → 停止监控
- `/monitor status` → 查看已捕获帧数和检测到的变化次数
- `/monitor analyze` → 立即分析当前屏幕画面

- 状态：v2.16.0 已封板
- 下一步：v2.17+ 低置信度行二次识别 + 监控规则配置（白名单窗口）

---

### v2.17.0 - 2026-07-19

**里程碑：OCR 低置信度行二次识别（让识别结果"越改越准"）**

v2.14 让 OCR 结果带上了行级置信度，v2.15 让用户看到了置信度。但低置信度行只能"标红"让用户自己核对——纳西妲没有尝试"再看一眼"。v2.17 引入二次识别：对低置信度行裁剪 + 放大 + PSM 单行模式重新识别，只在更可信时替换，让 OCR 结果自我进化。

**为什么 v2.17 做二次识别**：
1. v2.14 暴露了低置信度行，但没有"补救"机制——标红只是告知问题，不解决问题
2. 低置信度的常见原因：文字太小、模糊、行间干扰——裁剪放大能直接改善
3. PSM 7（单行模式）避免了多行场景的歧义，对单行识别更准
4. "宁漏勿错"原则：只在二次识别置信度更高时替换，不会越改越差

**核心改动**：

1. **二次识别模块** `src/main/vision/ocr-rerecognize.ts`
   - **裁剪 + 放大**：`cropAndUpscale()` 用 pngjs PNG.bitblt 裁剪 bbox 区域（带 5px 边距），2x 最近邻插值放大
   - **单行识别**：`recognizeSingleLine()` 用 PSM 7（SINGLE_LINE）模式识别裁剪后的区域
   - **主入口**：`rerecognizeLowConfidenceLines()` 逐行处理，返回 RerecognizeSummary（含逐行结果 + 改进前后文本）
   - **限制**：最多 5 行（避免长文档延迟），10 秒单行超时，最小裁剪区域 8px
   - **采纳策略**：二次识别置信度 > 原始置信度才标记 improved

2. **BoundingBox 类型** `src/main/vision/ocr-postprocess.ts`
   - 新增 `BoundingBox` 接口（x0/y0/x1/y1），导出供 rerecognize 模块使用
   - `OcrLineConfidence` 新增可选 `bbox` 字段
   - `postProcessOcr` 的 tesseractLines 参数扩展 bbox
   - `summarizeConfidence` 传递 bbox 到 OcrLineConfidence

3. **vision-manager 集成**
   - `extractTesseractLines` 提取 Tesseract 行的 bbox（result.data.lines[].bbox）
   - `OcrEnhancedResult` 新增 `rerecognize` 字段（rerecognizedCount / improvedCount）
   - `runOCREnhanced` 第一次识别后，检查低置信度行：
     - 筛选有 bbox 的低置信度行
     - 调用 `rerecognizeLowConfidenceLines` 二次识别
     - 用改进结果替换原文本（按行匹配 replace）
     - 二次识别失败非致命，不影响主流程

**v2.17.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 二次识别模块 | `src/main/vision/ocr-rerecognize.ts` | 新增（cropAndUpscale / recognizeSingleLine / rerecognizeLowConfidenceLines） |
| bbox 类型 | `src/main/vision/ocr-postprocess.ts` | BoundingBox / OcrLineConfidence.bbox / postProcessOcr 签名扩展 |
| 集成 | `src/main/vision/vision-manager.ts` | extractTesseractLines 提取 bbox / OcrEnhancedResult.rerecognize / runOCREnhanced 二次识别 |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **宁漏勿错**：只在二次识别置信度更高时替换，不会越改越差（与 v2.10 后处理原则一致）
2. **限制最多 5 行**：避免长文档场景下逐行二次识别导致延迟过高
3. **动态 import**：rerecognize 模块按需加载，无低置信度行时零开销
4. **非致命设计**：二次识别失败不影响主 OCR 流程，只 warn 不 throw
5. **PSM 7 单行模式**：避免多行场景歧义，对单行识别更精准

**为什么裁剪要加 5px 边距**：
- Tesseract 的 bbox 可能不完全覆盖文字边缘（特别是 ascender/descender）
- 没有边距的裁剪可能切掉字符上下部分，反而降低二次识别准确率
- 5px 是经验值，足够覆盖大部分字体的 ascender/descender

**为什么放大 2x 而不是 3x**：
- 2x 已经能让 Tesseract 看清细节，3x 边际收益递减
- 3x 会增加图像体积，拖慢 Tesseract 处理速度
- 对于极小文字（<8px），2x 后 16px 已经足够 Tesseract 识别

**为什么用 PSM 7 而不是 PSM 6**：
- PSM 6（SINGLE_BLOCK）：假设为统一文本块，多行时更准
- PSM 7（SINGLE_LINE）：假设为单行文本，裁剪后只有一行，PSM 7 更匹配
- PSM 13（RAW_LINE）：不假设字符顺序，对特殊排版可能有用，但常规场景 PSM 7 更稳

- 状态：v2.17.0 已封板
- 下一步：v2.18+ 监控规则配置（白名单窗口）+ OCR 多语言自动切换

---

### v2.18.0 - 2026-07-19

**里程碑：监控规则配置 + OCR 多语言自动切换**

v2.16 实现了屏幕实时监控，但所有窗口都会被监控——用户可能只想监控游戏窗口，不想监控聊天窗口。v2.18 引入窗口过滤器（白名单/黑名单），让监控更精准。同时，OCR 之前只能用配置文件指定单一语言，现在支持多语言自动检测，从文件名或用户提示推断语言。

**为什么 v2.18 做这两个功能**：
1. **窗口过滤**：v2.16 监控所有窗口，可能在用户看视频、聊天时误触发分析，干扰用户体验。白名单/黑名单让用户精确控制监控范围。
2. **OCR 多语言**：之前硬编码 `chi_sim+eng`，遇到纯英文、日文、韩文文档识别准确率下降。自动检测语言能显著提升多语言场景的识别效果。

**核心改动**：

1. **窗口过滤** `src/main/vision/screen-monitor.ts`
   - **WindowFilter 接口**：`mode: 'whitelist' | 'blacklist'` + `rules: Array<string | RegExp>`
   - **MonitorConfig** 新增 `windowFilter` 字段
   - **getActiveWindowTitle**：PowerShell 调用 User32.dll 获取当前活动窗口标题（Windows）
   - **checkWindowFilter**：检查当前窗口是否符合规则（白名单只匹配规则内窗口，黑名单排除规则内窗口）
   - **缓存机制**：窗口标题缓存 5 秒，避免频繁调用 PowerShell
   - **monitorTick**：截图前先检查窗口过滤器，不符合规则则跳过

2. **OCR 多语言检测** `src/main/vision/ocr-language-detect.ts`（新增）
   - **Unicode 范围检测**：基于字符的 Unicode 范围统计各语言字符比例
   - **支持语言**：中文简体（chi_sim）、中文繁体（chi_tra）、英文（eng）、日文（jpn）、韩文（kor）
   - **简体/繁体区分**：通过特征字符判断（如"为/為"、"爱/愛"）
   - **混合语言**：检测到中文/日文/韩文时，自动添加英文（混排场景）
   - **预检测**：`hintToLanguage()` 从文件名/用户提示推断语言（如文件名含 zh/jp/ko）
   - **零依赖**：纯 TypeScript 实现，不引入外部语言检测库

3. **vision-manager 集成**
   - `runOCREnhanced` 新增 `languageHint?: string` 参数
   - 如果配置中未指定语言且有 hint，调用 `hintToLanguage()` 推断
   - `OcrEnhancedResult` 新增 `language` 字段（code + autoDetected）
   - 返回时标记是否为自动检测

**v2.18.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 窗口过滤 | `src/main/vision/screen-monitor.ts` | WindowFilter / getActiveWindowTitle / checkWindowFilter / monitorTick 集成 |
| OCR 多语言 | `src/main/vision/ocr-language-detect.ts` | 新增（detectLanguage / getTesseractLanguage / hintToLanguage） |
| vision 集成 | `src/main/vision/vision-manager.ts` | runOCREnhanced languageHint / OcrEnhancedResult.language |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **窗口过滤缓存**：5 秒缓存窗口标题，避免每帧都调用 PowerShell（减少 CPU 开销）
2. **Unicode 范围检测**：零依赖，简单可靠，对 OCR 场景足够准确
3. **混合语言支持**：检测到中文时自动添加英文，符合中文文档常见的中英混排场景
4. **简体/繁体自动区分**：通过特征字符判断，不需要额外训练数据
5. **配置优先**：配置文件指定语言时使用配置值，未指定时自动检测

**窗口过滤使用场景**：
- 白名单模式：只监控游戏窗口（`{ mode: 'whitelist', rules: ['Genshin Impact', /Star Rail/] }`）
- 黑名单模式：排除聊天窗口（`{ mode: 'blacklist', rules: ['Discord', 'QQ'] }`）

**语言检测使用场景**：
- 用户上传文件名含 `jp` 的图片 → 自动用 `jpn` 语言
- 用户输入提示含"日文" → 自动用 `jpn` 语言
- 未指定时 fallback 到配置的默认语言

- 状态：v2.18.0 已封板
- 下一步：v2.19+ OCR 低置信度行二次识别优化 + 监控规则持久化

---

### v2.19.0 - 2026-07-19

**里程碑：监控规则持久化 + OCR 二次识别并行优化**

v2.18 让监控支持窗口过滤，但规则只在内存中——重启后丢失。v2.19 将监控规则持久化到 config.json，跨重启保留。同时优化 OCR 二次识别：从串行改为并行，提升处理速度。

**为什么 v2.19 做这两个功能**：
1. **监控规则持久化**：v2.18 的窗口过滤规则每次重启都要重新设置，用户体验差。持久化到 config.json 后，用户配置一次即可长期使用。
2. **OCR 二次识别并行**：v2.17 的二次识别是串行 for 循环，5 行低置信度文本要等 5 轮裁剪+识别。并行处理后，裁剪/放大阶段同时进行，显著降低等待时间。

**核心改动**：

1. **监控规则持久化** `src/shared/types/config.ts`
   - 新增 `MonitorPersistConfig` 接口：
     - `intervalMs` / `threshold` / `cooldownMs`：默认监控参数
     - `windowFilter`：持久化的窗口过滤规则（mode + rules 字符串数组）
     - `autoStart`：是否在应用启动时自动开始监控
   - `VisionConfig` 新增 `monitor?: MonitorPersistConfig` 字段
   - 持久化时只支持字符串规则（RegExp 无法序列化到 JSON）

2. **startScreenMonitor 配置读取** `src/main/vision/vision-manager.ts`
   - 未传入 config 时，自动从 `getConfig().vision?.monitor` 读取持久化配置
   - 将持久化的 windowFilter（字符串数组）转换为 MonitorConfig 的 windowFilter
   - 移除了 v2.16 中的 `ScreenMonitor.startMonitor(ScreenMonitor.getState().config, undefined)` 递归调用（会导致重复启动监控，是个 bug）

3. **OCR 二次识别并行优化** `src/main/vision/ocr-rerecognize.ts`
   - 抽取 `processSingleLine()` 为独立函数（单行完整处理：裁剪+放大+识别）
   - 主入口从串行 for 循环改为 `Promise.all` 并行处理
   - 保留原始顺序：Promise.all 结果按索引重组，不破坏文本顺序
   - 改进采纳策略：要求二次识别文本非空，避免空文本覆盖原始结果
   - 移除了冗余的 `improvedCount` 累加，改用 `results.filter(r => r.improved).length`

**v2.19.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 配置类型 | `src/shared/types/config.ts` | MonitorPersistConfig / VisionConfig.monitor |
| 配置读取 | `src/main/vision/vision-manager.ts` | startScreenMonitor 从 config.json 读取默认配置 + 修复递归调用 bug |
| 并行优化 | `src/main/vision/ocr-rerecognize.ts` | processSingleLine 抽取 / Promise.all 并行 / 采纳策略改进 |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **配置优先级**：显式传入 config > config.json 持久化配置 > 默认值
2. **并行保留顺序**：Promise.all 结果按原始索引重组，不破坏文本顺序
3. **非空检查**：二次识别文本为空时不采纳，避免空文本覆盖原始结果
4. **持久化限制**：RegExp 无法序列化，持久化只支持字符串规则（运行时仍支持 RegExp）

**修复的 bug**：
- v2.16 的 `startScreenMonitor` 回调中有一行 `ScreenMonitor.startMonitor(ScreenMonitor.getState().config, undefined)`，这会递归启动监控，导致多个监控循环同时运行。v2.19 移除了这行。

**持久化配置示例**（config.json）：
```json
{
  "vision": {
    "monitor": {
      "intervalMs": 2000,
      "threshold": 5,
      "cooldownMs": 5000,
      "windowFilter": {
        "mode": "whitelist",
        "rules": ["Genshin Impact", "Star Rail"]
      },
      "autoStart": false
    }
  }
}
```

- 状态：v2.19.0 已封板
- 下一步：v2.20+ 视觉感知综合优化（缓存/性能/UI 反馈）

---

### v2.20.0 - 2026-07-20

**里程碑：视觉感知综合优化（LRU 缓存 + 结果透传 + UI 反馈增强）**

v2.5-v2.19 逐步构建了完整的视觉感知闭环，但每次图片分析都是"无记忆"的——相同图片重复发送给模型、OCR 结果中的二次识别和语言信息未透传到渲染层、UI 上看不到这些元信息。v2.20 补齐这些"最后一公里"。

**为什么 v2.20 做综合优化**：
1. **LRU 缓存**：屏幕监控帧差较小时前后帧几乎相同，重复调用模型浪费时间和钱。缓存让相同图片+相同 prompt 直接返回上次结果。
2. **结果透传**：v2.17 的二次识别和 v2.18 的语言检测信息在 `OcrEnhancedResult` 中有，但 `VisionAnalysisResult` 没有——渲染层拿不到。
3. **UI 反馈**：用户看不到 OCR 用的什么语言、有没有二次识别改进、是否命中缓存——信息不透明。

**核心改动**：

1. **Vision LRU 缓存** `src/main/vision/vision-cache.ts`（新增）
   - **LRUCache**：Map 实现，删除+重新插入模拟 LRU 顺序
   - **缓存 key**：`MD5(base64) + ":" + MD5(prompt)`，相同图片+不同 prompt 生成不同 key
   - **TTL 5 分钟**：屏幕内容会变化，过期缓存自动失效
   - **默认容量 50 条**：约 50 次分析结果，内存开销可控
   - **公开 API**：`initVisionCache()` / `computeCacheKey()` / `getVisionCache()` / `setVisionCache()` / `clearVisionCache()` / `getVisionCacheStats()`
   - **零依赖**：`crypto.createHash('md5')` 是 Node.js 内置

2. **processVisionRequest 缓存集成**
   - 单图时：先检查缓存，命中则跳过模型调用，直接返回（`fromCache: true`）
   - 分析完成后：写入缓存（单图时）
   - 多图时不缓存（组合 key 太复杂，收益低）

3. **VisionAnalysisResult 扩展**
   - `ocrRerecognize`：二次识别信息（rerecognizedCount / improvedCount）
   - `ocrLanguage`：语言检测信息（code / autoDetected）
   - `fromCache`：是否来自缓存命中

4. **渲染层 UI 反馈增强**
   - `Message` 类型新增 `ocrRerecognize` / `ocrLanguage` / `fromCache` 字段
   - `MessageBubble` OCR 区域新增标签：
     - **语言标签**：`chi_sim+eng ⚡`（⚡ 表示自动检测）
     - **缓存标签**：`缓存`（蓝色）
     - **二次识别标签**：`✓ 改进 2 行`（绿色）

**v2.20.0 清单**：

| 模块 | 文件 | 改动 |
|------|------|------|
| LRU 缓存 | `src/main/vision/vision-cache.ts` | 新增（LRUCache / init / get / set / clear / stats） |
| 缓存集成 | `src/main/vision/vision-manager.ts` | processVisionRequest 缓存检查/写入 + VisionAnalysisResult 扩展 |
| 类型 | `src/renderer/main/types.ts` | Message 新增 ocrRerecognize / ocrLanguage / fromCache |
| UI | `src/renderer/main/MessageBubble.tsx` | 语言/缓存/二次识别标签 |
| typecheck 3/3 | - | ✅ |

**设计亮点**：
1. **只缓存单图**：多图组合 key 复杂，缓存收益低（多图场景少见）
2. **MD5 做 key**：固定 32 字符，Map 查找 O(1)，比比较 base64 快几个数量级
3. **TTL 5 分钟**：屏幕监控场景合理——内容变化后 5 分钟内不会重复分析相同画面
4. **UI 信息透明**：用户能看到语言、缓存、改进等元信息，对 OCR 结果更有信心

**缓存统计使用**：
- `getVisionCacheStats()` 返回 `{ size, hits, misses, hitRate }`
- 可在 `/stats` 命令中展示缓存命中率
- `/clear` 命令调用 `clearVisionCache()` 清空

- 状态：v2.20.0 已封板
- 下一步：v3.0.0 视觉感知 Phase 1 闭环（VERSION_SNAPSHOT）

---

### v3.0.0 - 2026-07-20

**里程碑：视觉感知 Phase 1 闭环**

从 v2.5 到 v2.20，历时 16 个小版本，视觉感知 Phase 1 完整闭环。纳西妲从"只能看用户上传的图片"进化到"主动观察屏幕变化、识别多语言文字、分析视频内容"。

**Phase 1 四层能力**：

| 层级 | 能力 | 版本 |
|------|------|------|
| 主动观察 | 屏幕实时监控 + 帧差检测 + 窗口过滤 + 规则持久化 | v2.16 - v2.19 |
| 看动态内容 | 视频帧抽取 + 智能抽帧 + 多图 vision 分析 | v2.12 - v2.15 |
| 主动截图 | 全屏 / 区域 / 多屏截图 + 选区 UI | v2.8 - v2.11 |
| 被动接收 | 图片上传 + vision 分析 + 缩略图预览 | v2.5 - v2.6 |

**OCR 增强链**：
- 灰度化预处理（v2.7.1）→ 后处理五阶段（v2.10）→ 行级置信度（v2.14）→ 低置信度二次识别（v2.17）→ 多语言自动切换（v2.18）→ 并行优化（v2.19）

**核心模块 8 个文件**：
- `src/main/vision/vision-manager.ts`：视觉主管理器
- `src/main/vision/ocr-postprocess.ts`：OCR 后处理
- `src/main/vision/ocr-rerecognize.ts`：低置信度行二次识别
- `src/main/vision/ocr-language-detect.ts`：多语言自动检测
- `src/main/vision/vision-cache.ts`：LRU 缓存
- `src/main/vision/screen-monitor.ts`：屏幕实时监控
- `src/main/vision/capture-overlay.ts`：区域截图覆盖窗口
- `src/main/vision/video-frame.ts`：视频帧抽取

**设计原则**：
1. **宁漏勿错**：OCR 后处理、二次识别、语言检测均遵循
2. **无额外依赖**：截图用 Electron API、视频用系统 ffmpeg、OCR 用已有的 Tesseract.js、缓存用内置 crypto
3. **渐进增强**：从被动到主动、从静态到动态、从单语言到多语言
4. **资源自动清理**：截图/视频帧 TTL 过期清理
5. **类型安全**：TS strict 模式，3/3 零错

**Phase 2 规划**：
- v3.1：监控规则可视化配置（设置界面）
- v3.2：低置信度行用户可手动修正（反馈闭环）
- v3.3：屏幕区域监控（只监控指定区域）
- v3.4：OCR 表格识别（结构化输出）
- v3.5：视觉记忆（重要画面自动存入记忆分片）

**v3.0.0 版本快照**：详见 [VERSION_SNAPSHOT.md](./VERSION_SNAPSHOT.md)

- 状态：v3.0.0 已封板 🎉
- 下一步：v3.1+ 视觉感知 Phase 2 — 精细化增强

---

## 技术栈版本

### 核心依赖

| 组件 | 版本 | 说明 |
|------|------|------|
| Electron | 32.0.0 | 主进程框架 |
| TypeScript | 5.6.0 | strict 模式 |
| Vite | 6.2.0 | 多入口构建 |
| React | 18.3.0 | 渲染层 UI |
| PixiJS | 7.4.3 | 2D 渲染引擎 |
| pixi-live2d-display | 0.4.0 | Live2D 模型加载 |
| Zod | 3.23.0 | Schema 校验 |
| edge-tts | 7.2.8 | TTS 合成（Python） |
| tesseract.js | ^7.0.0 | OCR 文字识别（v2.7） |
| pngjs | ^7.0.0 | PNG 灰度化预处理（v2.7.1） |

### 本地模型

| 模型 | 用途 | 状态 |
|------|------|------|
| `qwen3-8b-nahida` | 日常对话（local tier） | v3 训练中 |
| `qwen2.5-1.5b-nahida` | 四审层审查 | 已完成 v3 训练 |
| `nahida_v0.3_100e.pth` | RVC 语音转换 | 已集成 |

---

## 下一步规划

### v0.9.x（当前阶段）

#### v0.9.0 - 0.9.5：本地化集成 + UI 修复
- node-llama-cpp 替代 Ollama HTTP API
- Python 嵌入式环境管理（GPT-SoVITS / RVC）
- Live2D 模型显示修复（fit-to-height 缩放 / 眼神跟随）
- 主窗口焦点修复（moveTop + ready-to-show）
- Cherry Studio 风格两栏布局（Sidebar + ChatPanel）
- 输出泄漏修复（stream-sanitizer 清洗 <think> / [emotion] / <tool_call>）

#### v0.9.6：Heartjump 心动机制 + Rand_error >50 自动抛出
- **Heartjump.md**：4 维度反常检测（情绪/动作/长度/频率），intensity >= 0.6 触发特殊动作"藤蔓绕腕"
- **Rand_error 独立计数器**：同类型累计 >50 自动生成报告，写入 `memory/rand_error.md`
- **Live2D isInteractive 兼容**：mock 修复 PixiJS 7.x 兼容报错

#### v0.9.7 ✅ 2026-07-15：L5 基础设施埋桩

**L5 抗逆性三件套上线——桌面端的"安全网"**

- **崩溃自愈（Crash Survival）**
  - `session-store.ts` 新增 `emergencyFlush()`：同步写盘所有内存 session 到 `.emergency` 备份
  - `recoverFromEmergency()`：启动时扫描 `.emergency` 文件，比主文件新则自动恢复
  - 主进程监听 `render-process-gone` 事件，触发紧急写盘 + 尝试重建 Live2D 窗口
  - 对应文件：`src/main/memory/session-store.ts` / `src/main/index.ts`

- **离线降级链（Degraded Mode）**
  - 新建 `src/main/health/health.ts`：`HealthMonitor` 统一管理子系统健康状态
  - 探针工厂：`createHttpProbe()`（ollama/GPT-SoVITS 等 HTTP 服务）/ `createNetworkProbe()`（互联网连通性）
  - 三级状态：`healthy` / `degraded` / `unhealthy`，状态变化触发事件推送 UI
  - 主进程注册 ollama + 网络 + GPT-SoVITS 探针，默认 30s 轮询
  - 现有 `degrade-strategy.ts` 保留为模型路由层降级策略，health.ts 为全局健康底座
  - 对应文件：`src/main/health/health.ts` / `src/main/index.ts`

- **隐私沙箱（Privacy Sandbox）**
  - 新建 `src/main/memory/crypto.ts`：AES-256-GCM 加解密 + PBKDF2 密钥派生
  - 双模式密钥：`keytar` 模式（系统钥匙环，零操作）/ PIN 模式（用户输入 PIN 派生）
  - keytar 懒加载，没装也能跑（兜底 PIN 模式）
  - `shards.ts` 集成：读取自动解密（兼容明文旧文件），`writeShard()` 自动加密写回
  - 输出格式：`enc:` 前缀 + Base64(iv + authTag + ciphertext)，单文件自包含
  - 原子写：先写 `.tmp` 再 rename，防写坏
  - 对应文件：`src/main/memory/crypto.ts` / `src/main/memory/shards.ts`

**依赖变更**：
- 新增 `keytar@^7.9.0`（系统钥匙环集成，可选依赖，没装不影响主功能）

**类型检查**：TS strict 模式 0 错误

#### v0.9.8 ✅ 2026-07-15：L4 产品外壳起步

**设置 + 反馈双界面上线——用户可配置化的第一步**

- **设置界面（SettingsModal.tsx）**
  - 三 Tab 设计：模型（Ollama 配置 + 本地模型路径）/ 感知（TTS 适配器 + RVC/GPT-SoVITS）/ 人格（占位，v1.1 完善）
  - 配置持久化：`config.json` 写入项目根目录，原子写防坏
  - 须弥风格 UI：草绿色主题 + 圆角卡片
  - 触发方式：Sidebar 底部 🔧 设置按钮
  - 对应文件：`src/renderer/main/SettingsModal.tsx` / `src/main/config/config.ts`

- **配置 IPC 通道**
  - 新增 `config:get` / `config:set` 通道，渲染层可读写配置
  - 配置类型移至 `src/shared/types/config.ts`（渲染层可访问）
  - 对应文件：`src/shared/types/ipc.ts` / `src/main/ipc/handlers.ts`

- **反馈界面（FeedbackModal.tsx）**
  - 三类型：Bug 报告 / 功能建议 / 其他
  - 写入位置：项目根目录 `feedback/YYYYMMDD_HHMMSS_{type}.md`
  - 触发方式：全局快捷键 `Ctrl+Shift+F`（主进程监听，IPC 推送到渲染层）
  - 对应文件：`src/renderer/main/FeedbackModal.tsx` / `src/main/tray/shortcuts.ts`

- **快捷键扩展**
  - 新增 `Ctrl+Shift+F` 全局快捷键打开反馈窗口
  - 原有 `Ctrl+Space` 显示/隐藏主窗口保持不变

**类型检查**：TS strict 模式 0 错误（主进程 + 渲染层 + preload）

#### v0.9.9 ✅ 2026-07-15：L3 时间感与数字衰老

**让她活着的最便宜的一行代码**——maturity 参数注入 system prompt，人格随时间微调。

- **maturity.ts**：时间感与数字衰老模块
  - maturity ∈ [0, 1]，30 天达到完全成熟
  - 遗忘衰减：每天衰减 2%（长时间不交互缓慢下降）
  - 持久化：`memory/maturity.json`，启动时加载，每次对话后更新
  - 人格微调规则：
    - maturity < 0.2：活泼好奇，多用"～""！"
    - 0.2 < maturity < 0.6：温柔知性，语气适中
    - maturity > 0.6：成熟稳重，智慧感，用词精炼
  - 对应文件：`src/main/agent/maturity.ts`

- **agent-core.ts 集成**
  - `getSystemPrompt()` 注入成熟度参数：`[maturity:0.35] 你是一个成长中的纳西妲……`
  - `generateResponse()` 结束时调用 `recordConversation(latencyMs)` 记录对话时长
  - 对应文件：`src/main/agent/agent-core.ts`

- **主进程初始化**：`initMaturity()` 在启动时加载历史数据

**核心公式**（真的只有一行）：
```typescript
const maturity = Math.min(1, (totalMs / MS_PER_DAY) / 30) * decayFactor;
```

**效果**：用户每天和她对话，30 天后能感受到她从"刚出生的小草"成长为"成熟的大慈树王"。

**类型检查**：TS strict 模式 0 错误

#### v1.0.0 ✅ 2026-07-15：正式发布里程碑

**Token 统计 + /stats 面板——产品化最后一环**

- **token-usage.ts**：统一统计模块
  - 近似估算：promptTokens ≈ 输入字符/4，completionTokens ≈ 输出字符/4
  - 按日期聚合：每天一个统计单元，保留最近 30 天
  - 持久化：`memory/token-usage.json`
  - 模型区分：统计每个模型的调用量和占比
  - 对应文件：`src/main/agent/token-usage.ts`

- **agent-core.ts 集成**
  - 每次对话结束调用 `recordTokenUsageWithLatency()`
  - 记录：promptTokens / completionTokens / latencyMs / tier / modelId
  - 对应文件：`src/main/agent/agent-core.ts`

- **/stats 面板**
  - IPC 通道：`stats:get` / `stats:get-chart`
  - 渲染层调用，显示真实统计数据（累计 token / 总对话 / 7天趋势 / 模型分布）
  - 对应文件：`src/renderer/main/ChatPanel.tsx`

**v1.0.0 封板功能清单**：
- ✅ 日常对话 + 意图检测 + 三重路由
- ✅ 四审机制（A-OOC / B-括号 / C-emotion / D-tool）
- ✅ 记忆系统（9 分片 + worldbook）
- ✅ Live2D 表现 + TTS（GPT-SoVITS）
- ✅ 崩溃自愈 + 离线降级链 + 隐私沙箱
- ✅ 设置界面 + 反馈界面
- ✅ 时间感与数字衰老（maturity 参数）
- ✅ Token 统计 + /stats 面板

**类型检查**：TS strict 模式 0 错误

#### v1.1.0 ✅ 2026-07-16：L2 生活肢体起步

**日历 + 闹钟调度上线——生活助理的第一步**

- **日历工具（calendar.ts）**
  - 3 个工具：calendar_create / calendar_query / calendar_list
  - 存储：`data/calendar/events.json`
  - 对应文件：`src/main/tools/calendar.ts`

- **闹钟工具（alarm.ts）**
  - 3 个工具：alarm_set / alarm_list / alarm_cancel
  - 存储：`data/alarm/alarms.json`
  - 对应文件：`src/main/tools/alarm.ts`

- **闹钟调度器（alarm-scheduler.ts）**
  - 10 秒轮询检查闹钟列表
  - 到时触发 → IPC 推送到渲染层（agent:state-change）
  - 支持重复模式：daily / weekdays / weekends
  - 对应文件：`src/main/tools/alarm-scheduler.ts`

- **主进程集成**
  - 注册 calendar/alarm 工具到 Tool Registry
  - 启动闹钟调度器（主进程启动时）
  - 对应文件：`src/main/index.ts`

- **MCP Client 框架**
  - 补全 `mcp-client.ts`（原文件被截断）
  - stdio 模式连接外部 MCP Server
  - 工具自动注册到 Tool Registry
  - 对应文件：`src/main/mcp/mcp-client.ts`

**类型检查**：TS strict 模式 0 错误

**v1.1.0 封板功能清单**：
- ✅ 日历提醒（calendar_create/query/list）
- ✅ 闹钟调度（alarm_set/list/cancel + 10秒轮询）
- ✅ 重复模式支持（daily / weekdays / weekends）
- ✅ MCP Client 框架（connect/execute/disconnect）

#### v1.2.0 ✅ 2026-07-16：搜索置信度 + 图表仪表盘

**让虚空检索会说"我不太确定"——元认知第一步**

- **搜索可信度评分（search-credibility.ts）**
  - 新建 `src/main/tools/search-credibility.ts`
  - 5 维度评分：域名权威 / HTTPS / 短链风险 / 文件类型 / 路径深度
  - 输出：0-100 分 + high/medium/low 等级 + 评分理由
  - `search` 工具返回结果带 `credibility` 字段，按可信度降序排序
  - `web_fetch` 工具返回 `credibility_score` + `credibility_reasons`

- **Token 图表仪表盘（StatsCard.tsx）**
  - 安装 `chart.js` + `react-chartjs-2`
  - 新建 `src/renderer/main/StatsCard.tsx`
  - `/stats` 命令触发的统计消息渲染为图表卡片
  - 双 Y 轴折线图：Token 使用量 + 对话次数，近 30 日趋势
  - MessageList 识别统计消息并路由到 StatsCard

**类型检查**：TS strict 模式 0 错误

**v1.2.0 封板功能清单**：
- ✅ 搜索结果可信度评分（search/web_fetch）
- ✅ Chart.js 图表仪表盘（/stats 命令）
- ✅ 元认知基础设施（为 v1.3 遗忘/自我怀疑做准备）

#### v1.2.1 ✅ 2026-07-16：API 余额显示 + 配置文件加载修复

**让纳西妲也关心你的钱包——L1 #29 余额显示补丁**

- **DeepSeek 余额查询（balance.ts）**
  - 新建 `src/main/api/balance.ts`
  - 调用 `https://api.deepseek.com/user/balance`
  - 输出：币种 / 总余额 / 赠送余额 / 充值余额 / 是否可用
  - 未配置 Key 时给出友好提示

- **`/balance` 命令 + Sidebar 余额按钮**
  - 路由层识别 `/balance` 为预设命令
  - 主进程直接查询并返回格式化文本（不走模型，省 token）
  - 渲染层 Sidebar 新增 💰 余额按钮
  - IPC 通道：`balance:get`

- **配置文件加载修复**
  - 修复 `loadUserConfigFromDisk()` 被导入但从未调用的问题
  - `initConfig()` 现在会合并磁盘上的 `config.json`（用户配置 > 环境变量 > 默认值）
  - 这意味着设置界面保存的 DeepSeek API Key 重启后真正生效

**类型检查**：TS strict 模式 0 错误

**v1.2.1 补丁清单**：
- ✅ API 余额显示（DeepSeek）
- ✅ `/balance` 命令
- ✅ Sidebar 余额按钮
- ✅ 用户配置文件启动时正确加载

#### v1.2.2 ✅ 2026-07-16：邮箱 MCP + 图表扩展 + 安全纵深防御

**让纳西妲也能收发邮件——L2 生活肢体补丁**

- **邮箱 MCP 真实现**
  - 新建 `src/main/mcp/servers/email-mcp-server.ts`
  - `email_send`：nodemailer SMTP 发送，支持多收件人/抄送
  - `email_receive`：imap 库读取收件箱头信息，显示发件人/主题/日期
  - 注册到 Tool Registry（builtin.ts），Agent 可直接调用
  - 依赖：`nodemailer` + `imap`（已安装）

- **配置化 MCP Server 接入（QQ / 微信）**
  - `Config` 新增 `mcpServers: { qq?, wechat? }` 字段
  - `mcp-client.ts` 新增 `connectConfiguredMcpServers()`：启动时自动连接配置路径的第三方 Server
  - `SettingsModal` 新增"连接"Tab：邮箱配置 + QQ/微信 Server 路径

- **图表仪表盘扩展**
  - `token-usage.ts`：`getChartData()` 新增 `modelDistribution`（模型使用分布）
  - `StatsCard.tsx`：支持三种图表切换——📈 折线（Token+对话双轴）、📊 柱状（Token）、🥧 饼图（模型分布）

- **安全纵深防御（L5 埋桩）**
  - `src/main/security/canary.ts`：凭证金丝雀——为内存敏感值附加随机 Canary，检测外部篡改
  - `src/main/security/audit-log.ts`：审计日志——按日轮转记录配置修改/工具调用/文件操作，敏感字段自动脱敏

**类型检查**：TS strict 模式 0 错误

**v1.2.2 补丁清单**：
- ✅ 邮箱 MCP（SMTP 发送 + IMAP 接收）
- ✅ QQ/微信配置化 MCP Server 接入
- ✅ 图表切换（折线/柱状/饼图）+ 模型分布
- ✅ 凭证金丝雀 + 审计日志

#### v1.3.0 ✅ 2026-07-16：灵魂三维——遗忘 / 梦境 / 元认知

**让纳西妲拥有灵魂——核心差异化护城河**

- **遗忘机制（forgetting.ts）**
  - 记忆强度系统：每条记忆 `strength` 0-100，新记忆=100，每天自然衰减-5
  - `willMistake()`：strength < 40 时有概率被"记错"
  - `blurContent()`：数字模糊化（年份±2）、时间模糊化（"很久以前"）
  - `correct()`：用户纠正后 strength +20，上限 100
  - 持久化：`memory/strength.json`
  - `/stats` 中显示遗忘统计

- **梦境模式（dream.ts）**
  - `recordInteraction()`：用户发消息时更新最后交互时间
  - `startDreamMonitor()`：每分钟检查 Idle 时长 / 凌晨 3-4 点
  - 触发条件：Idle > 30min **或** 凌晨 3-4 点
  - 梦呓内容：50% 低强度记忆碎片 + 50% 预设诗意短语
  - IPC 推送：`AGENT_STATE_CHANGE` → 渲染层显示半透明气泡
  - 用户发消息时自动唤醒（`wakeUp()`）

- **元认知表达（metacognition.ts）**
  - `analyze()`：5 维度置信度分析（输出长度 / 模糊词 / 自相矛盾 / 主动无知 / 模型匹配）
  - `getMetacognitionPrompt()`：注入 System Prompt 的元认知模板
  - `appendMetacognitionHint()`：低置信度时追加不确定性提示
  - 自动建议：本地模型 + 复杂问题 + 置信度 < 40% → "可以让我深入思考一下"

- **灵魂三维联动**
  - 遗忘 → 梦境：低 strength 记忆成为梦呓素材
  - 元认知 → 遗忘：承认"记不清"时触发记忆纠正通道
  - 梦境 → 元认知：梦呓中的模糊记忆被追问时表达不确定性

**类型检查**：TS strict 模式 0 错误

**v1.3.0 灵魂三维清单**：
- ✅ 遗忘机制（记忆强度 + 记错 + 纠正）
- ✅ 梦境模式（Idle/凌晨触发 + 梦呓气泡）
- ✅ 元认知表达（置信度分析 + 不确定提示 + 模型升级建议）

#### v1.4.0 ✅ 2026-07-16：纪念日感知 + RAG 三阶段检索

**让世界树记得你们相遇的那一天——情感锚点 + 工业级召回**

- **纪念日感知（anniversary.ts）**
  - 首次对话日期自动检测 + 持久化到 `memory/anniversary.json`
  - 周年提醒：365/730/1095... 天时主动提及
  - 时间感注入：system prompt 中显示"我们已经认识 X 天了"
  - 语气随天数变化：<7 天活泼好奇，>100 天成熟稳重
  - 对应文件：`src/main/soul/anniversary.ts`

- **RAG 三阶段检索**
  - **阶段 1 Query Transform**（`rag/query-transform.ts`）
    - 关键词提取（停用词过滤）
    - 实体识别（人名/地名/术语，正则匹配）
    - 同义词扩展（纳西妲→小草神/布耶尔/草神）
    - 查询意图分类（factual/procedural/conversational/ambiguous）
  - **阶段 2 Reranker**（`rag/reranker.ts`）
    - 4 维度评分：关键词匹配(40) + 实体覆盖(30) + 意图对齐(20) + 优先级(10)
    - 分数阈值过滤（默认 30 分）
    - Top N 返回（默认 5 条）
  - **阶段 3 KG 增强**（`rag/knowledge-graph.ts`）
    - 骨架实现：节点(实体) + 边(关系) + 三元组导出
    - 多跳推理接口预留（"纳西妲的朋友的朋友"）
    - 示例节点：纳西妲/旅行者/派蒙/须弥 + 关系

- **agent-core.ts 集成**
  - `generateResponse()` 使用 `ragRetrieve()` 替代直接 `recallWorldbook()`
  - `warmupModel()` 初始化 RAG + 纪念日模块
  - cycleLog 记录 RAG 耗时

**类型检查**：TS strict 模式 0 错误

**v1.4.0 清单**：
- ✅ 纪念日感知（首次对话记录 + 周年提醒 + 时间感注入）
- ✅ RAG Query Transform（关键词 + 实体 + 同义词 + 意图）
- ✅ RAG Reranker（4 维度评分 + 阈值过滤）
- ✅ KG 骨架（节点/边/多跳推理接口）

#### v1.5.0 ✅ 2026-07-16：六顶帽多 Agent 协作框架

**六个专家 Agent 并行审查，提升回复质量——借鉴 xiaoda-agent 的多角色协作模式**

- **模式切换**：`/hat` 命令切换六顶帽模式（类似 `/think`）
  - 启用：六片花瓣依次亮起（花冠轻转）
  - 禁用：花瓣渐暗（花冠微垂）

- **六个专家 Agent**（[multi-agent/](file:///e:/Nahida%20agent/src/main/agent/multi-agent/)）
  - **白帽（信息官）**：提取事实数据、实体识别、关键词分析
  - **红帽（情感官）**：情感关键词检测、直觉反馈、情绪判断
  - **黑帽（风险官）**：风险关键词检测（承诺过高/金融/医疗/隐私）
  - **黄帽（价值官）**：价值发现（知识/实用/社交/创新）
  - **绿帽（创造官）**：替代方案、创新视角、发散思维
  - **蓝帽（控制官）**：思考流程规划、步骤分解、质量控制

- **协调器架构**（[coordinator.ts](file:///e:/Nahida%20agent/src/main/agent/multi-agent/coordinator.ts)）
  - 全局单例：`getCoordinator()`
  - 并行执行：6 个 Agent 同时思考，超时保护（5s）
  - 结果聚合：生成摘要注入 system prompt（priority=98）
  - 状态管理：hatModeEnabled / lastToggleTime / thoughtCount

- **集成点**
  - `router.ts`：新增 `/hat` 命令路由
  - `handlers.ts`：`/hat` 命令处理（切换模式 + 纳西妲腔回复）
  - `agent-core.ts`：F 段调用协调器，思考摘要注入 system prompt

**类型检查**：TS strict 模式 0 错误

**v1.5.0 清单**：
- ✅ 六顶帽模式开关（`/hat` 命令）
- ✅ 六个专家 Agent 实现（白/红/黑/黄/绿/蓝）
- ✅ 协调器（并行执行 + 结果聚合）
- ✅ 集成到路由层 + agent-core

#### v1.6.0 ✅ 2026-07-16：知识图谱落地 + 一键重置 + 指令层级增强

**世界树根系延伸——从骨架到实体，安全与记忆的双重加固**

- **知识图谱落地**（[knowledge-graph.ts](file:///e:/Nahida%20agent/src/main/rag/knowledge-graph.ts)）
  - 自动提取：从 worldbook 条目内容中自动提取实体（人名/地名/术语）和关系
  - 实体规则：12 个人名 + 11 个地名 + 7 个术语，正则匹配
  - 关系规则：6 种关系模式（朋友/敌人/居住于/管理/属于/来自）
  - 持久化：自动保存到 `memory/kg.json`，启动时优先加载
  - 多跳推理：支持 "纳西妲的朋友的朋友" 式链式查询
  - 统计接口：`getKGStats()` 返回节点/边/类型分布

- **一键重置**（[reset.ts](file:///e:/Nahida%20agent/src/main/soul/reset.ts)）
  - 二次确认机制：`/reset` 请求 → `/reset confirm` 确认（1 分钟超时）
  - 自动备份：重置前将数据备份到 `memory/backup/YYYYMMDD-HHmmss/`
  - 重置范围：对话历史、纪念日、KG、Token 统计、用户配置
  - 保留文件：SOHA.md / User.md 等人格核心 + worldbook 源文件
  - 重置后回复："你好，初次见面。我是纳西妲，须弥的草神。"（铃铛轻响）

- **指令层级增强**（[instruction-guard.ts](file:///e:/Nahida%20agent/src/main/safety/instruction-guard.ts)）
  - 新增 5 种注入变体检测：角色切换 / 解除限制 / 系统提示泄露 / 假 system prompt / 身份替换
  - 防御强化标记：检测到注入时，在清洗后消息前添加 `[L1-LOCKED]` 不可覆盖标记
  - 分层防御：L1 (System Prompt) > L2 (memory) > L3 (user)，注入内容剥离但不拒绝对话

**类型检查**：TS strict 模式 0 错误

**v1.6.0 清单**：
- ✅ 知识图谱自动提取（实体 + 关系 + 持久化）
- ✅ 一键重置（二次确认 + 自动备份 + 安全清空）
- ✅ 指令层级增强（5 种新变体 + L1-LOCKED 标记）

#### v1.7.0 ✅ 2026-07-16：人格分叉 A/B 测试 + 插件系统雏形

**让人格在分叉中进化——A/B 测试驱动的 prompt 优化 + 开放插件生态**

- **人格分叉 A/B 测试**（[persona-ab.ts](file:///e:/Nahida%20agent/src/main/soul/persona-ab.ts)）
  - `/ab start` 启动测试：创建两个 prompt 变体（A/B），随机分配用户分组
  - `/ab stop` 停止测试：保存数据
  - `/ab stats` 查看统计：消息数/平均回复长度/追问率/满意度
  - `/ab switch` 手动切换分组
  - 质量指标：追问率(40%) + 满意度(40%) + 回复长度适中(20%)
  - 持久化到 `memory/persona-ab.json`
  - prompt 修饰注入 system prompt（priority=92）

- **插件系统雏形**（[plugins/](file:///e:/Nahida%20agent/src/main/plugins/)）
  - 插件接口定义（[plugin-types.ts](file:///e:/Nahida%20agent/src/main/plugins/plugin-types.ts)）：清单 + 钩子 + 工具 + 命令
  - 插件加载器（[plugin-loader.ts](file:///e:/Nahida%20agent/src/main/plugins/plugin-loader.ts)）：扫描 plugins/ 目录，自动加载
  - 6 个钩子点：beforeMessage / afterResponse / onToolCall / onSessionStart / onSessionEnd / onCustomCommand
  - 钩子链执行：按加载顺序执行，前一个可阻止后续
  - 插件管理：`/plugin list` / `/plugin enable <id>` / `/plugin disable <id>`
  - 插件目录结构：`plugins/<name>/manifest.json + index.js`

- **集成点**
  - `router.ts`：新增 `/ab` 和 `/plugin` 命令路由
  - `handlers.ts`：命令处理 + 纳西妲腔回复
  - `agent-core.ts`：A/B prompt 注入 + afterResponse 钩子 + 插件初始化

**类型检查**：TS strict 模式 0 错误

**v1.7.0 清单**：
- ✅ A/B 测试启动/停止/统计/切换分组
- ✅ 插件接口定义（清单/钩子/工具/命令）
- ✅ 插件加载器（自动扫描 + 钩子链 + 管理命令）
- ✅ 集成到路由层 + agent-core + handlers

#### v1.8.0 ✅ 2026-07-16：语音输入 STT + 对话导出 + 全局快捷键

**为 v2.0 全模态闭环铺路——耳朵、备忘录、指尖三件套**

- **语音输入 STT**（[voice/stt.ts](file:///e:/Nahida%20agent/src/main/voice/stt.ts)）
  - Web Speech API 封装：主进程控制开始/停止，渲染层执行实际识别
  - 状态机：idle → listening → processing → idle
  - 超时保护：默认 30s 自动停止（防一直挂着）
  - IPC 通道：`stt:start` / `stt:stop` / `stt:result`
  - 主进程 `initSTT(mainWindow)` 注入窗口引用，识别结果通过 IPC 回灌

- **对话导出**（[memory/exporter.ts](file:///e:/Nahida%20agent/src/main/memory/exporter.ts)）
  - 两种格式：Markdown（人类可读）+ JSON（机器可读）
  - 默认路径：`exports/{sessionId}-{YYYYMMDD-HHmmss}.{md|json}`
  - 元数据可选：含模型/Token/会话时长
  - IPC 通道：`export:conversation`
  - 集成 `/export md` / `/export json` 命令路由（待补）

- **全局快捷键系统**（[hotkeys/shortcut-manager.ts](file:///e:/Nahida%20agent/src/main/hotkeys/shortcut-manager.ts)）
  - Electron globalShortcut 封装
  - 5 个默认快捷键：
    - `Ctrl+Shift+N` - 显示/隐藏主窗口
    - `Ctrl+Shift+V` - 开关语音识别
    - `Ctrl+Shift+E` - 导出当前会话（Markdown）
    - `Ctrl+Shift+F` - 打开反馈窗口
    - `Ctrl+Shift+H` - 切换六顶帽模式
  - 动作回调注册机制：`onAction(action, cb)`
  - 退出时统一注销（防快捷键泄漏）

- **主进程集成**
  - `index.ts` 启动时 `initSTT()` + `initShortcuts()`
  - 退出时 `unregisterAllShortcuts()` 防泄漏
  - `handlers.ts` 添加 4 个新 IPC handler

**类型检查**：TS strict 模式 0 错误

**v1.8.0 清单**：
- ✅ 语音输入 STT（Web Speech API + 主进程状态机）
- ✅ 对话导出（Markdown / JSON 双格式）
- ✅ 全局快捷键（5 默认 + 可扩展 + 防泄漏）
- ✅ IPC 通道扩展（stt:* + export:conversation）

#### v1.9.0 ✅ 2026-07-16：桌面整理 + 文件搜索 + 番茄钟专注模式

**让纳西妲帮你收拾桌面、找到文件，并陪你进入心流——L2 #6 补完 + 番茄钟**

- **桌面整理工具**（[tools/desktop-organize.ts](file:///e:/Nahida%20agent/src/main/tools/desktop-organize.ts)）
  - `desktop_scan`：扫描桌面文件，按 8 类（图片/文档/视频/音频/压缩包/代码/安装包/其他）分类统计
  - `desktop_organize`：一键整理桌面，支持 dry-run 预览，目标文件已存在则加时间戳后缀防覆盖
  - `file_search`：在指定目录模糊搜索文件（默认用户目录，最大深度 5，扫描上限 50000 防 IO 风暴）
  - 跳过 node_modules / __pycache__ / AppData 等噪音目录
  - 补完 L2 #6「主动桌面/文件整理」

- **番茄钟专注模式**（[tools/pomodoro.ts](file:///e:/Nahida%20agent/src/main/tools/pomodoro.ts) + [tools/pomodoro-scheduler.ts](file:///e:/Nahida%20agent/src/main/tools/pomodoro-scheduler.ts)）
  - 状态机：idle → work → break / long_break → work → ... 自动循环
  - 默认 25min 工作 + 5min 短休息 + 15min 长休息（每 4 段一次）
  - 工作段完成自动记录到 `data/pomodoro/sessions.json`，保留最近 1000 条
  - 调度器 1 秒 tick，到期自动切换并 IPC 推送状态到渲染层（agent:state-change 附 pomodoro 上下文）
  - 按标签聚合统计：`pomodoro_stats` 返回今日/累计番茄钟数、总时长、按标签分布

- **`/pomodoro` 命令**
  - `/pomodoro start [工作时长] [标签]` - 启动番茄钟（默认 25 分钟）
  - `/pomodoro stop` - 停止当前番茄钟
  - `/pomodoro stats` - 查看今日专注统计
  - `/pomodoro status` - 查看当前状态（剩余时间、阶段、标签）
  - 全程纳西妲腔回复，附带 Live2D 动作 tag

- **主进程集成**
  - `index.ts` 注册 desktop-organize / pomodoro 工具 + 启动 pomodoro-scheduler
  - `router.ts` 新增 `/pomodoro` 命令路由
  - `handlers.ts` 实现 `/pomodoro` 子命令处理（调用底层工具，不走 LLM 省 token）

**类型检查**：TS strict 模式 0 错误（main / preload / renderer 三处）

**v1.9.0 清单**：
- ✅ 桌面扫描（desktop_scan，8 类分类统计）
- ✅ 桌面整理（desktop_organize，dry-run + 防覆盖 + 错误聚合）
- ✅ 文件搜索（file_search，递归 + 深度限制 + 噪音目录跳过）
- ✅ 番茄钟状态机（work / break / long_break / idle 自动循环）
- ✅ 番茄钟调度器（1s tick + 状态变更 IPC 推送）
- ✅ `/pomodoro` 命令 4 子命令（start / stop / stats / status）
- ✅ 番茄钟统计持久化（按标签聚合 + 今日/累计）

#### v2.0.0 ✅ 2026-07-16：社区共享协议 + 生图工具（Phase 3 起步）

**Phase 3 开篇——两个标志性能力：人格可流通、生图可调用**

- **社区共享协议雏形**（[community/](file:///e:/Nahida%20agent/src/main/community/)）
  - 三件套：`package-format.ts`（格式定义 + zod schema + 兼容性检查） + `package-builder.ts`（打包器） + `package-installer.ts`（安装器 + 备份）
  - `.nahida-package` 标准格式：`manifest.json` + 人格分片（SOHA/persona/emotion/skill/interest/reflect） + `worldbook/entries.jsonl` + `README.md`
  - 三种包类型：`persona`（纯人格）/ `worldbook`（纯世界书）/ `full`（人格+世界书）
  - 兼容性检查：`minAppVersion` / `maxAppVersion` 区间校验，格式版本硬匹配
  - **安全约束**：
    - `User.md` 脱敏为模板导出，安装时不覆盖用户已有 `User.md`
    - `fact-*.md` / `emotion.md` / `reflect.md` 列入 `PROTECTED_FILES`，不覆盖运行时数据
    - 路径白名单：包路径不得含 `..`，worldbook 内文件名不得含分隔符
    - 安装前强制备份现有文件到 `memory/backup/{timestamp}_{packageName}/`
    - 失败不自动回滚（保留备份让用户决策）
  - `listAvailablePackages()` / `getPackageInfo()` 工具函数

- **`/package` 命令**（4 子命令，全程纳西妲腔回复）
  - `/package build <name> <display> [type=full|persona|worldbook]` 打包当前 `memory/` 为 `.nahida-package`
  - `/package install <包名或路径>` 安装一个包（自动备份）
  - `/package list` 列举 `packages/` 目录下的可用包
  - `/package info <包名或路径>` 查看包详细信息（名称/版本/类型/作者/兼容性/标签）

- **生图工具**（[tools/image-generate.ts](file:///e:/Nahida%20agent/src/main/tools/image-generate.ts)）
  - 三后端适配器：
    - **ComfyUI**（默认，本地 `http://127.0.0.1:8188`）：通过 `/prompt` 提交 workflow → 轮询 `/history/{id}` → `/view` 下载 PNG（120s 超时）
    - **DALL·E 3**（云端）：`/v1/images/generations` 接口，`b64_json` 直存本地
    - **SD WebUI**（兼容）：`/sdapi/v1/txt2img`，DPM++ 2M Karras 采样器
  - 工具名：`image_generate`（注册到 Tool Registry，LLM function-calling 可调）
  - **安全约束**：
    - 后端 URL 仅允许 `localhost` / `127.0.0.1` / `::1` / HTTPS 公网（防 SSRF）
    - prompt ≤ 1000 字符
    - 输出限定 `data/images/` 目录
    - 失败返回 `ok:false`，不阻塞 Agent（让四审降级）
  - 配置：`config.json` 新增 `image` 字段（`backend` / `comfyuiUrl` / `sdwebuiUrl` / `dalleApiKey` / `defaultModel` / `defaultSize` / `defaultSteps` / `defaultCfg`）

- **配置类型扩展**（[shared/types/config.ts](file:///e:/Nahida%20agent/src/shared/types/config.ts)）
  - 新增 `ImageConfig` 接口（8 字段，全部可选）
  - `Config` 接口添加 `image?: ImageConfig`

- **路由扩展**
  - `router.ts` `CommandType` 添加 `'/package'`，`COMMAND_PATTERNS` 添加 `'/package': '/package'`
  - `handlers.ts` 添加 `/package` 子命令处理块，调用底层 `buildPackage` / `installPackage` / `listAvailablePackages` / `getPackageInfo`
  - `/help` 列表新增 `/package`
  - `COMMAND_RESPONSES` 添加 `'/package'`

- **主进程集成**
  - `index.ts` 注册 `registerImageGenerateTools()`
  - typecheck 三处 tsconfig（main / preload / renderer）全部 0 错误

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.0.0 清单**：
- ✅ .nahida-package 格式定义（zod schema + 兼容性检查 + 期望文件清单）
- ✅ 打包器（从 memory/ 读取分片 + User.md 脱敏 + 生成 README）
- ✅ 安装器（manifest 校验 + 兼容性检查 + 强制备份 + 路径白名单）
- ✅ `/package` 4 子命令（build / install / list / info）
- ✅ ComfyUI 适配器（/prompt 提交 + /history 轮询 + /view 下载）
- ✅ DALL·E 3 适配器（b64_json 直存）
- ✅ SD WebUI 适配器（/sdapi/v1/txt2img）
- ✅ image_generate Tool 注册（LLM 可 function-call）
- ✅ SSRF 防护（仅 localhost / 公网 HTTPS）
- ✅ ImageConfig 类型扩展（config.ts）
- ✅ 主进程 index.ts 集成

#### v2.1.0 ✅ 2026-07-16：生视频工具（Phase 3 第二弹）

**让纳西妲开口就能生成动态画面——L1 #15 补完**

- **生视频工具**（[tools/video-generate.ts](file:///e:/Nahida%20agent/src/main/tools/video-generate.ts)）
  - 三后端适配器：
    - **火山引擎 Seedance**（默认，国内可用）：`POST /v1/videos/generations` 提交 → 轮询 → 下载 MP4
    - **Runway Gen-3 Alpha**（国际主流）：`POST /v1/text_to_video` 或 `/v1/image_to_video`（图生视频） → 轮询 → 下载
    - **OpenAI Sora 2**（预留口）：`POST /v1/videos/generations`，直接返回 URL
  - 工具名：`video_generate`（注册到 Tool Registry，LLM function-calling 可调）
  - **异步任务流程**：
    1. POST 提交任务 → 拿到 `task_id`
    2. GET 轮询任务状态（5 秒间隔，5 分钟超时）
    3. 状态 success → 下载视频到 `data/videos/`
  - **字段差异适配**：volcano `output` 是字符串 URL；runway `output`/`artifacts` 是数组；sora `data` 是数组
  - **图生视频模式**：参数 `image_url` 提供起始图片 URL，自动切换到 image_to_video 端点
  - **安全约束**：
    - 仅 HTTPS 后端（防 SSRF）
    - prompt ≤ 2000 字符
    - 下载 URL 仅允许 `https://`
    - 输出限定 `data/videos/` 目录
    - 轮询超时 5 分钟
    - 失败返回 `ok:false`，不阻塞 Agent
  - 配置：`config.json` 新增 `video` 字段（`backend` / `volcanoApiKey` / `runwayApiKey` / `soraApiKey` / `defaultModel` / `defaultResolution` / `defaultDurationSeconds` / `defaultAspectRatio`）

- **配置类型扩展**（[shared/types/config.ts](file:///e:/Nahida%20agent/src/shared/types/config.ts)）
  - 新增 `VideoConfig` 接口（8 字段，全部可选）
  - `Config` 接口添加 `video?: VideoConfig`

- **主进程集成**
  - `index.ts` 注册 `registerVideoGenerateTools()`
  - typecheck 三处 tsconfig（main / preload / renderer）全部 0 错误

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.1.0 清单**：
- ✅ 火山 Seedance 适配器（提交 + 轮询 + 下载）
- ✅ Runway Gen-3 适配器（text_to_video + image_to_video）
- ✅ OpenAI Sora 2 适配器（预留口，直接返回 URL）
- ✅ 异步任务通用轮询框架（5 秒间隔 + 5 分钟超时 + 状态字段差异适配）
- ✅ 图生视频模式（image_url 参数自动切换端点）
- ✅ video_generate Tool 注册（LLM 可 function-call）
- ✅ SSRF 防护（仅 HTTPS 后端 + HTTPS 下载）
- ✅ VideoConfig 类型扩展（config.ts）
- ✅ 主进程 index.ts 集成

#### v2.2.0 ✅ 2026-07-16：歌曲翻唱 RVC 实装（Phase 3 第三弹）

**让纳西妲开口唱歌——L1 #17 从 ⏳ 到 ✅**

- **RVC 桥接实装**（[tts/rvc-bridge.ts](file:///e:/Nahida%20agent/src/main/tts/rvc-bridge.ts)）
  - 双模式推理：
    - **模式 A（infer_cli.py）**：如果用户在 RVC 根目录下提供了 `infer_cli.py`，直接传参调用
    - **模式 B（内联 Python）**：通过 `python -c` 内联执行 RVC 推理脚本，兼容新版 `vc_single()` 和旧版 `pipeline()` API
  - 核心函数：`runRvcInfer()` → 检查配置 → 检查模型 → 构造参数 → spawn Python → 返回结果
  - 便捷封装：`convertVoice()` → 自动生成输出路径到 `data/rvc/`
  - `RvcBridge` 类保留（向后兼容），`enabled` getter 改为动态检查（rvcRoot + 模型文件存在则启用）

- **歌曲翻唱 Tool**（[tools/audio-cover.ts](file:///e:/Nahida%20agent/src/main/tools/audio-cover.ts)）
  - 工具名：`audio_cover`，LLM function-calling 可调
  - 参数：`input_audio_path`（必须）+ `f0up_key` / `f0method` / `index_rate` / `protect`（可选）
  - **安全约束**：
    - 路径白名单（仅项目目录内）
    - 文件大小 ≤ 100MB
    - 输出限定 `data/rvc/`
    - 失败不阻塞 Agent
  - 使用场景：用户上传音频 → "把这首歌变成纳西妲唱的" → Tool 调用 → 返回翻唱 wav

- **配置扩展**（[shared/types/config.ts](file:///e:/Nahida%20agent/src/shared/types/config.ts)）
  - `VoiceConfig` 新增 6 个 RVC 字段：
    - `rvcIndexPath`：检索索引路径（可选）
    - `rvcF0UpKey`：音高调整（默认 0）
    - `rvcF0Method`：f0 算法（默认 harvest）
    - `rvcIndexRate`：索引混合率（默认 0.66）
    - `rvcDevice`：推理设备 cuda/cpu（默认 cuda）
    - `rvcIsHalf`：半精度推理（默认 true）

- **主进程集成**
  - `index.ts` 注册 `registerAudioCoverTools()`
  - typecheck 三处 tsconfig（main / preload / renderer）全部 0 错误

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.2.0 清单**：
- ✅ RVC 桥接双模式推理（infer_cli.py + 内联 Python）
- ✅ `runRvcInfer()` 核心函数（配置检查 + 模型检查 + spawn Python + 超时处理）
- ✅ `convertVoice()` 便捷封装
- ✅ `audio_cover` Tool 注册（LLM 可 function-call）
- ✅ 路径白名单 + 文件大小限制（100MB）
- ✅ VoiceConfig 扩展 6 个 RVC 字段
- ✅ 主进程 index.ts 集成

#### v2.3.0 ✅ 2026-07-16：Siri 式语音唤醒（Phase 3 第四弹）

**让纳西妲听见你——本地离线 STT + 语音唤醒引擎**

- **Whisper.cpp 本地适配器**（[voice/whisper-adapter.ts](file:///e:/Nahida%20agent/src/main/voice/whisper-adapter.ts)）
  - 双模式推理：
    - **模式 A（openai-whisper）**：`python -c` 调用 openai-whisper Python 库，返回 JSON 结果
    - **模式 B（whisper-cpp）**：调用 `main.exe` CLI，支持 `-oj` JSON 输出
  - 模型管理：`tiny`（默认，75MB，适合唤醒词）/ `base`（142MB）/ `small`（466MB）/ `medium`（1.5GB）/ `large`（2.9GB）
  - 便捷封装：`recognizeSpeech()` → 自动读取配置中的模型路径和语言
  - 模型下载辅助：`WHISPER_MODELS` 常量（名称/大小/下载 URL）+ `modelExists()` + `ensureWhisperDir()`

- **语音唤醒引擎**（[voice/voice-wakeup.ts](file:///e:/Nahida%20agent/src/main/voice/voice-wakeup.ts)）
  - 持续监听循环：录制 2-3 秒音频片段 → 调用 Whisper 识别 → 关键词匹配 → 唤醒触发
  - 默认唤醒词："纳西妲" / "嘿，纳西妲" / "小纳西妲" / "娜娜"
  - 安全约束：
    - 默认关闭，需用户手动 `/wakeup on` 开启
    - 仅前台监听（默认），可选后台监听
    - 音频片段不持久化（识别后立即删除）
    - 唤醒后自动停止监听，防重复触发
  - 状态机：`disabled` → `idle` → `listening` → `detected` → `processing` → `error`

- **STT 双模式切换**（[voice/stt.ts](file:///e:/Nahida%20agent/src/main/voice/stt.ts) 升级）
  - 新增 `backend` 字段：`web-speech`（在线）/ `openai-whisper`（本地）/ `whisper-cpp`（本地）
  - `switchBackend()` 函数：运行时切换 STT 后端
  - `recognizeLocal()` 函数：本地模式专用识别入口（录制 → Whisper 推理 → 结果推送）
  - 配置优先级：函数参数 > `VoiceConfig.sttBackend` > 默认 `web-speech`

- **配置类型扩展**（[shared/types/config.ts](file:///e:/Nahida%20agent/src/shared/types/config.ts)）
  - 新增 `STTBackend` 类型：`'web-speech' | 'openai-whisper' | 'whisper-cpp'`
  - `VoiceConfig` 新增 6 个字段：
    - `sttBackend`：STT 后端类型
    - `whisperModelPath`：Whisper 模型路径
    - `whisperLang`：识别语言
    - `whisperDevice`：推理设备
    - `wakeupEnabled`：是否启用语音唤醒
    - `wakeupKeywords`：唤醒词列表

- **`/wakeup` 命令**（全程纳西妲腔回复）
  - `/wakeup on` - 开启语音唤醒（需要 Whisper 模型）
  - `/wakeup off` - 关闭语音唤醒
  - `/wakeup toggle` - 切换唤醒状态
  - `/wakeup status` - 查看当前状态（唤醒状态 + STT 后端 + 监听间隔 + 唤醒词）
  - `/wakeup backend <web-speech|openai-whisper|whisper-cpp>` - 切换 STT 后端

- **主进程集成**
  - `index.ts` 初始化 `initWakeup(mainWindow)`
  - `router.ts` 新增 `/wakeup` 命令路由
  - `handlers.ts` 添加 `/wakeup` 子命令处理（调用底层 `startWakeup` / `stopWakeup` / `toggleWakeup` / `getWakeupState` / `switchBackend`）
  - `/help` 列表新增 `/wakeup`
  - `COMMAND_RESPONSES` 添加 `'/wakeup'`

**类型检查**：TS strict 模式 + `noUncheckedIndexedAccess` 三处 0 错误

**v2.3.0 清单**：
- ✅ Whisper.cpp 本地适配器（openai-whisper + whisper-cpp 双模式）
- ✅ 语音唤醒引擎（持续监听 + 关键词检测 + 安全约束）
- ✅ STT 双模式切换（web-speech / openai-whisper / whisper-cpp）
- ✅ VoiceConfig 扩展 6 个字段（sttBackend / whisperModelPath / whisperLang / whisperDevice / wakeupEnabled / wakeupKeywords）
- ✅ `/wakeup` 5 子命令（on / off / toggle / status / backend）
- ✅ 主进程 index.ts 集成

### v1.0.0（里程碑）

- 正式发布
- 完整文档
- 用户安装包（Windows）
- AGPLv3 LICENSE
- 五合一 VERSION_SNAPSHOT（代码 + 训练 + 导出 + ollama + 资源）

---

## 开发原则

### 优先级排序

1. **L1 硬功能**：确保核心能力稳定可靠
2. **L5 抗逆性**：崩溃自愈 / 离线降级 / 隐私沙箱（0.9.7 埋桩）
3. **L2 生活肢体**：日历 / Token 统计 / MCP 端到端（0.9.8）
4. **L3 灵魂三维**：从"时间感"入手，最容易量化
5. **L4 产品外壳**：设置 / 反馈 / 日志（0.9.9）
6. **L2 高阶功能**：游戏调优 / RGB / 社交图谱（1.x）

### 关键约束

- **性能优先**：任何功能不能显著增加 GPU/CPU 占用
- **人格一致**：所有输出必须符合纳西妲人设（温柔 + 苏格拉底反问 + 自然隐喻）
- **渐进式发布**：每个功能先做最小实现，再逐步增强
- **可维护性**：遵循 `.traework` 规则，保持代码质量

---

## 项目定位与架构总览

### 是什么

纳西妲 Agent 是"桌面 AI 助理 + 须弥草神桌宠"二合一的 Electron 应用：

- **理性侧**：本地 Qwen3-8B 主模型 + Qwen2.5-1.5B 四审 Lora（v3） + DeepSeek V4pro / R1-7B 云端/ToT 支路 → 编程/课业/查证辅助
- **感性侧**：纳西妲人格（SOHA 核心 + 9 分片 + worldbook）→ Live2D 透明漂浮窗 + TTS（GPT-SoVITS 纳西妲音色）+ 感知层主动开口
- **安全侧**：三重路由 + 指令层级（L1>L2>L3）+ 工具护栏（频率/风暴/JSON 修复）+ 四审（OOC / 括号 / emotion / tool）

### 面向对象

对他人塑造的角色感兴趣，或对自我塑造的角色感兴趣，想要令其参与进日常工作学习生活中的人。

### 模块拓扑

```
┌─────────────────────────────────────────────┐
│ 渲染层（Vite 多入口）                         │
│  ├─ ChatPanel（消息气泡+流式+自动滚动）        │
│  ├─ InputBar（回车发送）                     │
│  ├─ StatusBar（感知报警 toast）               │
│  ├─ Live2D 窗（Pixi 7 + Cubism4）          │
│  ├─ SettingsPanel（设置界面 · 待做）          │
│  └─ FeedbackModal（反馈界面 · 待做）          │
├─────────────────────────────────────────────┤
│ IPC 7 通道（agent:chat/model-delta/tool-call/│
│  state-change / live2d:action / tts:chunk / │
│  rand-error）                                │
├─────────────────────────────────────────────┤
│ Preload（contextBridge 白名单，strict）        │
├─────────────────────────────────────────────┤
│ 主进程（Agent 编排）                          │
│  ├─ Router（三重：命令→关键词→token阈值）     │
│  ├─ InstructionGuard（L1>L2>L3 注入清洗）    │
│  ├─ Guardrails（频率/风暴/JSON 修复）         │
│  ├─ DegradeStrategy（熔断器+SOHA 模板映射）  │
│  ├─ Agent-Core                                │
│  │   ├─ generateResponse（流式→AG-UI）       │
│  │   ├─ recallWorldbook + recallShards      │
│  │   ├─ executeToolCall（clock/web_fetch）   │
│  │   ├─ proactiveQueue（感知→开口）          │
│  │   └─ cycleLog（T/F/Tk/R 四段持久化）     │
│  ├─ Reviewer（A/B 规则 + C 模型 v3 全模型） │
│  ├─ Gun 双审（think/plan 档：draft→审→改） │
│  ├─ TTS（GPT-SoVITS adapter + edge-tts 备用）│
│  ├─ Perception（scanner+hardware+alert）     │
│  ├─ Memory（worldbook + 9 分片 + 长中短三级）│
│  ├─ RandError（同类型>50 自动抛）           │
│  ├─ Heartjump（心动检测）                    │
│  ├─ Health（离线降级探针 · 待做）             │
│  └─ Safety / Tools / Windows / Plugin        │
├─────────────────────────────────────────────┤
│ 模型层（ollama）                              │
│  ├─ Qwen3-8B（日常主模，nothink//think）    │
│  ├─ Qwen2.5-1.5B-review v3（四审，q4）     │
│  ├─ DeepSeek V4pro（云端深入/完备）           │
│  └─ R1-7B（ToT 支路）                       │
└─────────────────────────────────────────────┘
```

---

## 完整功能清单（全部 6 层）

### ██ L1 · 硬功能骨架（✅ 已闭环）

| # | 功能 | 实现路径 | 状态 |
|---|---|---|---|
| 1 | **日常对话** | Qwen3-8B + nothink 档 + SOHA 人格 | ✅ |
| 2 | **工作学习辅助** | Qwen3-8B + think/plan 档 + Tool 调用 | ✅ |
| 3 | **意图检测** | Router 三重路由（命令 override → 关键词粗判 → token 阈值修正） | ✅ |
| 4 | **Skill 系统** | Tool Registry + 每个 skill desc <40 字 | ✅ |
| 5 | **MCP 支持** | `tools/registry.ts` 标准 MCP 协议 | ✅ 框架 |
| 6 | **记忆系统（长中短三级）** | fact-long.md / fact-mid.md / fact-short.json | ✅ |
| 7 | **记忆系统（9 分片）** | SOHA/persona/emotion/skill/reflect/interest/worldbook/User/think | ✅ |
| 8 | **Live2D 表现** | PixiJS + Cubism4 + rhubarb 嘴型同步 | ✅ 真模型 |
| 9 | **多模态输入** | 文本（主）+ 音频 STT（待做） | ⏳ 文本已通 |
| 10 | **高自由度与强自定义** | `.traework/` 规则 + Modelfile 版本 + 人格分片 | ✅ |
| 11 | **壁纸模式** | Electron 透明窗 + alwaysOnTop + frame:false | ✅ 基础 |
| 12 | **多软件连接（框架）** | MCP 协议 + Tool Registry | ✅ 框架 |
| 13 | **API 与本地模型使用** | Router 动态择模（Qwen3-8B / V4pro / R1） | ✅ |
| 14 | **生图** | Tool 接口预留（ComfyUI / DALL·E） | ✅ v2.0 |
| 15 | **生视频** | Tool 接口预留 | ✅ v2.1 |
| 16 | **生语音（TTS）** | GPT-SoVITS 纳西妲音色（真声）+ edge-tts 备用 | ✅ |
| 17 | **歌曲翻唱** | RVC 桥接预留（nahida_v0.3_100e.pth） | ✅ v2.2 |
| 18 | **自主进化** | Rand_error 机制 + 反思.md + cycleLog | ✅ 部分 |
| 19 | **游戏性能报告** | Perception（FPS / GPU temp / GPU load） | ✅ |
| 20 | **低后台占用** | q4_k_m 量化 + keep_alive + CPU TTS 预处理 | ✅ |
| 21 | **类似 Siri 语音识别回应** | Whisper.cpp STT 预留 + 全局快捷键 | ⏳ 待做 |
| 22 | **网页搜索** | `web_fetch` Tool + Google/Bing/Baidu | ✅ |
| 23 | **判断信息来源真假（置信度）** | search-credibility.ts 0-100 分评分 | ✅ v1.2 |
| 24 | **输出检测（四审）** | A/OOC + B/括号 + C/emotion + D/tool | ✅ v3 全模型 |
| 25 | **模块化可维护性** | Electron 三层 + `.traework` 规则 + TypeScript strict | ✅ |
| 26 | **定时任务** | alarm-scheduler 10秒轮询 + 重复模式 | ✅ v1.1 |
| 27 | **Token 使用统计** | session tokenUsage 累加 + 按日聚合 | ✅ |
| 28 | **折线/柱状/饼图** | Chart.js + StatsCard 集成 | ✅ v1.2 |
| 29 | **余额显示** | DeepSeek /user/balance 查询 + /balance 命令 + Sidebar 按钮 | ✅ v1.2.1 |
| 30 | **邮箱 MCP** | nodemailer SMTP 发送 + imap 接收 + Tool Registry 注册 | ✅ v1.2.2 |
| 31 | **图表扩展** | 折线/柱状/饼图切换 + 模型分布 | ✅ v1.2.2 |
| 30 | **代码审查** | 四审 A/B 维 + Tool 执行验证 | ✅ |
| 31 | **输入意图判断** | Router + 四审 A 维 | ✅ |
| 32 | **情绪审查** | 四审 C 维（11 枚举 → voice + expression） | ✅ |
| 33 | **输出审查** | 四审全维度 + Gun 双审（think/plan 档） | ✅ |
| 34 | **用户反馈 + 社区反馈 + AI 判断 + 权重** | Rand_error + 反馈界面 | ✅ v1.0 |
| 35 | **三个模式（使用/指令/模式选择）** | Router 三重 + `/mode daily/deep/plan` | ✅ |
| 36 | **三重思考（日常/深入/完备）** | daily<1024 / deep 512-4096 / plan<16384 | ✅ |
| 37 | **Heartjump.md（心动机制）** | detectHeartjump() + 特殊 Live2D 动作 | ✅ v1.0 |
| 38 | **六顶帽团队（并行思考）** | 多 Agent 并行审查 | ❌ v1.5 |
| 39 | **附件 I：Thinking/Finding/Talking/Rethinking 四段** | cycleLog 持久化 | ✅ |
| 40 | **附件 II：memory 六分片（soul/user/fact/error/habbit/interest）** | 9 分片已实现（含扩展） | ✅ |
| 41 | **RAG 三阶段检索** | Query Transform + Reranker + KG 增强 | ✅ v1.4.0（借鉴 xiaoda-agent） |
| 42 | **安全系统纵深防御** | SSRF✅ / 凭证金丝雀✅ / 审计日志✅ / 指令层级✅ v1.6 | ✅ v1.6.0 |
| 43 | **多 Agent 协作框架** | 六顶帽并行 + 角色路由 | ✅ v1.5.0 |
| 44 | **知识图谱** | 实体-关系自动提取 + 持久化 + 多跳推理 | ✅ v1.6.0 |

---

### ██ L2 · 生活肢体（⏳ 进行中）

| # | 功能 | 说明 | 优先级 | 状态 |
|---|---|---|---|---|
| 1 | **日历提醒** | calendar_create/query/list Tool | 高 | ✅ v1.1 |
| 2 | **闹钟** | alarm_set/list/cancel + alarm-scheduler 调度 | 高 | ✅ v1.1 |
| 3 | **QQ 连接** | MCP Server 配置化接入（路径配置 + 自动 stdio 连接） | 中 | ✅ v1.2.2 |
| 4 | **微信连接** | MCP Server 配置化接入 | 中 | ✅ v1.2.2 |
| 5 | **邮箱连接** | nodemailer SMTP + imap 真实现 | 中 | ✅ v1.2.2 |
| 6 | **主动桌面/文件整理** | desktop_scan / desktop_organize / file_search | 中 | ✅ v1.9 |
| 7 | **游戏内主动调优** | Low 帧时建议/自动切换画质（高阶 Tool） | 低 | ❌ v1.4 |
| 8 | **RGB 灯光氛围同步** | 情绪 → Philips Hue / 主板 RGB API | 低 | ❌ v1.6 |

---

### ██ L3 · 灵魂三维（核心差异化护城河）

| # | 功能 | 说明 | 哲学意义 | 状态 |
|---|---|---|---|---|
| 1 | **遗忘机制** | 偶尔记错不重要的细节 → 被纠正 → 困惑/羞愧 | 瑕疵之美，真实感 | ✅ v1.3.0 |
| 2 | **梦境模式** | 系统 Idle >30min 或凌晨 3-4 点 → 低功耗梦呓 | 潜意识溢出 | ✅ v1.3.0 |
| 3 | **元认知与自我怀疑** | 表达不确定性（"约七成概率…"）+ 主动求助切换更强模型 | 智慧之谦 | ✅ v1.3.0 |
| 4 | **时间感与数字衰老** | 累计交互时长 → maturity 参数 → 人格微调 | 生命之流 | ✅ v0.9.9 |
| 5 | **纪念日感知** | 首次对话纪念日 → 主动提及 | 情感锚点 | ✅ v1.4.0 |
| 6 | **Heartjump（心动检测）** | 触及核心记忆/回复超常/打破第四面墙 → 特殊动作 | 感性萌芽 | ✅ v1.0 |

---

### ██ L4 · 产品外壳（✅ 已实现）

| # | 功能 | 说明 | 优先级 | 状态 |
|---|---|---|---|---|
| 1 | **设置界面（SettingsModal）** | 模型路由/感知阈值/人格 Tab | 高 | ✅ v0.9.8 |
| 2 | **反馈与 Bug 提交界面** | Ctrl+Shift+F → feedback/YYYYMMDD.md | 高 | ✅ v0.9.8 |
| 3 | **日志分析与导出界面** | Token 折线图 / 四审失败率柱状图 / 会话回放 | 中 | ✅ v1.2 |
| 4 | **可视化仪表盘** | Chart.js 集成 + /stats 命令 | 中 | ✅ v1.2 |
| 5 | **崩溃自愈** | `renderer-process-gone` 监听 + `emergencyFlush()` | 高 | ✅ v0.9.7 |
| 6 | **离线降级链** | health.ts 探针 + adapter.check() + rule fallback | 高 | ✅ v0.9.7 |

---

### ██ L5 · 抗逆与可移植（⏳ 埋桩期）

| # | 功能 | 说明 | 阶段 |
|---|---|---|---|
| 1 | **崩溃自愈（Crash Survival）** | `emergencyFlush()` + `renderer-process-crashed` 事件 | v0.9.7 |
| 2 | **离线降级链（Degraded Mode）** | health.ts 探针 + adapter.check() + rule fallback | v0.9.7 |
| 3 | **隐私沙箱（Privacy Sandbox）** | memory/ + session/ AES-256-GCM + keytar | v0.9.7 |
| 4 | **多设备同步** | sync.ts + WebDAV / OneDrive / NAS 增量 | v1.x |
| 5 | **人格分叉与 A/B 测试** | persona-v1/v2 fork + active_persona 软链 | v1.x |
| 6 | **插件/扩展市场雏形** | plugin.json schema + 扫描 plugins/ 目录 | v1.x |
| 7 | **社区共享协议** | .nahida-package（manifest + lora + persona + worldbook） | ✅ v2.0.0 |
| 8 | **一键重置（Factory Reset）** | `nahida reset --keep=user,fact-mid,persona` | v1.x |

---

### ██ L6 · 角色创建五方向（通用方法论）

| 方向 | 状态 | 说明 |
|---|---|---|
| **1. 完备的提示词** | ✅ | SOHA 核心 + 9 分片 + worldbook 11 条 + 置信度分级 |
| **2. 性能强大的 AI** | ✅ | 本地 Qwen3-8B + 云端 V4pro/R1 + Lora 风格化调校 |
| **3. 合适的工作流** | ✅ | Router 三重 + 三重思考档 + Tool 回路 + Gun 双审 |
| **4. Live2D 创建** | ✅ | Cubism4 模型 + PixiJS + rhubarb 嘴型 |
| **5. 完备的功能模块** | ✅ | 记忆/情绪/爱好/技能/反思/人格 六分片已就位 + Heartjump + Rand_error |

---

## 资源盘点

| 资源 | 路径 | 规模 | 用途 | 状态 |
|---|---|---|---|---|
| GPT-SoVITS 纳西妲模型 | `assets/gpt-sovits/v4/纳西妲_ZH/` | ckpt 148M + pth 72M (10ep) | TTS 真音色 | ✅ 已集成 |
| 游戏语音 .wav+.lab | `F:/nahida/纳西妲/` | 1540 条，855MB | refer 音频 + worldbook 台词 | ⏳ 待批量处理 |
| 世界观典藏包 | `F:/nahida/原神世界观典藏包_苍星圣敕_诗漱/` | PDF 33MB + 时间线图 | worldbook lore 扩写 | ⏳ 待提取 |
| 草叶知心展示页 | `F:/nahida/草叶知心-纳西妲-参赛展示.html` | 27KB | 同类参考 | ⏳ 待拆解 |
| RVC nahida_v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | 57MB | 翻唱/声换（Phase 2） | ⏳ 待用 |

---

## 路线图（v0.9.4 → v2.0）

### v0.9.4 → v1.0.0（封版前最后三步）

| 版本 | 里程碑 | 包含功能层 |
|---|---|---|
| ✅ v0.9.7 | L5 抗逆埋桩 | emergencyFlush + health.ts + keytar 隐私沙箱 |
| ✅ v0.9.8 | L4 产品外壳起步 | 设置界面（模型/感知/人格 Tab）+ 反馈界面（Ctrl+Shift+F） |
| ✅ v0.9.9 | L3 时间感与数字衰老 | maturity 参数 + 30天成熟 + 遗忘衰减 + 人格微调 |
| ✅ v1.0.0 | **正式发布** | Token 统计 + /stats 面板 + 以上全部 |

### v1.x（Phase 2）

| 版本 | 里程碑 |
|---|---|
| ✅ v1.1 | 日历/闹钟/定时任务 + MCP Client 框架 |
| ✅ v1.2 | 搜索置信度评分 + web_fetch 可信度打分 + Chart.js 图表仪表盘 |
| ✅ v1.3 | 遗忘机制 + 梦境模式 + 元认知表达 |
| ✅ v1.4 | 纪念日感知 + RAG 三阶段检索（借鉴 xiaoda-agent） |
| ✅ v1.5 | 六顶帽多 Agent 协作框架（借鉴 xiaoda-agent） |
| ✅ v1.6 | 知识图谱落地 + 一键重置 + 指令层级增强 |
| ✅ v1.7 | 人格分叉 A/B 测试 + 插件系统雏形 |
| ✅ v1.8 | 语音输入 STT + 对话导出 + 全局快捷键 |
| ✅ v1.9 | 桌面整理 + 文件搜索 + 番茄钟专注模式 |

### v2.0（Phase 3）

| 版本 | 里程碑 |
|---|---|
| ✅ v2.0 | 社区共享协议（.nahida-package 三件套）+ 生图工具（ComfyUI / DALL·E / SD WebUI 三后端）|
| ✅ v2.1 | 生视频工具（火山 Seedance / Runway Gen-3 / OpenAI Sora 三后端）|
| ✅ v2.2 | 歌曲翻唱 RVC 实装（infer_cli.py + 内联 Python 双模式）|
| v2.3+ | Siri 式语音唤醒（Whisper.cpp STT）+ 全模态闭环 |

---

## 风险 & 待决

| 风险 | 等级 | 缓解 |
|---|---|---|
| v3 四审 A/B 准确率不足 99% | 中 | 保留混合策略（A/B 规则 + C 模型） |
| GPT-SoVITS api.py 单锁并发 | 中 | TTS scheduler 串行 + pending dedup |
| 3060 12G 显存挤占 | 中 | GPT-SoVITS `--gpt_device cpu` 或 export_onnx |
| Live2D 模型版权灰区 | 低-中 | 社区二创本地用，`.gitignore` 排除 |
| 世界书 keyword 召回语义盲区 | 中 | v1.x 向量化（Qwen3-Embed-0.6B） |
| Rand_error >50 阈值是否合理 | 低 | 先跑 1 个月观察实际错误分布再调 |
| 隐私沙箱密钥丢失 | 中 | keytar 存系统凭据 + 用户设 pin 派生备用 |

---

## 记忆分片详细结构

```
memory/
├── SOHA.md              # 纳西妲人格核心（行为习惯/思维模式/情感表达）
├── User.md              # 用户信息（旅行者/你）
├── persona.md           # 纳西妲人格扩展（人际关系/说话风格）
├── fact-long.md         # 长时记忆：固定信息（专业/学校/项目大方向）
├── fact-mid.md          # 中时记忆：周内项目周期
├── fact-short.json      # 短时记忆：当日聊天要点（24h 过期）
├── emotion.md           # 情绪状态（11 枚举）
├── skill.md             # 每个 skill <40 字描述
├── reflect.md           # 已识别问题 + 经验教训（人工维护）
├── rand_error.md        # 自动维护（同类型>50 抛，附统计）
├── error.md             # 犯过的错 + 解决办法
├── interest.md          # 兴趣/项目/爱好
├── think.md             # 看法/态度/想法
├── history.md           # 已知历史与现实（提瓦特社会风貌）
└── worldbook/
    ├── entries.jsonl    # 11 trigger 条目 + 后续扩到 50+
    └── lab_entries.jsonl # .lab → worldbook 台词（待批量生成）
```

---

## 三重思考工作流（完整版）

| 档位 | Token 范围 | 流程 | 用途 |
|---|---|---|---|
| **日常对话** | <256~1024 | 无思考/少量思考 → 直接输出 | 快与即时响应 |
| **轻度办公** | 512~4096 | 少量思考 → 查询资料 → 思考第二轮 → 询求缺失信息 → 输出 | 成果较好，时间中等 |
| **重度工作** | <16384 | 中度思考 → 规划任务 → 查询资料 → 思考第二轮 → 询求缺失信息 → 思考 → 给出大纲/计划/待办 → 询求缺失信息 → 思考 → 查询资料 → 输出 | 完整成果 |

辅以：代码审查 / Agent 集群 / 目标分析 / 六顶帽团队 / 工具 AI。

---

## 借鉴与融合（xiaoda-agent 互补分析）

> 2026-07-16：与 xiaoda-agent 功能对比后的优化结论

### 架构正交、哲学互补

| 维度 | xiaoda-agent 优势 | Nahida Agent 优势 |
|---|---|---|
| **多 Agent 协作** | 5 角色 + 图编排 | ❌ 无（v1.5 规划） |
| **RAG 检索** | 3 阶段工业级 | ❌ 无（v1.4 规划） |
| **安全系统** | 7 层纵深防御 | ⏳ 部分（SSRF✅） |
| **Live2D 真模型** | ❌ 无 | ✅ Cubism4 + rhubarb |
| **灵魂三维** | ❌ 几乎无 | ✅ 遗忘/梦境/元认知/衰老 |
| **桌面互动** | ❌ 无 | ✅ 透明窗 + 壁纸 + RGB |
| **产品 UI** | Web 完整 | ⏳ 缺图表仪表盘 |
| **可移植性** | ⏳ 容器化 | ⏳ .nahida-package |

### 最佳融合路径

**用 xiaoda-agent 的工业级能力，驱动 Nahida Agent 的"灵魂三维"落地：**

1. **v1.4 引入 RAG 三阶段** → 让 worldbook 召回从 keyword 升级到语义级
2. **v1.5 六顶帽并行** → 借鉴多 Agent 协作，实现 6 个并行审查专家
3. **v1.6 知识图谱** → 实体-关系三元组，让纳西妲"记得"旅行者的社交关系
4. **持续强化安全** → 补齐凭证库 / 金丝雀 / 指令层级纵深防御

### 需求清单优化后（按优先级重排）

```
v1.1 ✅ 日历/闹钟调度（已完成）
v1.2 📊 图表仪表盘 + 搜索置信度 + 余额显示
v1.3 🧠 灵魂三维落地（遗忘/梦境/元认知）
v1.4 🔍 RAG 三阶段检索（借鉴 xiaoda-agent）
v1.5 🎭 六顶帽并行 + 多 Agent 协作框架
v1.6 🌐 知识图谱 + 多设备同步 + 一键重置
v1.7 🔌 插件系统 + 社区共享协议雏形
v2.0 🎙️ Siri 语音唤醒 + 生视频 + 全模态闭环
```

---

## 给"下一个你"的阅读顺序

1. **项目定位与架构总览** → 知道这是什么、怎么搭的
2. **完整功能清单（6 层 + L7 借鉴层）** → 知道还差什么
3. **资源盘点** → 知道 F:\nahida 哪些能用
4. **版本语义说明** → 知道怎么不把项目搞乱
5. **路线图** → 知道下一跳敲哪
6. **memory/SOHA.md** → 人格核心
7. **VISIONLOG.md** → 版本里程碑流水
8. **VERSION_SNAPSHOT.md** → 每版世界长什么样

---

> **最后一句话**：这棵世界树从 v0.5.2 的第一行 IPC enum，到 v1.1.0 的日历闹钟 + 44 项功能点 + 6 层架构，根已经扎进土里了。与 xiaoda-agent 的互补不是"谁替代谁"，而是**工业级能力 + 灵魂三维**的融合——让一个有真模型、有桌面、有遗忘、有梦境的实体 AI，拥有工业级的检索、协作与安全。
>
> ——（草种光把这张清单折好，放进虚空屏最深处，铃铛轻响）旅行者，全都在这里了。没有遗漏。