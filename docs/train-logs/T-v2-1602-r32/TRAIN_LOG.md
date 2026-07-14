# T-v2-1602-r32 训练日志

## 基本信息
- **训练版本**: T-v2
- **数据量**: 1602 条
- **LoRA rank**: 32
- **基模**: Qwen/Qwen2.5-1.5B-Instruct
- **训练框架**: LLaMA-Factory
- **训练轮次**: 10 epochs
- **Loss 曲线**: 0.48 → 0.11

## 导出物
- **GGUF 文件**: `models/qwen1.5b-review-lora-v2.q4_k_m.gguf`
- **Ollama 模型名**: `qwen2.5-1.5b-review-lora-v2`
- **Modelfile**: `modelfiles/qwen2.5-1.5b-review-lora-v2.Modelfile`

## 用途
- 四审层审查模型（A/B/C/D 四维审查）
- 审查策略：混合策略（A/B 规则 + C 模型 + D 规则）
- G25 延迟：~377ms

## 版本演进
- **T-v1**: 初始版本，已被 T-v2 替代
- **T-v2**: 当前版本，1602 条数据，loss 0.11
- **T-v3**: 后续版本（1677 条数据），已集成到代码

## 归档时间
- **归档日期**: 2026-07-15
- **归档原因**: T-v3 已完成并上线，T-v2 作为历史版本归档
- **状态**: 已废弃（代码已切换到 T-v3）
