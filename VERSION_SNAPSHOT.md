# VERSION_SNAPSHOT v3.0.0

> 快照时间：2026-07-20
> 代码版本：v3.0.0（视觉感知 Phase 1 闭环 —— 能看、看得清、看动态、主动观察）
> 状态：当前版本

---

## 代码

- commit: 待提交
- package.json: `3.0.0`
- TS 编译：3/3 零错（main / preload / renderer）
- 本版里程碑：视觉感知 Phase 1 闭环

### 核心变更（v2.5 - v3.0）

#### 1. 视觉主通路（v2.5）
- 文件：`src/main/vision/vision-manager.ts`
- 多模态对话：图片 → vision 模型 → 文本描述
- 可选 OCR：Tesseract.js 本地识别
- 图片持久化：`data/media/` 目录存储
- IPC 通道：`vision:analyze` / `vision:ocr`

#### 2. 渲染层上传 UI（v2.6）
- 文件：`src/renderer/main/InputBar.tsx` / `MessageBubble.tsx` / `ChatPanel.tsx`
- 三种上传方式：文件选择、剪贴板粘贴、拖拽
- 缩略图展示 + 点击全屏预览
- 支持批量上传，自动去重

#### 3. OCR 实装（v2.7 - v2.10）
- **v2.7**：Tesseract.js 实装，`chi_sim+eng` 语言
- **v2.7.1**：PNG 灰度化预处理（BT.601 加权平均）
- **v2.10**：OCR 后处理管线（基础清洗→常见错误修正→空格规范化→标点转换→结构分析）
- 置信度分级：high (≥85) / medium (60-84) / low (<60)

#### 4. 截图能力（v2.8 - v2.11）
- **v2.8**：全屏截图（desktopCapturer）
- **v2.9**：区域截图（选区覆盖窗口 + 纯 JS/CSS UI）
- **v2.11**：多屏截图（每屏独立覆盖窗口，防竞态）
- 文件：`src/main/vision/capture-overlay.ts` / `src/renderer/capture-overlay/`
- `/screenshot` 命令支持 full / region / multi / 自定义提问

#### 5. 视频帧抽取与分析（v2.12 - v2.15）
- **v2.12**：`src/main/vision/video-frame.ts`，检测系统 ffmpeg，支持 8 种格式
- 智能抽帧：≤30s→3帧 / 30-300s→6帧 / >300s→10帧
- 时间点均匀分布，跳过片头片尾
- 可选 OCR + 时间戳标注
- `/video` 命令 + `video:upload` / `video:result` IPC

#### 6. 屏幕实时监控（v2.16 - v2.19）
- **v2.16**：`src/main/vision/screen-monitor.ts`，定时截图 + 64x64 缩略图帧差检测
- 默认 2 秒间隔，5% 帧差阈值，5 秒分析冷却
- `monitor:start` / `monitor:stop` / `monitor:state` / `monitor:frame-diff` IPC
- **v2.18**：窗口白名单/黑名单过滤（PowerShell 取活动窗口标题）
- **v2.19**：配置持久化到 config.json + 修复递归启动 bug

#### 7. OCR 增强（v2.14 - v2.19）
- **v2.14**：行级置信度（Tesseract lines 数据）
- **v2.17**：低置信度行二次识别（裁剪+放大+PSM 7 单行模式）
  - 文件：`src/main/vision/ocr-rerecognize.ts`
  - 最多 5 行，宁漏勿错（只在置信度更高时替换）
- **v2.18**：多语言自动检测（Unicode 范围统计）
  - 文件：`src/main/vision/ocr-language-detect.ts`
  - 支持：中文简/繁、英文、日文、韩文
  - 零依赖，`hintToLanguage()` 预检测
- **v2.19**：二次识别并行优化（Promise.all + 采纳策略改进）

#### 8. 缓存与 UI 反馈（v2.20）
- **LRU 缓存**：`src/main/vision/vision-cache.ts`
  - key = MD5(base64) + MD5(prompt)
  - 默认 50 条，TTL 5 分钟
  - `initVisionCache()` / `getVisionCache()` / `setVisionCache()` / `clearVisionCache()`
- **UI 标签**：语言标签 / 缓存标签 / 二次识别改进标签
- `VisionAnalysisResult` 扩展：ocrRerecognize / ocrLanguage / fromCache

### 视觉模块文件清单（v2.5 - v3.0）

| 文件 | 版本 | 职责 |
|------|------|------|
| `src/main/vision/vision-manager.ts` | v2.5+ | 视觉主管理器（分析/OCR/缓存/监控集成） |
| `src/main/vision/ocr-postprocess.ts` | v2.10+ | OCR 后处理（清洗/置信度/结构分析） |
| `src/main/vision/ocr-rerecognize.ts` | v2.17+ | 低置信度行二次识别（裁剪+放大+PSM 7） |
| `src/main/vision/ocr-language-detect.ts` | v2.18+ | 多语言自动检测（Unicode 范围） |
| `src/main/vision/vision-cache.ts` | v2.20+ | LRU 缓存（MD5 key + TTL） |
| `src/main/vision/screen-monitor.ts` | v2.16+ | 屏幕实时监控（帧差检测 + 窗口过滤） |
| `src/main/vision/capture-overlay.ts` | v2.9+ | 区域截图覆盖窗口管理 |
| `src/main/vision/video-frame.ts` | v2.12+ | 视频帧抽取（ffmpeg） |
| `src/renderer/capture-overlay/index.html` | v2.9+ | 选区 UI（纯 JS/CSS） |

### 已完成功能清单（新增 v2.5 - v3.0）

- ✅ 多模态对话（图片 + 文本）（v2.5）
- ✅ 图片上传 UI（文件/剪贴板/拖拽）（v2.6）
- ✅ OCR 文字识别（Tesseract.js）（v2.7）
- ✅ PNG 灰度化预处理（v2.7.1）
- ✅ 全屏截图（v2.8）
- ✅ 区域截图（选区 UI）（v2.9）
- ✅ OCR 后处理（五阶段清洗 + 结构分析）（v2.10）
- ✅ 多屏截图（v2.11）
- ✅ 视频帧抽取与分析（v2.12 - v2.15）
- ✅ 屏幕实时监控（帧差检测 + 自动分析）（v2.16）
- ✅ OCR 行级置信度（v2.14）
- ✅ 低置信度行二次识别（v2.17）
- ✅ OCR 多语言自动切换（v2.18）
- ✅ 监控规则持久化 + 窗口过滤（v2.18 - v2.19）
- ✅ 二次识别并行优化（v2.19）
- ✅ LRU 缓存 + UI 标签增强（v2.20）

### 历史功能清单（v1.x + v2.0 - v2.4）

- ✅ 日常对话 + 意图检测 + 三重路由
- ✅ 四审机制（A-OOC / B-括号 / C-emotion / D-tool）
- ✅ 记忆系统（9 分片 + worldbook）
- ✅ Live2D 表现 + TTS（GPT-SoVITS）
- ✅ 崩溃自愈 + 离线降级链 + 隐私沙箱
- ✅ 设置界面 + 反馈界面
- ✅ 时间感与数字衰老（maturity 参数）
- ✅ Token 统计 + /stats 面板
- ✅ Heartjump 心动机制 + Rand_error 自动抛出
- ✅ 日历提醒（v1.1）
- ✅ 闹钟调度（v1.1）
- ✅ MCP Client 框架（v1.1）
- ✅ 灵魂三维（遗忘/梦境/元认知）（v1.3）
- ✅ 纪念日感知 + RAG 三阶段检索（v1.4）
- ✅ 六顶帽多 Agent 协作（v1.5）
- ✅ 知识图谱 + 一键重置 + 指令层级增强（v1.6）
- ✅ 人格分叉 A/B 测试 + 插件系统雏形（v1.7）
- ✅ 语音输入 STT + 对话导出 + 全局快捷键（v1.8）
- ✅ 桌面整理 + 文件搜索 + 番茄钟专注模式（v1.9）
- ✅ 社区共享协议 + 生图工具（v2.0）
- ✅ 生视频工具（v2.1）
- ✅ 歌曲翻唱（RVC 实装）（v2.2）
- ✅ Siri 式语音唤醒（Whisper.cpp STT）（v2.3）
- ✅ 群聊模块（多 Agent 群聊 + token 限制 + Agent 管理）（v2.4）

## 训练（同 v2.4.0）

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

## 资源（同 v2.4.0）

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力 |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.1 | 已闭环 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型 |

## 视觉感知 Phase 1 闭环说明

### 能力分层

```
主动观察 ── 屏幕实时监控（v2.16）
   │
   ├─ 窗口过滤（v2.18）
   ├─ 规则持久化（v2.19）
   └─ LRU 缓存（v2.20）

看动态内容 ── 视频帧抽取（v2.12）
   │
   ├─ 智能抽帧（按时长动态调整）
   ├─ 多图 vision 分析
   └─ 可选 OCR + 时间戳

主动截图 ── 全屏/区域/多屏（v2.8-v2.11）
   │
   ├─ 全屏截图（desktopCapturer）
   ├─ 区域截图（选区 UI）
   └─ 多屏截图（独立覆盖窗口）

被动接收 ── 图片上传 + vision 分析（v2.5-v2.6）
   │
   ├─ 文件选择 / 剪贴板 / 拖拽
   └─ 缩略图 + 全屏预览

OCR 增强链
   ├─ 灰度化预处理（v2.7.1）
   ├─ 后处理五阶段（v2.10）
   ├─ 行级置信度（v2.14）
   ├─ 低置信度二次识别（v2.17）
   ├─ 多语言自动切换（v2.18）
   └─ 并行优化（v2.19）
```

### 设计原则

1. **宁漏勿错**：OCR 后处理、二次识别、语言检测均遵循此原则
2. **无额外依赖**：截图（Electron API）、视频（系统 ffmpeg）、OCR（Tesseract.js 已有）、缓存（内置 crypto）
3. **渐进增强**：从被动到主动、从静态到动态、从单语言到多语言
4. **资源自动清理**：截图/视频帧 TTL 过期清理，不占磁盘
5. **类型安全**：TS strict 模式，3/3 零错

### Phase 2 规划（v3.1 - v3.x）

- [ ] v3.1：监控规则可视化配置（设置界面）
- [ ] v3.2：低置信度行用户可手动修正（反馈闭环）
- [ ] v3.3：屏幕区域监控（只监控指定区域，而非全屏）
- [ ] v3.4：OCR 表格识别（结构化输出）
- [ ] v3.5：视觉记忆（重要画面自动存入记忆分片）

---

> **v3.0.0 封板说明**：视觉感知 Phase 1 完整闭环——从被动接收图片，到主动截图、看视频、监控屏幕变化，OCR 从基础识别到灰度化、后处理、置信度、二次识别、多语言切换，全链路打通。下一步进入 Phase 2，做精细化增强。
