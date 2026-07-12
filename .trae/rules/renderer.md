***

description: PixiJS + pixi-live2d-display + Cubism 4.0 版本与渲染规范
globs: src/renderer/\*\*/\*.{ts,tsx}
alwaysApply: false
------------------

# 渲染层 Live2D 规范

- PixiJS **锁定 v7.x** + `pixi-live2d-display` 配套 0.x（Cubism 4.0 对 Pixi 7 更稳，Pixi 8 有兼容坑）
- Live2D 模型格式：Cubism 4.0 `.model3.json`，`live2dcubismcore.min.js` 走官方 SDK，不下发仓库
- 模型挂载在透明漂浮窗：`transparent: true, frame: false, alwaysOnTop: true`
- 动作映射表：`src/renderer/live2d/action-map.ts`，正则 `(铃铛轻响)→wave`, `(花冠微垂)→idle_blink_sad` 等，主进程 IPC 过来查表执行
- Lipsync：rhubarb 从 TTS 音频出口型 → `ParamMouthOpenY`，sentence-level 切 chunk
- 渲染层**只负责演，不负责决策**：动作 tag 来自主进程，不要在本层自己抽文本

