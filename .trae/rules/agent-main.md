***

description: Electron 主进程 + Agent 编排规范
globs: src/main/\*\*/\*.ts
alwaysApply: false
------------------

# 主进程规范

- 语言：TypeScript strict 模式，禁止 any（Agent 编排这种精密逻辑 any 会埋雷）
- 主进程职责：Agent 编排（ReAct 循环）、模型路由（三重思考）、工具注册、MCP Client、记忆读写、AG-UI 事件总线、TTS 调度、Live2D 动作 tag 抽取
- 禁止在主进程直接操作 DOM（那是渲染层的事）
- IPC 通道命名：`agent:chat` / `agent:tool-call` / `live2d:action` / `tts:chunk`，用 enum 统一定义在 `src/shared/ipc-channels.ts`
- AG-UI 事件总线用 EventEmitter 封装，主进程 emit，渲染层 on
- 工具注册格式：每个 tool 必须 `name | description | parameters (zod schema) | execute()`
- MCP 接 stdio（本地 skill）+ sse（远程扩展）双协议

