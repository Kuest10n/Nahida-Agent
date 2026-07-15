# 纳西妲 Agent

> 基于 Electron + TypeScript 的桌面端 AI 助手，以《原神》角色纳西妲为人设原型，集成 Live2D 动态形象、多模型路由、四审层质量保障、TTS 语音合成等能力。

## 项目特性

### 核心能力
- **三重模型路由**：本地（Qwen3-8B）→ 云端标准（DeepSeek V4pro）→ 云端快速（DeepSeek Flash），基于消息复杂度自动择模
- **四审层质量保障**：意图审查（A）+ 输出审查（B）+ 情绪审查（C）+ 工具调用审查（D），确保人设一致性
- **Live2D 动态形象**：Cubism 4.0 模型 + 透明漂浮窗 + 动作映射 + 口型同步
- **TTS 语音合成**：GPT-SoVITS 纳西妲专属音色 + edge-tts 备用 + RVC AI 翻唱
- **记忆系统**：9 分片结构（SOHA/User/fact/worldbook/persona/emotion/skill/reflect/interest）+ 向量召回
- **工具调用**：7 个内置工具（clock/web_fetch/search/translate/weather/file_read/file_write）+ MCP 扩展
- **多 API 动态择模**：支持 ollama 本地 + DeepSeek 云端双端点，优先级路由 + 健康检查 + 熔断机制
- **托盘集成**：系统托盘图标 + 全局快捷键（Ctrl+Space）+ 开机自启 + 状态联动

### 人设保障
- **SOHA.md 人格核心**：温柔 + 苏格拉底反问 + 自然隐喻，禁止"作为 AI"等助手腔
- **动作括号收尾**：所有输出末句必须带 `（铃铛轻响）` 等动作 tag，供 Live2D 正则抽取
- **正反例 Appendix**：SOHA.md 尾部附带 15 对助手腔❌ vs 纳西妲腔✅ 对比示例
- **Gun 双审机制**：think 档位启用两轮审查（标准 A+B+C + CoT 结构专项检查）

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron 28+ | 主进程 + preload + 渲染层三层分离 |
| 开发语言 | TypeScript 5.x (strict) | 禁止 any，zod 校验 IPC 数据 |
| 渲染引擎 | PixiJS 7.x + pixi-live2d-display | Live2D Cubism 4.0 模型渲染 |
| 模型推理 | Ollama | Qwen3-8B（主模）+ Qwen2.5-1.5B（审查） |
| 云端 API | DeepSeek V4pro | 标准/快速双档位 |
| 语音合成 | GPT-SoVITS + edge-tts | 纳西妲专属音色 + CPU 备用 |
| 记忆存储 | SQLite + vec 扩展 | 向量召回 + 关键词召回混合 |
| 构建工具 | Vite 5.x | 多入口配置（主聊天窗 + Live2D 窗） |

## 项目结构

```
e:\Nahida agent\
├── src/
│   ├── main/              # 主进程
│   │   ├── agent/         # Agent 编排（agent-core + review-layer + model-selector）
│   │   ├── config/        # 配置系统（config.ts）
│   │   ├── ipc/           # IPC 处理（handlers.ts）
│   │   ├── memory/        # 记忆系统（session-store + embedding + vector-store + personality-manager）
│   │   ├── mcp/           # MCP 框架（email/qq/wechat server）
│   │   ├── perception/    # 感知层（scanner + hardware + alert）
│   │   ├── router/        # 路由层（router + degrade-strategy）
│   │   ├── safety/        # 安全层（instruction-guard + guardrails）
│   │   ├── tools/         # 工具注册（builtin + registry + calendar + alarm）
│   │   ├── tray/          # 托盘管理（tray-manager）
│   │   └── tts/           # TTS 调度（gpt-sovits-adapter + edge-tts-adapter + scheduler）
│   ├── preload/           # preload 脚本（contextBridge 暴露 IPC）
│   ├── renderer/          # 渲染层
│   │   ├── live2d/        # Live2D 渲染（manager + action-map）
│   │   └── main/          # 主聊天界面（ChatPanel）
│   └── shared/            # 共享类型（ipc-channels + emotion）
├── assets/                # 资源文件
│   ├── models/nahida/     # Live2D 模型
│   ├── tray/              # 托盘图标（3 状态）
│   └── rvc/               # RVC 模型（AI 翻唱）
├── memory/                # 记忆分片（9 文件 + personalities）
├── modelfiles/            # Ollama Modelfile
├── tests/                 # 测试用例
└── .trae/rules/           # Trae 规则（agent-main + renderer + skills + versioning）
```

## 快速开始

### 环境要求
- Node.js 18+
- Ollama（本地模型推理）
- Python 3.10+（GPT-SoVITS TTS，可选）
- Git LFS（Live2D 模型文件）

### 安装步骤

1. **克隆仓库**
```bash
git clone <your-repo-url>
cd "Nahida agent"
```

2. **安装依赖**
```bash
npm install
```

3. **下载 Live2D 模型**
```bash
# 模型文件较大，需单独下载或使用 Git LFS
git lfs pull
```

4. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 配置 ollama 地址、API key 等
```

5. **启动 Ollama 服务**
```bash
ollama serve
# 拉取模型
ollama pull qwen3-8b-nahida
ollama pull qwen2.5-1.5b-review-lora-v3
```

6. **启动 GPT-SoVITS（可选）**
```bash
# 参考 F:/nahida/v4/纳西妲_ZH/ 下的部署说明
python api_v2.py -p 9880
```

7. **启动开发服务器**
```bash
npm run dev
```

## 核心命令

| 命令 | 说明 |
|------|------|
| `/clear` | 清空当前会话历史 |
| `/help` | 显示帮助信息 |
| `/switch-model` | 切换模型档位（local/standard/flash） |
| `/stats` | 显示 Token 统计 + 延迟打点 |
| `/switch-persona <name>` | 切换人格（nahida / ti-bao） |

## 版本管理

项目遵循语义化版本规范（SemVer），详见 [VERSION_SNAPSHOT.md](./VERSION_SNAPSHOT.md)。

- **主版本号**：架构变更 / 不兼容改动
- **次版本号**：新功能模块 / 新能力
- **修订号**：优化/修复/清理

当前版本：v0.9.3（v0.9.x 系列）

## 开发规范

### TypeScript
- strict 模式，禁止 `any`
- IPC 数据用 zod 校验
- 主进程/渲染层/preload 三层分离

### 人设红线
- 禁止输出"作为 AI"/"我是人工智能"
- 所有输出末句必须带动作括号 `（xxx）`
- 正反例对照 SOHA.md Appendix

### 工具注册
- 每个 tool 必须 `name | description | parameters (zod) | execute()`
- description 写中文
- 禁止游戏代肝、模拟输入

## 已知问题

- Live2D 口型同步：通过实时音频分析驱动 ParamMouthOpenY，精度有限（后续可集成 rhubarb 优化）

## 待办事项

- [ ] Live2D 口型同步优化（rhubarb 集成）
- [ ] RVC 独立模块集成测试（AI 翻唱场景）
- [ ] 记忆向量化模型自动下载（Qwen3-Embed-0.6B）

## 许可证

MIT License - 详见 [LICENSE](./LICENSE)

## 相关链接

- [原神 - 纳西妲](https://genshin.hoyoverse.com/zh-cn/character/liyue?char=18)
- [Ollama](https://ollama.com/)
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)

---

**免责声明**：本项目为个人学习项目，与米哈游/HoYoverse 官方无关。纳西妲为《原神》游戏角色，版权归米哈游所有。
