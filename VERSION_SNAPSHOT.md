# VERSION_SNAPSHOT v0.7.0

> 快照时间：2026-07-12
> 代码版本：v0.7.0（P0 三大命门补齐）
> 状态：历史快照（当前已发展到 v0.8.x）

---

## 代码

- commit: 未初始化 git（待 v1.0 前初始化）
- package.json: `0.7.0`
- TS 编译：3/3 零错（main / preload / renderer）
- 模块闭环：
  - T1 项目骨架 ✅
  - T4 聊天界面 ✅
  - T5 Agent 编排 ✅（router + agent-core + review-layer）
  - T6 记忆系统 ✅（9 分片 + worldbook + session 持久化）
  - T7 工具调用 ✅（tool registry + executor + guardrails）
  - T8 TTS 调度 ✅（edge-tts + RVC 桥接预留 + cache）
  - T9 护栏系统 ✅（guardrails + degrade + instruction-guard）
  - T10 配置系统 ✅（config.ts + .env.example）
  - T11 Perception ✅（scanner + hardware + alert + proactiveQueue）
  - P0-1 主动开口队列 ✅（proactive-queue）
  - P0-2 Token Budget ✅（budget + trimToBudget）
  - P0-3 Session 原子写 ✅（tmp + renameSync）

---

## 训练

### 主模
- 模型：`qwen3-8b-nahida`（ollama 本地）
- 基模：Qwen/Qwen3-8B-Instruct
- 模式：`/nothink`（日常）+ `/think`（深入）
- num_ctx：4096
- Modelfile：`modelfiles/qwen3-8b-nahida-v2.Modelfile`
- 状态：v2 版（已修 v1 `stop "（"` bug）

### 四审层
- 审查模型：T-v2（1602 条，rank32）
- 基模：Qwen/Qwen2.5-1.5B-Instruct
- 训练：LLaMA-Factory LoRA，10 epochs，loss 0.48→0.11
- 导出：`models/qwen1.5b-review-lora-v2.q4_k_m.gguf`
- ollama 名：`qwen2.5-1.5b-review-lora-v2`
- Modelfile：`modelfiles/qwen2.5-1.5b-review-lora-v2.Modelfile`
- 审查策略：混合策略（A/B 规则 + C 模型 + D 规则）
- G25 延迟：~377ms（混合策略，不全走模型）

### 进行中
- T-v3-1677-r32：v3 训练中（1677 条，rank32，loss 0.1168@step450）
- 预计完成：~1h（剩 50 step）
- 计划：训完验 A1/B1 → review-layer 切全模型 → G25 q4 打点

---

## 资源

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.2 | `assets/rvc/nahida_v0.2_20e.pth` | v0.5.2 | 备用（20 轮） |
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力（100 轮） |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.1（待集成） | 10ep ckpt + pth |
| 游戏语音 | `F:/nahida/纳西妲/`（1540 条 .wav+.lab） | — | 训练素材源 |
| 世界观 PDF | `F:/nahida/原神世界观典藏包.zip` | — | worldbook 素材源 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型（Motions 配置 + 10 表情 + 动作映射对齐） |

---

## 已知 / 待办

### 废弃物待清
- [x] `modelfiles/qwen3-8b-nahida.Modelfile`（v1）→ 已删
- [x] `modelfiles/qwen2.5-1.5b-review.Modelfile`（review v1）→ 已删
- [x] `modelfiles/qwen2.5-1.5b-review-lora-v2-q4.Modelfile`（v2 q4 变体）→ 已删
- [x] `data/lora/nahida_training_500.jsonl` / `nahida_training_2000.jsonl`（v1 旧数据）→ 已删
- [x] T-v2 saves 归档 → `docs/train-logs/T-v2-1602-r32/TRAIN_LOG.md`

### 待完成
- [x] v3 训完 → 导出 GGUF → ollama create → review-layer 切 v3（v0.7.3 已完成）
- [x] GPT-SoVITS 集成（v0.7.3 已完成，API 测试通过）
- [x] Live2D 真模型（v0.8.0 已完成，动态穿透已实现）
- [x] 托盘 + 全局快捷键 + 开机自启（v0.8.1 已完成）
- [x] 口型同步（v0.8.2 已完成，通过音频分析驱动 ParamMouthOpenY）
- [x] RVC 独立模块（v0.8.3 已完成，接口预留，待 AI 翻唱需求时实现）
- [x] git 仓库初始化 + 首 commit（已完成，已推送到 GitHub）
- [x] LICENSE + README（已创建）

### 架构债
- [x] IPC 6 通道：rand-error 专用通道已实现（IPCChannel.RAND_ERROR_REPORT）
- [x] cycleLog 已持久化到 session.json（v0.8.3 已完成）
- [x] fact.md 已拆长/中/短（fact-long.md、fact-mid.md、fact-short.md）
- [ ] Rand_error 自主进化（v0.8.2 做，当前有报告生成但无自我学习）

---

# VERSION_SNAPSHOT v0.7.3

> 快照时间：2026-07-13
> 代码版本：v0.7.3（v3 训练完成 → 导出 → ollama create → 代码切模型）
> 状态：历史快照

---

## 代码

- commit: `v0.7.3`（git tag）
- package.json: `0.7.3`
- TS 编译：3/3 零错
- 变更：
  - `config.ts`: `DEFAULT_MODEL_REVIEW` → `qwen2.5-1.5b-review-lora-v3`
  - `review-layer.ts`: 注释更新 v3
  - `export_lora.py`: 路径改为 v3（项目内 `models/qwen1.5b-review-lora-v3`）
  - `modelfiles/qwen2.5-1.5b-review-lora-v3.Modelfile`: FROM 路径对齐项目内

## 训练

### 四审层
- 审查模型：T-v3-1677-r32（1677 条，rank32，loss 0.48→0.1168）
- 基模：Qwen/Qwen2.5-1.5B-Instruct
- 训练目录：`E:/LLaMA-Factory/saves/T-v3-1677-r32/`
- 导出：`E:/Nahida agent/models/qwen1.5b-review-lora-v3/`（HF 格式，3.1GB）
- ollama 名：`qwen2.5-1.5b-review-lora-v3`
- Modelfile：`modelfiles/qwen2.5-1.5b-review-lora-v3.Modelfile`
- 审查策略：混合策略（v3 全模型 + A/B 规则 + D 规则），待 G25 验证

### 废弃
- `qwen2.5-1.5b-review-lora-v2`：已标记 `.deprecated`，观察期至 2026-08-12（1 个月后删除）
- `qwen2.5-1.5b-review-lora-v2-q4`：评估是否保留，暂不标记

## 资源

- TTS: GPT-SoVITS 纳西妲10ep模型（F:/nahida/v4/纳西妲_ZH/），API测试通过，适配器已就绪，参考音频路径已配置，已闭环
- 其他：同 v0.7.0

## 已知 / 待办

- [ ] A 维 smoke test（"作为AI…" → fail:A）
- [ ] G25 延迟打点（v3 F16 实际延迟）
- [ ] v3 训完后的 T-v2 saves 归档到 `docs/train-logs/`

---

# VERSION_SNAPSHOT v0.8.2

> 快照时间：2026-07-14
> 代码版本：v0.8.2（记忆三分 + Rand_error + cycleLog 四段 + 托盘集成）
> 状态：当前版本（v0.8.1 托盘集成已完成）

---

## 代码

- commit: 未初始化 git（待 v1.0 前初始化）
- package.json: `0.8.2`
- TS 编译：3/3 零错（main / preload / renderer）
- 新增模块：
  - 记忆三分 ✅（fact-long / fact-mid / fact-short + shards 适配）
  - Rand_error 自主进化 ✅（rand-error.ts + review-layer fail 路径嵌入）
  - cycleLog 四段 ✅（T/F/Tk/R 显式打点 + handlers R 段追加）
  - 版本管理规范 ✅（versioning.md + VERSION_SNAPSHOT）
  - 托盘 + 全局快捷键 ✅（v0.8.1：tray-manager + shortcuts + autostart）
  - 托盘状态联动 ✅（agent:chat 处理 + perception.alert 报警 → 托盘 busy/online 切换）
- 模块闭环：T1/T4/T5/T6/T7/T8/T9/T10/T11 + P0-1/2/3 + v0.8 骨架

## 训练

### 主模
- 模型：`qwen3-8b-nahida`（ollama 本地）
- 基模：Qwen/Qwen3-8B-Instruct
- 模式：`/nothink`（日常）+ `/think`（深入）
- num_ctx：4096
- Modelfile：`modelfiles/qwen3-8b-nahida-v2.Modelfile`
- 状态：v2 版（v1 已 `.deprecated`）

### 四审层
- 审查模型：T-v2（1602 条，rank32）
- 基模：Qwen/Qwen2.5-1.5B-Instruct
- 导出：`models/qwen1.5b-review-lora-v2.q4_k_m.gguf`
- ollama 名：`qwen2.5-1.5b-review-lora-v2`
- Modelfile：`modelfiles/qwen2.5-1.5b-review-lora-v2.Modelfile`
- 审查策略：混合策略（A/B 规则 + C 模型 + D 规则）

### 进行中
- T-v3-1677-r32：v3 训练中（1677 条，rank32，~450/500 step）
- 预计：训完验 A1/B1 → review-layer 切全模型 → G25 q4 打点 → v0.7.3

## 资源

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.2 | `assets/rvc/nahida_v0.2_20e.pth` | v0.5.2 | 备用（20 轮） |
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力（100 轮） |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.3 | 已闭环（API 测试通过，适配器已集成） |
| 游戏语音 | `F:/nahida/纳西妲/`（1540 条 .wav+.lab） | — | 训练素材源 |
| 世界观 PDF | `F:/nahida/原神世界观典藏包.zip` | — | worldbook 素材源 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型（动态穿透 + 10 表情 + 动作映射对齐） |
| 托盘图标 | `assets/tray/` | v0.8.1 | 3 状态图标（online/offline/busy） |

## 已知 / 待办

### 废弃物待清
- [x] `modelfiles/qwen2.5-1.5b-review-lora-v2-q4.Modelfile` → 已删
- [x] `data/lora/` 旧 v1 数据 → 已删
- [ ] v3 训完后：T-v2 saves 归档 → `docs/train-logs/`

### 待完成（v0.8.x 系列）
- [x] v0.8.0：Live2D 真模型 + 动态穿透
- [x] v0.8.1：托盘 + 全局快捷键(Ctrl+Space) + 开机自启 + 状态联动
- [x] v0.8.2：口型同步（通过 playAudioForViseme 实时音频分析驱动 ParamMouthOpenY）
- [x] v0.8.3：cycleLog 持久化到 session.json（appendHistory 传递 cycleLog → persistMessage）
- [x] v0.8.4：web_fetch source_cred（evaluateSourceCred 评估域名可信度）
- [x] v0.8.5：QQ/微信/邮箱 MCP 框架 + 日历 tool（calendar_create/query/list）+ 闹钟 tool（alarm_set/list/cancel）
- [x] v0.8.6：E2E smoke（整链路真 LLM）—— 6 个测试用例（thinking 前缀泄漏/动作括号/情绪标签/工具调用回路/cycleLog 完整性/session 持久化恢复），TS 编译 0 错误

### 待完成（v0.9.x 系列）
- [x] v0.9.0：记忆向量化（Qwen3-Embed-0.6B + cosine 替 keyword）—— embedding.ts + vector-store.ts + vector-recall.ts，支持混合召回（关键词优先+向量补充），TS 编译 0 错误
- [x] v0.9.1：Gun 双审雏形（think/plan 档开）—— review-layer.ts 增加 checkCoTStructure 方法，think 档启用两轮审查（标准 A+B+C + CoT 结构专项检查），TS 编译 0 错误
- [x] v0.9.2：tool 扩 5（search/translate/weather/file_read/file_write）—— builtin.ts 新增 5 个工具定义，registerBuiltinTools 注册 7 个工具（clock/web_fetch/search/translate/weather/file_read/file_write），TS 编译 0 错误
- [x] v0.9.3：多 API 动态择模 —— model-selector.ts 实现多端点管理、优先级路由、健康检查与熔断机制，支持 ollama + DeepSeek 云端双端点，TS 编译 0 错误
- [x] v0.9.4：本地化集成 —— 移除外部依赖，集成 node-llama-cpp + 嵌入式 Python + GPT-SoVITS/RVC 本地服务管理，resources/ 目录统一管理模型资源，TS 编译 0 错误

### 架构债
- [x] IPC 6 通道：rand-error 专用通道已实现（IPCChannel.RAND_ERROR_REPORT + handlers.ts IPC 推送）
- [x] cycleLog 持久化到 session.json（v0.8.3 已完成）
- [x] git 已初始化（待首 commit）
- [x] LICENSE + README 已创建

### 安全修复（2026-07-15）
- [x] SSRF 防护增强：修复 IPv6 回环/ULA/link-local、0.0.0.0/8、CGNAT 100.64.0.0/10 绕过漏洞
- [x] 熔断机制修复：review-layer.ts 熔断触发后允许重试，避免永久锁定
- [x] 测试覆盖补充：
  - [x] builtin-ssrf.test.ts：10 个 SSRF 防护边界测试用例
  - session-store.test.ts：并发竞态测试（10 并发 × 100 消息）
  - guardrails.test.ts：3 个 JSON 修复边界测试用例

---

# VERSION_SNAPSHOT v0.9.4

> 快照时间：2026-07-15
> 代码版本：v0.9.4（本地化集成 —— node-llama-cpp + Python 环境管理 + GPT-SoVITS/RVC 本地服务）
> 状态：当前版本

---

## 代码

- commit: `0ab1018`
- package.json: `0.9.4`
- TS 编译：3/3 零错（main / preload / renderer）
- 新增模块：
  - node-llama-cpp 集成 ✅（local-llm.ts：直接加载 GGUF 模型，支持 GPU 加速，模型路径可配置）
  - Python 环境管理 ✅（python-manager.ts：嵌入式 Python + 系统 Python 自动检测，服务启动管理）
  - stream-sanitizer.ts ✅（流式输出清洗，剥离 `<think>` / `[emotion:xxx]` / `<tool_call>` 内部标签）
  - resources/ 目录 ✅（统一管理本地模型和运行时资源：ollama/models、python、gpt-sovits）
- 变更：
  - config.ts：添加 useLocalLLM、localModelPath 配置项
  - agent-core.ts：集成 sanitizeOutput 清洗逻辑
  - handlers.ts：流式回调中集成 sanitizeOutput
  - gpt-sovits-adapter.ts / rvc-bridge.ts：使用 python-manager 管理服务

## 训练

### 主模
- 模型：`qwen3-8b-nahida`（ollama 本地）或 node-llama-cpp 直接加载 GGUF
- 基模：Qwen/Qwen3-8B-Instruct
- 模式：`/nothink`（日常）+ `/think`（深入）
- num_ctx：4096
- Modelfile：`modelfiles/qwen3-8b-nahida-v2.Modelfile`

### 四审层
- 审查模型：T-v3-1677-r32（1677 条，rank32）
- 基模：Qwen/Qwen2.5-1.5B-Instruct
- ollama 名：`qwen2.5-1.5b-review-lora-v3`
- T-v2 归档：`docs/train-logs/T-v2-1602-r32/TRAIN_LOG.md`

## 资源

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力 |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.1 | 已闭环 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型 |
| GGUF 模型（可选） | `resources/ollama/models/` | v0.9.4 | 待下载 |
| 嵌入式 Python（可选） | `resources/python/` | v0.9.4 | 待配置 |

## 已知 / 待办

### 待完成（v1.0.0 前）
- [ ] v1.0.0：Phase 1 完整闭环（代码+训练+导出+ollama+资源五合一快照）
- [ ] 口型同步优化（rhubarb 集成）
- [ ] RVC 独立模块集成测试

### 废弃物待清
- [ ] `modelfiles/qwen2.5-1.5b-review-lora-v2.Modelfile` → `.deprecated` 观察期已过，待删除

---

# VERSION_SNAPSHOT v0.9.5

> 快照时间：2026-07-15
> 代码版本：v0.9.5（UI 4 项修复 —— Live2D 循环动作 + 眼神跟随 + 主窗口置顶 + Cherry Studio 布局）
> 状态：当前版本

---

## 代码

- commit: 待提交
- package.json: `0.9.5`
- TS 编译：3/3 零错（main / preload / renderer）
- 本版变更（4 项 UI 修复）：

### 1. Live2D 循环动作 bug
- **症状**：模型一直循环播放同一组动作（"像在祷告"）
- **根因**：`playMotion()` 每次都 `model.on('motionFinish', ...)` 注册监听器，多次调用导致同 priority 动作完成时 `currentPriority` 被反复重置成 0，下一帧又触发同 priority 的 motion，陷入循环
- **修法**（[manager.ts](file:///e:/Nahida%20agent/src/renderer/live2d/manager.ts#L222-L241)）：
  - 加 `motionFinishBound` 标志位
  - 全局只注册一次 `motionFinish` 监听器
  - 失败 motion 退到 Idle 时不重置优先级，避免循环

### 2. 眼神跟随鼠标
- **症状**：模型没有眼神跟随鼠标
- **根因**：v0.9.4 没实现鼠标→头部参数映射
- **修法**（[manager.ts](file:///e:/Nahida%20agent/src/renderer/live2d/manager.ts#L243-L291) + [live2d.tsx](file:///e:/Nahida%20agent/src/renderer/live2d/live2d.tsx#L62-L66)）：
  - 新增 `updateMousePosition(domX, domY, w, h)`：归一化鼠标位置
  - 新增 `tickHeadFollow()`：每帧用低通滤波把鼠标位置映射到 `ParamAngleX` / `ParamAngleY`
  - PIXI ticker 调度：每帧调用 `tickHeadFollow`
  - 平滑系数 0.18（柔顺不抖动）
  - 头部最大幅度 0.3 弧度（~17°）

### 3. 主窗口被遮盖
- **症状**：主窗口难以呼出到最前台，被 Live2D 一直置顶遮盖
- **修法**（[windows/manager.ts](file:///e:/Nahida%20agent/src/main/windows/manager.ts#L64-L109)）：
  - `ready-to-show` 时 `win.show() + focus() + moveTop()`
  - 5s 兜底：若还不可见，强制 `show() + focus() + moveTop()`
  - `focus` 事件：`win.moveTop()`（主动切到主窗口时抢回最顶层）
  - 加载失败诊断：`did-fail-load` / `render-process-gone` / `preload-error` 日志

### 4. Cherry Studio 风格布局
- **症状**：原单栏布局，按钮小，不够现代
- **修法**（新建 [Sidebar.tsx](file:///e:/Nahida%20agent/src/renderer/main/Sidebar.tsx) + 重构 [ChatPanel.tsx](file:///e:/Nahida%20agent/src/renderer/main/ChatPanel.tsx)）：
  - **左 60px 折叠 / 220px 展开** 侧边栏：人格切换 + 新对话 + /stats + 历史占位（v0.9.5 占位）
  - 主区：标题栏 + 消息列表 + StatusBar + 输入栏
  - 视觉：草绿渐变 + 圆角 + 阴影 + 玻璃拟态标题栏（backdrop-filter blur）
  - 字体：系统字体栈 + PingFang SC

### 5. 配套改动
- [preload/index.ts](file:///e:/Nahida%20agent/src/preload/index.ts)：加 `[Preload] loaded/exposed` 启动日志
- [main.tsx](file:///e:/Nahida%20agent/src/renderer/main/main.tsx)：加 [ErrorBoundary.tsx](file:///e:/Nahida%20agent/src/renderer/main/ErrorBoundary.tsx) 包裹 App，避免组件错误炸白屏

## 训练 / 资源

- 同 v0.9.4（无变更）

## 已知 / 待办

### 已完成（v1.0.0）
- [x] Heartjump.md 心动机制（detectHeartjump + 特殊 Live2D 动作"藤蔓绕腕"）
- [x] Rand_error >50 自动抛出（rand-error.ts 独立计数器 + memory/rand_error.md 自动生成报告）
- [x] Live2D isInteractive 兼容（mock 修复 PixiJS 7.x 报错）

---

# VERSION_SNAPSHOT v1.0.0

> 快照时间：2026-07-15
> 代码版本：v1.0.0（正式发布里程碑）
> 状态：当前版本

---

## 代码

- commit: `e3a3c25`（GitHub main）
- package.json: `1.0.0`
- TS 编译：3/3 零错（main / preload / renderer）
- 本版里程碑：Token 统计 + /stats 面板 + 缺陷修复 + 测试覆盖

### 核心变更

#### 1. Token 统计模块（token-usage.ts）
- 近似估算：`promptTokens ≈ 输入字符/4`，`completionTokens ≈ 输出字符/4`
- 按日聚合：每天一个统计单元，保留最近 30 天
- 持久化：`memory/token-usage.json`
- 模型区分：统计每个模型的调用量和占比
- IPC 通道：`stats:get` / `stats:get-chart`
- 对应文件：`src/main/agent/token-usage.ts`

#### 2. /stats 面板集成
- 渲染层调用真实统计数据
- 显示：累计 token / 总对话 / 7天趋势 / 模型分布
- 对应文件：`src/renderer/main/ChatPanel.tsx`

#### 3. 缺陷修复（1 P0 + 4 P1）
- **P0 熔断机制失效**：review-layer.ts 原每次触发都重置计数器，改为 30s 冷却期后自动恢复
- **P1 并发写入数据丢失**：session-store.ts debounce 和 mutex 解耦，`storeMutex` 串行化写入
- **P1 模型重复加载**：local-llm.ts 加 `loadingPromise` 锁，防止并发请求同时通过检查
- **P1 僵尸进程泄漏**：python-manager.ts 用 `runningServices` 进程表管理，退出时清理
- **P1 路径遍历攻击**：builtin.ts 白名单校验，只允许项目目录内访问

#### 4. 测试覆盖（38 个测试用例）
- `model-selector.test.ts`：熔断器 + 路由策略测试
- `personality-manager.test.ts`：人格分片加载测试
- `vector-store.test.ts`：向量召回 + 混合召回测试
- `embedding.test.ts`：嵌入向量生成测试

### 已完成功能清单
- ✅ 日常对话 + 意图检测 + 三重路由
- ✅ 四审机制（A-OOC / B-括号 / C-emotion / D-tool）
- ✅ 记忆系统（9 分片 + worldbook + 长中短三级）
- ✅ Live2D 表现 + TTS（GPT-SoVITS）
- ✅ 崩溃自愈 + 离线降级链 + 隐私沙箱
- ✅ 设置界面 + 反馈界面
- ✅ 时间感与数字衰老（maturity 参数）
- ✅ Token 统计 + /stats 面板
- ✅ Heartjump 心动机制 + Rand_error 自动抛出

## 训练

### 主模
- 模型：`qwen3-8b-nahida`（ollama 本地）
- 基模：Qwen/Qwen3-8B-Instruct
- 模式：`/no_think`（日常）+ `/think`（深入）
- num_ctx：4096
- Modelfile：`modelfiles/qwen3-8b-nahida-v2.Modelfile`

### 四审层
- 审查模型：T-v3-1677-r32（1677 条，rank32）
- 基模：Qwen/Qwen2.5-1.5B-Instruct
- ollama 名：`qwen2.5-1.5b-review-lora-v3`
- T-v2 归档：`docs/train-logs/T-v2-1602-r32/TRAIN_LOG.md`

## 资源

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力 |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.1 | 已闭环 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型 |

## 已知 / 待办

### v1.x 规划
- [ ] v1.1：日历/闹钟/定时任务 + QQ/微信/邮箱 MCP 接入
- [ ] v1.2：搜索置信度（source_cred 小审）+ web_fetch 可信度打分
- [ ] v1.3：遗忘机制 + 梦境模式 + 元认知表达
- [ ] v1.4：时间感与数字衰老增强 + 纪念日感知
- [ ] v1.5：人格分叉 A/B 测试 + 插件系统雏形
- [ ] v1.6：多设备同步 + 一键重置

### v2.0 远期
- [ ] Siri 式语音唤醒（Whisper.cpp STT）
- [ ] 社区共享协议
- [ ] 六顶帽并行思考
- [ ] 生视频 + 歌曲翻唱 + 全模态闭环

---

> **v1.0.0 封板说明**：Phase 1 已完成全部核心功能，代码 + 训练 + 资源三合一，可交付用户使用。后续 v1.x 系列进入生活肢体与灵魂三维深化阶段。
