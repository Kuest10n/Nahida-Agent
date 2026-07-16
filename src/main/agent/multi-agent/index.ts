/**
 * 多 Agent 协作框架 —— 统一入口
 *
 * 六顶帽模式：通过 `/hat` 命令切换，类似 `/think`
 * 启用后，每条消息前由六个专家 Agent 并行审查
 *
 * 六个专家 Agent：
 *   - 白帽：客观事实与数据
 *   - 红帽：情感与直觉
 *   - 黑帽：风险与问题
 *   - 黄帽：优点与价值
 *   - 绿帽：创意与可能性
 *   - 蓝帽：控制与协调
 *
 * 使用方式：
 *   1. 用户发送 "/hat" 命令 → 切换六顶帽模式
 *   2. 启用后，自动并行执行六顶帽思考
 *   3. 思考结果聚合后注入 system prompt
 */

export { BaseAgent } from './agent-base';
export { WhiteHatAgent, RedHatAgent, BlackHatAgent, YellowHatAgent, GreenHatAgent, BlueHatAgent, SIX_HATS_AGENTS } from './six-hats';
export { MultiAgentCoordinator, getCoordinator, initCoordinator } from './coordinator';
export type { AgentId, AgentThought, AgentContext, AgentConfig } from './agent-base';
export type { CoordinatorConfig, CoordinatorState, CoordinatorResult } from './coordinator';