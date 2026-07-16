import { z } from 'zod';

// IPC 通道枚举 —— preload 和 main 都引用这份，禁止各写各的
export enum IpcChannel {
  AGENT_CHAT = 'agent:chat',
  AGENT_MODEL_DELTA = 'agent:model-delta',
  AGENT_TOOL_CALL = 'agent:tool-call',
  AGENT_STATE_CHANGE = 'agent:state-change',
  LIVE2D_ACTION = 'live2d:action',
  LIVE2D_PENETRATE = 'live2d:penetrate',
  TTS_CHUNK = 'tts:chunk',
  AUTOSTART_SET = 'autostart:set',
  AUTOSTART_GET = 'autostart:get',
  PERSONALITY_GET = 'personality:get',
  PERSONALITY_LIST = 'personality:list',
  PERSONALITY_SWITCH = 'personality:switch',
  PERSONALITY_CREATE = 'personality:create',
  PERSONALITY_DELETE = 'personality:delete',
  RAND_ERROR_REPORT = 'rand-error:report',
  CONFIG_GET = 'config:get',
  CONFIG_SET = 'config:set',
  FEEDBACK_SUBMIT = 'feedback:submit',
  FEEDBACK_OPEN = 'feedback:open',
  STATS_GET = 'stats:get',
  STATS_GET_CHART = 'stats:get-chart',
}

// ---------- agent:chat（用户发消息 → main） ----------
export const agentChatSchema = z.object({
  message: z.string().min(1),
  mode: z.enum(['casual', 'think', 'plan']).default('casual'),
  sessionId: z.string().optional(),
});
export type AgentChatPayload = z.infer<typeof agentChatSchema>;

// ---------- agent:model-delta（main → 渲染层，流式token） ----------
export const agentModelDeltaSchema = z.object({
  delta: z.string(),
  finishReason: z.enum(['stop', 'action_tag', 'tool_call', 'length']).optional(),
  sessionId: z.string(),
  timestamp: z.number(),
});
export type AgentModelDeltaPayload = z.infer<typeof agentModelDeltaSchema>;

// ---------- agent:tool-call（工具调用双向） ----------
export const agentToolCallSchema = z.object({
  toolName: z.string(),
  parameters: z.record(z.unknown()),
  callId: z.string(),
  sessionId: z.string(),
});
export type AgentToolCallPayload = z.infer<typeof agentToolCallSchema>;

export const agentToolResultSchema = z.object({
  callId: z.string(),
  result: z.unknown(),
  error: z.string().optional(),
});
export type AgentToolResultPayload = z.infer<typeof agentToolResultSchema>;

// ---------- agent:state-change（状态变更推送） ----------
export const agentStateChangeSchema = z.object({
  state: z.enum(['idle', 'thinking', 'tool_calling', 'speaking', 'error']),
  reason: z.string().optional(),
  game: z.object({
    game: z.enum(['GI', 'SR', 'none']).optional(),
    fps_avg: z.number().optional(),
    fps_low: z.number().optional(),
    gpu_temp: z.number().optional(),
    gpu_load: z.number().optional(),
  }).optional(),
  timestamp: z.number(),
});
export type AgentStateChangePayload = z.infer<typeof agentStateChangeSchema>;

// ---------- live2d:action（动作 tag 推送） ----------
export const live2dActionSchema = z.object({
  actionTag: z.string(),
  expression: z.string().optional(),
  priority: z.number().default(0),
});
export type Live2dActionPayload = z.infer<typeof live2dActionSchema>;

export const live2dPenetrateSchema = z.object({
  enable: z.boolean(),
});
export type Live2dPenetratePayload = z.infer<typeof live2dPenetrateSchema>;

// ---------- tts:chunk（语音 chunk 推送） ----------
export const ttsChunkSchema = z.object({
  chunkIndex: z.number(),
  totalChunks: z.number(),
  audioBase64: z.string(),
  voiceType: z.string().optional(),
});
export type TtsChunkPayload = z.infer<typeof ttsChunkSchema>;

export const autostartSetSchema = z.object({
  enabled: z.boolean(),
});
export type AutostartSetPayload = z.infer<typeof autostartSetSchema>;

export const autostartGetSchema = z.object({});
export type AutostartGetPayload = z.infer<typeof autostartGetSchema>;

// ---------- personality:get（获取当前人格） ----------
export const personalityGetSchema = z.object({});
export type PersonalityGetPayload = z.infer<typeof personalityGetSchema>;

export const personalityGetResultSchema = z.object({
  ok: z.boolean(),
  personality: z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    default: z.boolean(),
    createdAt: z.number(),
  }).optional(),
});
export type PersonalityGetResultPayload = z.infer<typeof personalityGetResultSchema>;

// ---------- personality:list（获取人格列表） ----------
export const personalityListSchema = z.object({});
export type PersonalityListPayload = z.infer<typeof personalityListSchema>;

export const personalityListResultSchema = z.object({
  ok: z.boolean(),
  personalities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    default: z.boolean(),
    createdAt: z.number(),
  })),
});
export type PersonalityListResultPayload = z.infer<typeof personalityListResultSchema>;

// ---------- personality:switch（切换人格） ----------
export const personalitySwitchSchema = z.object({
  personalityId: z.string().min(1),
});
export type PersonalitySwitchPayload = z.infer<typeof personalitySwitchSchema>;

export const personalitySwitchResultSchema = z.object({
  ok: z.boolean(),
  personalityId: z.string(),
  displayName: z.string(),
});
export type PersonalitySwitchResultPayload = z.infer<typeof personalitySwitchResultSchema>;

// ---------- personality:create（创建新人格） ----------
export const personalityCreateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string(),
});
export type PersonalityCreatePayload = z.infer<typeof personalityCreateSchema>;

export const personalityCreateResultSchema = z.object({
  ok: z.boolean(),
  personality: z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    default: z.boolean(),
    createdAt: z.number(),
  }).nullable(),
});
export type PersonalityCreateResultPayload = z.infer<typeof personalityCreateResultSchema>;

// ---------- personality:delete（删除人格） ----------
export const personalityDeleteSchema = z.object({
  personalityId: z.string().min(1),
});
export type PersonalityDeletePayload = z.infer<typeof personalityDeleteSchema>;

export const personalityDeleteResultSchema = z.object({
  ok: z.boolean(),
});
export type PersonalityDeleteResultPayload = z.infer<typeof personalityDeleteResultSchema>;

// ---------- rand-error:report（自主进化报告推送） ----------
export const randErrorReportSchema = z.object({
  type: z.enum(['A-OOC', 'B-bracket', 'C-mismatch', 'D-tool']),
  count: z.number(),
  threshold: z.number(),
  recentSamples: z.array(z.string()),
  suggestion: z.string(),
  generatedAt: z.number(),
});
export type RandErrorReportPayload = z.infer<typeof randErrorReportSchema>;

// ---------- config:get（获取配置） ----------
export const configGetSchema = z.object({});
export type ConfigGetPayload = z.infer<typeof configGetSchema>;

export const configGetResultSchema = z.object({
  ok: z.boolean(),
  config: z.record(z.unknown()).optional(),
});
export type ConfigGetResultPayload = z.infer<typeof configGetResultSchema>;

// ---------- config:set（保存配置） ----------
export const configSetSchema = z.object({
  config: z.record(z.unknown()),
});
export type ConfigSetPayload = z.infer<typeof configSetSchema>;

export const configSetResultSchema = z.object({
  ok: z.boolean(),
});
export type ConfigSetResultPayload = z.infer<typeof configSetResultSchema>;

// ---------- feedback:submit（提交反馈） ----------
export const feedbackSubmitSchema = z.object({
  type: z.enum(['bug', 'feature', 'other']),
  title: z.string().min(1).max(100),
  content: z.string().min(1),
});
export type FeedbackSubmitPayload = z.infer<typeof feedbackSubmitSchema>;

export const feedbackSubmitResultSchema = z.object({
  ok: z.boolean(),
  filepath: z.string().optional(),
});
export type FeedbackSubmitResultPayload = z.infer<typeof feedbackSubmitResultSchema>;

// ---------- feedback:open（打开反馈窗口，无 payload） ----------
export const feedbackOpenSchema = z.object({});
export type FeedbackOpenPayload = z.infer<typeof feedbackOpenSchema>;

// ---------- stats:get（获取统计摘要） ----------
export const statsGetSchema = z.object({});
export type StatsGetPayload = z.infer<typeof statsGetSchema>;

export const statsGetResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
export type StatsGetResultPayload = z.infer<typeof statsGetResultSchema>;

// ---------- stats:get-chart（获取折线图数据） ----------
export const statsGetChartSchema = z.object({});
export type StatsGetChartPayload = z.infer<typeof statsGetChartSchema>;

export const statsGetChartResultSchema = z.object({
  ok: z.boolean(),
  chartData: z.object({
    dates: z.array(z.string()),
    tokens: z.array(z.number()),
    conversations: z.array(z.number()),
  }).optional(),
});
export type StatsGetChartResultPayload = z.infer<typeof statsGetChartResultSchema>;

// ---------- 全量校验映射（main ipc/validate.ts 用） ----------
export const ipcSchemas = {
  [IpcChannel.AGENT_CHAT]: agentChatSchema,
  [IpcChannel.AGENT_MODEL_DELTA]: agentModelDeltaSchema,
  [IpcChannel.AGENT_TOOL_CALL]: agentToolCallSchema,
  [IpcChannel.AGENT_STATE_CHANGE]: agentStateChangeSchema,
  [IpcChannel.LIVE2D_ACTION]: live2dActionSchema,
  [IpcChannel.LIVE2D_PENETRATE]: live2dPenetrateSchema,
  [IpcChannel.TTS_CHUNK]: ttsChunkSchema,
  [IpcChannel.AUTOSTART_SET]: autostartSetSchema,
  [IpcChannel.AUTOSTART_GET]: autostartGetSchema,
  [IpcChannel.PERSONALITY_GET]: personalityGetSchema,
  [IpcChannel.PERSONALITY_LIST]: personalityListSchema,
  [IpcChannel.PERSONALITY_SWITCH]: personalitySwitchSchema,
  [IpcChannel.PERSONALITY_CREATE]: personalityCreateSchema,
  [IpcChannel.PERSONALITY_DELETE]: personalityDeleteSchema,
  [IpcChannel.RAND_ERROR_REPORT]: randErrorReportSchema,
  [IpcChannel.CONFIG_GET]: configGetSchema,
  [IpcChannel.CONFIG_SET]: configSetSchema,
  [IpcChannel.FEEDBACK_SUBMIT]: feedbackSubmitSchema,
  [IpcChannel.FEEDBACK_OPEN]: feedbackOpenSchema,
  [IpcChannel.STATS_GET]: statsGetSchema,
  [IpcChannel.STATS_GET_CHART]: statsGetChartSchema,
} as const;

export type IpcSchemas = typeof ipcSchemas;
