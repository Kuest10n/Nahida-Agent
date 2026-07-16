# VERSION_SNAPSHOT v2.4.0

> 快照时间：2026-07-16
> 代码版本：v2.4.0（群聊模块 —— 多 Agent 群聊 + token 限制 + Agent 管理）
> 状态：当前版本

---

## 代码

- commit: 待提交
- package.json: `2.4.0`
- TS 编译：3/3 零错（main / preload / renderer）
- 本版里程碑：群聊模块上线

### 核心变更

#### 1. 群聊核心模块（group-chat.ts）
- 新建文件：`src/main/agent/group-chat/group-chat.ts`
- `GroupChat` 模型：群信息 + 成员列表 + 消息历史 + token 限制配置
- `AgentMember` 模型：成员类型（user/ai）+ 人格 ID + token 限制
- 持久化：`data/groups/{groupId}.json`，原子写（.tmp → rename）
- 消息存储上限：100 条，自动滚动

#### 2. 群管理功能
- `createGroup()`：创建群聊，支持初始 AI 成员
- `addAgent()` / `removeAgent()`：添加/移除 AI 成员
- `setTokenLimit()`：设置默认或单个成员的 token 限制
- `listGroups()` / `getGroup()` / `deleteGroup()`：群列表与详情

#### 3. 消息广播机制
- `broadcastMessage()`：用户消息广播到所有 AI 成员
- 并行调用各 AI 成员的人格模型生成回复
- 支持降级策略（degradeDecision）

#### 4. Token 限制策略
- 提示词方式：在消息中注入「请将回复限制在 X token 内」
- 后端截断：超过限制时自动截断并添加省略号
- 默认限制：50 token，可自定义

#### 5. 命令接口（/group 子命令）
- `/group create <群名> [成员1,成员2]`：创建群聊
- `/group list`：列出所有群聊
- `/group info <群ID>`：查看群详情
- `/group delete <群ID>`：删除群聊
- `/group add <群ID> <人格ID>`：添加 Agent
- `/group remove <群ID> <成员ID>`：移除 Agent
- `/group token <群ID> [成员ID] <token数>`：设置 token 限制
- `/group send <群ID> <消息>`：发送消息到群聊
- `/group agents`：查看可用人格列表

#### 6. 路由与 IPC 集成
- `router.ts`：添加 `/group` 命令到 CommandType 和 COMMAND_PATTERNS
- `handlers.ts`：添加 `/group` 命令处理逻辑
- `index.ts`：集成 `initGroupChat()`

### 已完成功能清单（v2.3.0 + v2.4.0）
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

## 训练（同 v2.3.0）

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

## 资源（同 v2.3.0）

| 资源 | 路径 | 绑代码版本 | 状态 |
|---|---|---|---|
| RVC v0.3 | `assets/rvc/nahida_v0.3_100e.pth` | v0.5.2 | 主力 |
| GPT-SoVITS | `F:/nahida/v4/纳西妲_ZH/` | v0.7.1 | 已闭环 |
| Live2D | `assets/models/nahida/Nahida.model3.json` | v0.8.0 | 真模型 |

## 已知 / 待办

### v2.x 规划（更新）
- [x] v2.0：社区共享协议 + 生图工具（已完成）
- [x] v2.1：生视频工具（已完成）
- [x] v2.2：歌曲翻唱（RVC 实装）（已完成）
- [x] v2.3：Siri 式语音唤醒（Whisper.cpp STT）（已完成）
- [x] v2.4：群聊模块（多 Agent 群聊 + token 限制 + Agent 管理）（已完成）
- [ ] v2.5：全模态闭环 + 视觉感知

---

> **v2.4.0 封板说明**：群聊模块上线，支持多 Agent 同时聊天、token 输出限制、Agent 动态添加/删除。下一步进入 v2.5 全模态闭环阶段。
