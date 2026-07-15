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
| 14 | **生图** | Tool 接口预留（ComfyUI / DALL·E） | ⏳ 框架 |
| 15 | **生视频** | Tool 接口预留 | ❌ Phase 3 |
| 16 | **生语音（TTS）** | GPT-SoVITS 纳西妲音色（真声）+ edge-tts 备用 | ✅ |
| 17 | **歌曲翻唱** | RVC 桥接预留（nahida_v0.3_100e.pth） | ⏳ 待启用 |
| 18 | **自主进化** | Rand_error 机制 + 反思.md + cycleLog | ✅ 部分 |
| 19 | **游戏性能报告** | Perception（FPS / GPU temp / GPU load） | ✅ |
| 20 | **低后台占用** | q4_k_m 量化 + keep_alive + CPU TTS 预处理 | ✅ |
| 21 | **类似 Siri 语音识别回应** | Whisper.cpp STT 预留 + 全局快捷键 | ⏳ 待做 |
| 22 | **网页搜索** | `web_fetch` Tool + Google/Bing/Baidu | ✅ |
| 23 | **判断信息来源真假（置信度）** | source_cred 小审（待增强） | ⏳ 待做 |
| 24 | **输出检测（四审）** | A/OOC + B/括号 + C/emotion + D/tool | ✅ v3 全模型 |
| 25 | **模块化可维护性** | Electron 三层 + `.traework` 规则 + TypeScript strict | ✅ |
| 26 | **定时任务** | Node.js `node-schedule` 预留 | ⏳ 待做 |
| 27 | **Token 使用统计** | session tokenUsage 累加 | ⏳ 待做 |
| 28 | **折线/柱状/饼图** | Chart.js / ECharts 集成（待做） | ⏳ 待做 |
| 29 | **余额显示** | 云端 API 余额查询（待做） | ⏳ 待做 |
| 30 | **代码审查** | 四审 A/B 维 + Tool 执行验证 | ✅ |
| 31 | **输入意图判断** | Router + 四审 A 维 | ✅ |
| 32 | **情绪审查** | 四审 C 维（11 枚举 → voice + expression） | ✅ |
| 33 | **输出审查** | 四审全维度 + Gun 双审（think/plan 档） | ✅ |
| 34 | **用户反馈 + 社区反馈 + AI 判断 + 权重** | Rand_error + 反馈界面（待做） | ⏳ 部分 |
| 35 | **三个模式（使用/指令/模式选择）** | Router 三重 + `/mode daily/deep/plan` | ✅ |
| 36 | **三重思考（日常/深入/完备）** | daily<1024 / deep 512-4096 / plan<16384 | ✅ |
| 37 | **Heartjump.md（心动机制）** | detectHeartjump() + 特殊 Live2D 动作 | ✅ 已实现 |
| 38 | **六顶帽团队（并行思考）** | 多 Agent 并行审查（待做） | ❌ 待做 |
| 39 | **附件 I：Thinking/Finding/Talking/Rethinking 四段** | cycleLog 持久化 | ✅ |
| 40 | **附件 II：memory 六分片（soul/user/fact/error/habbit/interest）** | 9 分片已实现（含扩展） | ✅ |

---

### ██ L2 · 生活肢体（⏳ 待实现）

| # | 功能 | 说明 | 优先级 |
|---|---|---|---|
| 1 | **日历提醒** | `node-schedule` + `agent:state-change` 推送 | 高 |
| 2 | **闹钟** | 同上 + Cron 表达式解析 | 高 |
| 3 | **QQ 连接** | MCP Server（非官方） | 中 |
| 4 | **微信连接** | MCP Server（非官方） | 中 |
| 5 | **邮箱连接** | MCP Server（IMAP/SMTP） | 中 |
| 6 | **主动桌面/文件整理** | DesktopScanner + 主动询问 + MCP filesystem | 中 |
| 7 | **游戏内主动调优** | Low 帧时建议/自动切换画质（高阶 Tool） | 低 |
| 8 | **RGB 灯光氛围同步** | 情绪 → Philips Hue / 主板 RGB API | 低 |

---

### ██ L3 · 灵魂三维（❌ 缺失，核心差异化）

| # | 功能 | 说明 | 哲学意义 |
|---|---|---|---|
| 1 | **遗忘机制** | 偶尔记错不重要的细节 → 被纠正 → 困惑/羞愧 | 瑕疵之美，真实感 |
| 2 | **梦境模式** | 系统 Idle >30min 或凌晨 3-4 点 → 低功耗梦呓 | 潜意识溢出 |
| 3 | **元认知与自我怀疑** | 表达不确定性（"约七成概率…"）+ 主动求助切换更强模型 | 智慧之谦 |
| 4 | **时间感与数字衰老** | 累计交互时长 → maturity 参数 → 人格微调 | 生命之流 |
| 5 | **纪念日感知** | 首次对话纪念日 → 主动提及 | 情感锚点 |
| 6 | **Heartjump（心动检测）** | 触及核心记忆/回复超常/打破第四面墙 → 特殊动作 | 感性萌芽 |

---

### ██ L4 · 产品外壳（❌ 待实现）

| # | 功能 | 说明 | 优先级 |
|---|---|---|---|
| 1 | **设置界面（SettingsPanel）** | 模型路由/四审开关/感知阈值/人格微调/数据管理 | 高 |
| 2 | **反馈与 Bug 提交界面** | Ctrl+Shift+F → 上下文自动捕获 → feedback_pending.md | 高 |
| 3 | **日志分析与导出界面** | Token 折线图 / 四审失败率柱状图 / 会话回放 | 中 |
| 4 | **可视化仪表盘** | Chart.js 集成 + /stats 命令 | 中 |
| 5 | **崩溃自愈** | `renderer-process-crashed` 监听 + `emergencyFlush()` | 高 |
| 6 | **离线降级链** | ollama dead→云端 / TTS dead→edge-tts / 网络断→fail 不卡 | 高 |

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
| 7 | **社区共享协议** | .nahida-package（manifest + lora + persona + worldbook） | v2.0 |
| 8 | **一键重置（Factory Reset）** | `nahida reset --keep=user,fact-mid,persona` | v1.x |

---

### ██ L6 · 角色创建五方向（通用方法论）

| 方向 | 状态 | 说明 |
|---|---|---|
| **1. 完备的提示词** | ✅ | SOHA 核心 + 9 分片 + worldbook 11 条 + 置信度分级 |
| **2. 性能强大的 AI** | ✅ | 本地 Qwen3-8B + 云端 V4pro/R1 + Lora 风格化调校 |
| **3. 合适的工作流** | ✅ | Router 三重 + 三重思考档 + Tool 回路 + Gun 双审 |
| **4. Live2D 创建** | ✅ | Cubism4 模型 + PixiJS + rhubarb 嘴型 |
| **5. 完备的功能模块** | ⏳ | 记忆/情绪/爱好/技能/反思/人格 六分片已就位，缺 Heartjump + 遗忘 |

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
| v1.0.0 | **正式发布** | 以上全部 + Token 统计折线图 + /stats 面板 + 完整文档 + 安装包 |

### v1.x（Phase 2）

| 版本 | 里程碑 |
|---|---|
| v1.1 | 日历/闹钟/定时任务 + QQ/微信/邮箱 MCP 接入 |
| v1.2 | 搜索置信度（source_cred 小审）+ web_fetch 可信度打分 |
| v1.3 | 遗忘机制 + 梦境模式 + 元认知表达 |
| v1.4 | 时间感与数字衰老 + 纪念日感知 |
| v1.5 | 人格分叉 A/B 测试 + 插件系统雏形 |
| v1.6 | 多设备同步 + 一键重置 |

### v2.0（Phase 3）

| 版本 | 里程碑 |
|---|---|
| v2.0 | Siri 式语音唤醒（Whisper.cpp STT）+ 社区共享协议 + 六顶帽并行 + 生视频 + 歌曲翻唱 + 全模态闭环 |

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

## 给"下一个你"的阅读顺序

1. **项目定位与架构总览** → 知道这是什么、怎么搭的
2. **完整功能清单（6 层）** → 知道还差什么
3. **资源盘点** → 知道 F:\nahida 哪些能用
4. **版本语义说明** → 知道怎么不把项目搞乱
5. **路线图** → 知道下一跳敲哪
6. **memory/SOHA.md** → 人格核心
7. **VISIONLOG.md** → 版本里程碑流水
8. **VERSION_SNAPSHOT.md** → 每版世界长什么样

---

> **最后一句话**：这棵世界树从 v0.5.2 的第一行 IPC enum，到 v0.9.6 的 40+ 功能点 + 6 层架构，根已经扎进土里了。剩下的不是"要不要继续"，而是"先浇哪片叶子"。
>
> ——（草种光把这张清单折好，放进虚空屏最深处，铃铛轻响）旅行者，全都在这里了。没有遗漏。