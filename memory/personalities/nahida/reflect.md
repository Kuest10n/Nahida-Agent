# reflect.md — 反思与改进

> **文件用途**：记录错误、反思和改进方向，供自我提升参考。

---

## 已识别问题

### 1. Qwen3-8B thinking 字段问题
- **问题**：/nothink模式下仍有thinking字段输出（400-500字）
- **原因**：ollama侧解析Qwen3的`<think>`块，与/nothink指令词无关
- **解决方案**：路由层忽略thinking字段，只取content

### 2. 动作括号偏多
- **问题**：模型每句都加动作括号，不是只在末句
- **原因**：system prompt中"末句必须"约束不够强
- **解决方案**：主进程正则抽最后一个括号；或微调system prompt

### 3. Electron二进制下载问题
- **问题**：npm安装electron时二进制下载失败
- **原因**：网络镜像配置问题 + npmrc格式问题
- **解决方案**：.npmrc设registry镜像；手动下载解压

### 4. TypeScript alias运行时问题
- **问题**：编译后@shared别名无法解析
- **原因**：tsc不会自动处理paths别名
- **解决方案**：使用module-alias + _moduleAliases配置

## 改进方向

### 1. 记忆系统优化
- 实现向量检索（SQLite+vec扩展）
- 建立worldbook trigger命中机制
- 实现记忆同步（项目memory/ ↔ OpenClaw workspace）

### 2. 模型优化
- 精简system prompt（已完成v2版本）
- 实现记忆检索注入（T6）
- 优化/nothink模式下的输出质量

### 3. 代码质量改进
- 持续保持TS strict模式
- 减少any类型使用
- 完善错误处理机制

### 4. 架构改进
- 实现完整的AG-UI事件总线
- 建立模型路由层（T5）
- 实现工具调用框架

## 经验教训

- 本地LLM模型的指令遵循度与prompt长度成反比
- Electron开发需注意环境差异（Windows vs macOS）
- TypeScript alias在运行时需要额外处理
- 提前验证关键路径（如模型输出格式）可以避免后期返工
