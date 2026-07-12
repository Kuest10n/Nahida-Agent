***

description: 编写 MCP Server / skill 工具 / 硬件监控时触发
alwaysApply: false
------------------

# MCP Skill 规范

- 每个 skill = 独立 MCP Server（stdio 启动），主进程用 MCP Client 接
- Tool schema 必须 zod 定义，description 写中文，参数示例给 1-2 个
- 硬件监控类（帧率/Low帧/温度/利用率/游戏识别）：
  - 进程扫 `GenshinImpact.exe` / `StarRail.exe` + 窗口标题
  - 温度/利用率走 `systeminformation` npm 包（跨平台）
  - 报告格式：`{ game: 'GI', fps_avg: 58, fps_low: 42, gpu_temp: 67, gpu_load: 0.89 }`
- 内置 skill 清单预留口：文件操作、网页获取、搜索、天气、Office 生成、翻译、记账、出行规划
- 禁止：游戏代肝、模拟输入（按米哈游守则）

