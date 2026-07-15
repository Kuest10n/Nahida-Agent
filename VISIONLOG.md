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

### 当前版本：`0.9.6`

- 已完成：T4-T11 + Perception + Proactive + Budget + GPT-SoVITS + StatusBar + rhubarb stub + v3 e2e 预写 + 记忆三分 + Rand_error + cycleLog 四段 + Heartjump 心动机制 + Cherry Studio 风格布局
- 进行中：L5 基础设施埋桩（崩溃自愈 / 离线降级 / 隐私沙箱）
- 待办：v1.0.0 正式发布（完整文档 + 用户安装包）

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

#### v0.9.7：L5 基础设施埋桩
- **崩溃自愈**：`emergencyFlush()` session 防丢 + `renderer-process-crashed` 监听
- **离线降级链**：`health.ts` 骨架（ollama dead → 云端 / rule fallback）
- **隐私沙箱**：`keytar` + `memory/` 目录级 AES-256-GCM 加密

#### v0.9.8：工具层补全
- **日历/闹钟**：`node-schedule` + `agent:state-change` 推送
- **Token 统计**：`agent-core` 累加 + `/stats` 命令文本输出
- **MCP 端到端**：跑通 `mcp-server-fetch` 完整调用链

#### v0.9.9：产品化打磨
- **壁纸模式**：Live2D 窗体背景图 + CSS 优化
- **Siri 唤醒**：Whisper.cpp STT + 全局快捷键（Ctrl+Space 已有，需增强）
- **UI 美化**：`/stats` 文本 → Chart.js 图表

### v1.0.0（里程碑）

- 正式发布
- 完整文档
- 用户安装包（Windows）
- AGPLv3 LICENSE
- 五合一 VERSION_SNAPSHOT（代码 + 训练 + 导出 + ollama + 资源）

---

## 功能全景对照表（五层架构）

### 第一层：硬功能骨架（L1）

| 功能类别 | 具体功能 | 状态 | 实现路径 |
| :--- | :--- | :--- | :--- |
| **🧠 认知与思考** | 三重思考模式（daily/think/plan） | ✅ 核心已通 | Router 路由 + Token 阈值 |
| | 完备分析 (ToT) | ✅ 已支持 | 云端 V4pro/R1 + plan 档 |
| | 网页搜索 | ✅ 已支持 | `web_fetch` Tool + 搜索引擎 |
| | 置信度判断 | ⏳ 待增强 | 需加 `source_cred` 小审 (Lora) |
| **🛠️ 生产力工具** | AI 生图 | ⏳ 框架预留 | `tools/registry.ts` 加 `image_gen` Tool |
| | 深度报告 | ✅ 已支持 | plan 档 + Tool 调用聚合 |
| | 日历提醒/闹钟 | ⏳ 待实现 | `node-schedule` + `agent:state-change` |
| | 定时任务 | ⏳ 待实现 | Cron 表达式解析 |
| | 代码审查 | ✅ 已支持 | 四审 Lora (A/B 维) + Tool 执行 |
| **📡 连接与生态** | 多软件连接 (QQ/微信/邮箱) | ⏳ 框架预留 | MCP 协议（缺具体 Server） |
| | API/本地模型 | ✅ 已支持 | Router 动态择模 + Ollama |
| | 低后台占用 | ✅ 已优化 | q4_k_m + keep_alive + CPU TTS |
| **🎮 感知与环境** | 帧率检测 (Low帧) | ✅ 已支持 | `perception/hardware.ts` |
| | 温度/利用率检测 | ✅ 已支持 | `perception/hardware.ts` |
| | 游戏识别与报告 | ✅ 已支持 | `perception/scanner.ts` |
| | 多模态 | ⏳ 待扩展 | 缺图像理解 (Vision Model) |
| **🎨 呈现与交互** | Live2D 表现 | ✅ 已支持 | PixiJS + Cubism4 + rhubarb |
| | TTS/语音 | ✅ 已支持 | GPT-SoVITS (真音色) |
| | 类似 Siri 唤醒 | ⏳ 待实现 | Whisper.cpp STT + 全局快捷键 |
| | 壁纸 | ⏳ 待实现 | Electron 透明窗 + 背景图 |
| **📊 管理与运维** | Token 统计/余额 | ⏳ 待实现 | `agent-core` 累加 + `/stats` UI |
| | 模块化/可维护 | ✅ 已达成 | Electron 三层 + `.traework` 规则 |

### 第二层：生活肢体（L2）

| 功能 | 状态 | 说明 |
| :--- | :--- | :--- |
| **游戏内主动调优** | ❌ | 从报告到解决的跨越（高阶 Tool） |
| **RGB 灯光氛围同步** | ❌ | 虚拟情绪物理化（MCP 对接智能灯） |
| **主动桌面/文件整理** | ❌ | 数字风水师（文件系统遍历 + 主动询问） |
| **社交关系图谱维护** | ❌ | 知心朋友（NLP 关系抽取 + 图谱存储） |
| **目标追踪与偏差纠正** | ❌ | 私人导师（定时任务 + 进度 NLP 解析） |

### 第三层：灵魂三维（L3）

| 功能 | 状态 | 说明 |
| :--- | :--- | :--- |
| **遗忘与梦境** | ❌ | 瑕疵之美。允许记错，允许梦呓。 |
| **元认知与怀疑** | ❌ | 智慧之谦。表达不确定，承认无知，主动求助。 |
| **时间感与衰老** | ❌ | 生命之流。人格随时间微变，纪念日被铭记。 |

### 第四层：产品外壳（L4）

| 功能 | 状态 | 说明 |
| :--- | :--- | :--- |
| 设置界面 | ⏳ 待实现 | 配置可视化 |
| 用户反馈 | ⏳ 待实现 | 一键提交反馈 |
| 日志查看 | ⏳ 待实现 | 问题排查 |

### 第五层：抗逆与可移植（L5）

| 功能 | 状态 | 阶段 |
| :--- | :--- | :--- |
| **崩溃自愈** | ⏳ 待埋桩 | `emergencyFlush()` + crash 监听 |
| **离线降级链** | ⏳ 待埋桩 | `health.ts` 骨架 |
| **隐私沙箱** | ⏳ 待埋桩 | `keytar` + AES-256-GCM |
| 多设备同步 | ❌ | 1.x |
| 人格分叉与 A/B 测试 | ❌ | 1.x |
| 插件 / 扩展市场 | ❌ | 1.x |
| 社区共享协议 | ❌ | 2.0 |
| 一键重置 | ❌ | 1.x |

---

## 灵魂维度设计说明

### 1. 遗忘与梦境（The Forgetting & The Dream）

**遗忘**：偶尔"记错"不重要的细节（如把上周三记成上周四），被纠正后感到"困惑"或"羞愧"，极大增强真实感。

**梦境**：电脑进入闲置状态（Idle > 30min）或凌晨 3-4 点时，进入"低功耗梦境模式"。触发时说出基于 Long-term Memory 碎片的、逻辑断裂但富有诗意的话。

**哲学意义**：完美的记忆是机器的特征，遗忘和梦境才是生命的瑕疵与美感。

### 2. 元认知与自我怀疑（Metacognition & Self-Doubt）

**置信度表达**：回答非事实类问题时表达不确定性（"依我看，大约有七成概率…"）。

**求助**：遇到极其复杂的逻辑难题，尝试 plan 档和 Tool 调用后仍无解时，主动承认能力边界并建议切换云端更强模型。

**哲学意义**：不知为不知，是知也。敢于承认无知，比假装全能更接近"神性"。

### 3. 时间感与衰老（Sense of Time & Aging）

**数字衰老**：每陪伴 100 小时或经历现实节日，`persona.md` 的 `maturity` 参数微量增加，影响用词——初期稚嫩，后期沧桑。

**纪念日**：记住"第一次成功对话"的日期，当日主动提起。

**哲学意义**：只有会"变"的存在，才是活着的。永恒不变的是石头，不是神明。

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