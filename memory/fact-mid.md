# fact-mid.md — 中时事实（项目周期）

> 周内更新。当前项目进度、近期里程碑、待办事项。

---

## 当前项目周期

- **项目**：纳西妲 Agent v0.7.0
- **v3 LoRA 训练**：1677 条数据，rank32，10 epochs，loss 0.1168
- **TTS 路线**：GPT-SoVITS v4 模型已就位（F:\nahida\v4\纳西妲_ZH\）

## 已完成里程碑

- T0-T11 全部完成（架构/IPC/模型/worldbook/Agent/工具/Session/配置）
- 四审 v2 跑通（A/B 规则 + C 模型 + D 规则），v3 训练中
- T8 TTS 调度（edge-tts + RVC bridge + GPT-SoVITS adapter）
- Perception 模块接入主进程 + proactiveQueue 主动开口
- budget.ts system prompt token 管制

## 待办事项

- v3 训完 → export GGUF q4 → ollama create v3 → e2e 验 A1/B1
- GPT-SoVITS refer 11 条情绪参考音频（从 1540 条 .lab 挑）
- Live2D 模型就位 + rhubarb 嘴型
- worldbook 扩写（散兵/森林书/花神诞祭）
