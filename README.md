# 纳西妲 Agent

> 基于 Electron + Ollama 的本地角色 AI 桌面伴侣，须弥草神纳西妲人设，支持 Live2D、TTS、游戏感知和自主进化。

---

## 项目定位

一个跑在你桌面上的纳西妲——不是聊天机器人，是会记得你在做什么、会主动开口、会从错误里学习的草神。

- **本地优先**：主模型 Qwen3-8B 跑在本地 Ollama，四审层 Qwen2.5-1.5B LoRA，数据不云端
- **人设稳定**：SOHA 9 分片记忆 + 四审 Lora 审查（OOC / 括号 / 情绪 / 工具），避免助手腔
- **陪伴感**：Live2D 透明漂浮窗 + GPT-SoVITS 纳西妲音色 + 游戏/硬件主动开口
- **自主进化**：Rand_error 机制（同类型错 >50 自动抛报告）+ cycleLog 四段追踪

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 主进程 | Electron + TypeScript strict | Agent 编排、模型路由、工具注册 |
| 渲染层 | React + Vite + PixiJS 7 | 聊天界面 + Live2D 渲染 |
| 大模型 | Ollama + Qwen3-8B + Qwen2.5-1.5B LoRA | 本地推理，四层审查 |
| TTS | GPT-SoVITS（纳西妲音色）+ edge-tts（备选） | 语音合成 + RVC 桥接 |
| 记忆 | 9 分片 + worldbook + session 持久化 | 长中短三层时序 |
| 感知 | systeminformation + 进程扫描 | 游戏识别 + 硬件监控 + 主动开口 |

---

## 快速开始

### 前置依赖

- Node.js >= 18
- Ollama（本地模型服务）
  - `qwen3:8b`（主模型）
  - `qwen2.5-1.5b-review-lora-v2`（四审模型，v3 训练中）
- Python 3.10+（TTS / 训练相关）

### 安装

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build
```

### 配置

复制 `.env.example` 为 `.env`，按需修改：

```bash
cp .env.example .env
```

---

## 项目结构

```
nahida-agent/
├── src/
│   ├── main/           # 主进程（Agent 编排 + 模型路由 + 记忆）
│   ├── preload/        # preload（contextBridge 暴露 API）
│   ├── renderer/       # 渲染层（React + PixiJS + Live2D）
│   └── shared/         # 共享类型 + IPC schema
├── memory/             # 记忆分片（SOHA / User / fact / worldbook 等）
├── modelfiles/         # Ollama Modelfile
├── assets/             # 资源（RVC 模型 / 参考音频 / Live2D）
├── data/               # 运行时数据（session / 缓存）
├── .trae/rules/        # Trae 项目规则
├── VISIONLOG.md        # 版本演进日志
├── VERSION_SNAPSHOT.md # 版本快照（代码+训练+资源五合一）
└── package.json
```

---

## 版本管理

遵循 [版本管理规范](.trae/rules/versioning.md)（VMS v1.0）：

- **代码版本**：`package.json` 唯一真值，语义化版本
- **训练版本**：`T-v{序号}-{数据量}-{rank}` 命名
- **四层绑定**：代码 / 训练 / 导出物 / 资源 版本号对齐
- **快照**：每个中版本出一张 VERSION_SNAPSHOT

当前版本：`v0.8.2`（记忆三分 + Rand_error + cycleLog 四段）

---

## 许可证

MIT License（私有仓库阶段，公开前考虑切换 AGPLv3）
