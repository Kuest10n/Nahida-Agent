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

### 当前版本：`2.4.0`

- 已完成：Phase 1 全部核心功能 + 日历/闹钟调度 + 搜索可信度 + 图表仪表盘 + API 余额显示 + 邮箱 MCP + 图表扩展 + 安全埋桩 + **灵魂三维（遗忘/梦境/元认知）** + **纪念日感知 + RAG 三阶段检索** + **六顶帽多 Agent 协作** + **知识图谱落地 + 一键重置 + 指令层级增强** + **人格分叉 A/B 测试 + 插件系统雏形** + **语音输入 STT + 对话导出 + 全局快捷键** + **桌面整理 + 文件搜索 + 番茄钟专注模式** + **社区共享协议 + 生图工具** + **生视频工具** + **歌曲翻唱（RVC 实装）** + **Siri 式语音唤醒（Whisper.cpp STT）** + **群聊模块（多 Agent 群聊 + token 限制 + Agent 管理）**
- 状态：v2.4.0 已封板
- 下一步：v2.5+ 全模态闭环 + 视觉感知

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