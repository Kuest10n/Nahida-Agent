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

### 待完成
- [x] v3 训完 → 导出 GGUF → ollama create → review-layer 切 v3（v0.7.3 已完成）
- [x] GPT-SoVITS 集成（v0.7.3 已完成，API 测试通过）
- [x] Live2D 真模型（v0.8.0 已完成，动态穿透已实现）
- [x] 托盘 + 全局快捷键 + 开机自启（v0.8.1 已完成）
- [ ] rhubarb 口型同步（v0.8.2 待实现）
- [ ] RVC 独立模块集成测试（v0.8.3 待实现）
- [ ] git 仓库初始化 + 首 commit
- [ ] LICENSE + README

### 架构债
- [ ] IPC 6 通道：rand-error 想推送但没通道（暂用 console.warn）
- [ ] cycleLog 未持久化到 session.json（只活在返回值里）
- [ ] fact.md 未拆长/中/短（v0.8.2 做）
- [ ] Rand_error 自主进化（v0.8.2 做）

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

### 架构债
- [ ] IPC 6 通道：rand-error 无专用通道（暂用 console.warn）
- [x] cycleLog 持久化到 session.json（v0.8.3 已完成）
- [x] git 已初始化（待首 commit）
- [x] LICENSE + README 已创建
