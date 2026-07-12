***

description: 修改 SOHA.md / User.md / fact.md / worldbook/ / persona.md / emotion.md / skill.md / reflect.md / interest.md 等记忆分片时触发
alwaysApply: false
------------------

# 记忆分片规范

- 分片 9 文件：`SOHA.md`(人格核心，原SOUL改名避免与OpenClaw撞名) / `User.md`(我/旅行者双模式) / `fact.md`(发生的事+大背景) / `worldbook/`(history/lore拆条目) / `persona.md`(原think稳定部分) / `emotion.md`(原heartjump) / `skill.md`(工具技能) / `reflect.md`(原error+反思) / `interest.md`(原think浮动部分)
- 单文件 200-800 字，超了拆 worldbook entry
- Worldbook entry 格式：`---trigger: [关键词1, 关键词2]\npriority: 90\n---\n内容`，按 trigger 召回
- SOHA.md 尾部必须带 **正反例 Appendix**（助手腔❌ vs 纳西妲腔✅，至少 15 对）
- 项目 `memory/` 是源 → OpenClaw `~/.openclaw/workspace/` 是镜像，改源后手动 sync 脚本跑一次
- 向量库：SQLite+vec 扩展（桌面端轻量优先），worldbook trigger 命中优先于向量召回

