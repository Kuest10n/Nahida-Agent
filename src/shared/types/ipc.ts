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
  BALANCE_GET = 'balance:get',
  STT_START = 'stt:start',
  STT_STOP = 'stt:stop',
  STT_RESULT = 'stt:result',
  EXPORT_CONVERSATION = 'export:conversation',
  IMAGE_UPLOAD = 'image:upload',
  VISION_ANALYZE = 'vision:analyze',
  VISION_RESULT = 'vision:result',
  /** v2.9: 区域截图 — main → overlay 窗口，启动选区 */
  SCREENSHOT_REGION_START = 'screenshot:region-start',
  /** v2.9: 区域截图 — overlay 窗口 → main，回传选区坐标 */
  SCREENSHOT_REGION_RESULT = 'screenshot:region-result',
  /** v2.9: 区域截图 — overlay 窗口 → main，用户取消 */
  SCREENSHOT_REGION_CANCEL = 'screenshot:region-cancel',
  /** v2.12: 视频上传 */
  VIDEO_UPLOAD = 'video:upload',
  /** v2.12: 视频分析结果推送 */
  VIDEO_RESULT = 'video:result',
  /** v2.16: 屏幕实时监控开始 */
  MONITOR_START = 'monitor:start',
  /** v2.16: 屏幕实时监控停止 */
  MONITOR_STOP = 'monitor:stop',
  /** v2.16: 屏幕实时监控状态查询 */
  MONITOR_STATE = 'monitor:state',
  /** v2.16: 监控帧差事件推送 */
  MONITOR_FRAME = 'monitor:frame',
}

// ---------- agent:chat（用户发消息 → main） ----------
export const agentChatSchema = z.object({
  message: z.string().min(1),
  mode: z.enum(['casual', 'think', 'plan']).default('casual'),
  // 安全：sessionId 直接拼接成文件路径（session-store.ts 的 path.join），
  // 必须严格限制字符集，防止路径遍历（../、绝对路径、特殊字符）写任意路径 JSON 文件
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  /** v2.5: 附带的图片 base64 列表（不含 data:image/xxx;base64, 前缀） */
  // 每个元素必须非空字符串，否则 saveUploadedImage 会写 0 字节文件 + 污染缓存 key
  images: z.array(z.string().min(1)).optional(),
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
    modelDistribution: z.object({
      labels: z.array(z.string()),
      values: z.array(z.number()),
    }),
  }).optional(),
});
export type StatsGetChartResultPayload = z.infer<typeof statsGetChartResultSchema>;

// ---------- balance:get（获取 API 余额） ----------
export const balanceGetSchema = z.object({});
export type BalanceGetPayload = z.infer<typeof balanceGetSchema>;

export const balanceGetResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().optional(),
  provider: z.string().optional(),
  error: z.string().optional(),
});
export type BalanceGetResultPayload = z.infer<typeof balanceGetResultSchema>;

// ---------- stt:start（渲染层 → main，启动语音识别） ----------
// 第五关 AUTH-06：之前是 passthrough，渲染层可塞任意字段
// 这里限定为 STTConfig 的合法子集（Partial），且字段类型严格校验
export const sttStartSchema = z.object({
  lang: z.string().regex(/^[a-zA-Z-]+$/).optional(),
  continuous: z.boolean().optional(),
  interimResults: z.boolean().optional(),
  maxDurationMs: z.number().int().min(0).max(600_000).optional(),
  backend: z.enum(['web-speech', 'openai-whisper', 'whisper-cpp']).optional(),
}).strict();
export type SttStartPayload = z.infer<typeof sttStartSchema>;

// ---------- stt:result（渲染层 → main，回传识别结果） ----------
// 渲染层 web-speech API 返回的识别结果，主进程通过 receiveResult 接收
export const sttResultSchema = z.object({
  text: z.string(),
  isFinal: z.boolean(),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
  backend: z.enum(['web-speech', 'openai-whisper', 'whisper-cpp']),
}).strict();
export type SttResultPayload = z.infer<typeof sttResultSchema>;

// ---------- vision:analyze（渲染层 → main，请求图像分析） ----------
// 第五关 AUTH-06：之前是 passthrough，渲染层可塞任意字段
export const visionAnalyzeSchema = z.object({
  /** 图片 base64 列表（不含 data:image/xxx;base64, 前缀） */
  images: z.array(z.string().min(1)).min(1).max(8),
  prompt: z.string().min(1).max(4000),
  /** 安全：sessionId 限制字符集防路径遍历 */
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict();
export type VisionAnalyzePayload = z.infer<typeof visionAnalyzeSchema>;

// ---------- image:upload（渲染层 → main，用户上传图片） ----------
export const imageUploadSchema = z.object({
  /** base64 编码（不含 data:image/xxx;base64, 前缀） */
  base64: z.string().min(1),
  /** MIME 类型，如 image/png / image/jpeg */
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).default('image/png'),
  /** 来源：文件选择 / 剪贴板粘贴 / 拖拽 */
  source: z.enum(['file', 'clipboard', 'drag']).default('file'),
  /** 原始文件名（可选） */
  filename: z.string().optional(),
});
export type ImageUploadPayload = z.infer<typeof imageUploadSchema>;

export const imageUploadResultSchema = z.object({
  ok: z.boolean(),
  /** 存储到 data/media/ 的相对路径 */
  path: z.string().optional(),
  /** 用于 ollama vision 的 base64（已清洗） */
  base64: z.string().optional(),
  /** 缩略图 base64（用于渲染层显示，最大 200x200） */
  thumbnail: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  error: z.string().optional(),
});
export type ImageUploadResultPayload = z.infer<typeof imageUploadResultSchema>;

// ---------- vision:analyze（main → 渲染层，推送分析结果） ----------
/** v2.14：OCR 置信度摘要（vision / video 共用） */
export const ocrConfidenceSchema = z.object({
  average: z.number(),
  minimum: z.number(),
  lowCount: z.number(),
  totalLines: z.number(),
});
export type OcrConfidencePayload = z.infer<typeof ocrConfidenceSchema>;

export const visionResultSchema = z.object({
  sessionId: z.string(),
  /** 分析出的文本描述 */
  description: z.string(),
  /** OCR 识别的文字（如果有） */
  ocrText: z.string().optional(),
  /** v2.14：OCR 置信度摘要 */
  ocrConfidence: ocrConfidenceSchema.optional(),
  /** 关联的图片路径 */
  imagePaths: z.array(z.string()),
  timestamp: z.number(),
});
export type VisionResultPayload = z.infer<typeof visionResultSchema>;

// ---------- screenshot:region-start（main → overlay 窗口，启动选区） ----------
export const screenshotRegionStartSchema = z.object({
  /** 屏幕物理像素尺寸（用于坐标转换） */
  screenWidth: z.number(),
  screenHeight: z.number(),
  /** 设备像素比（DPR） */
  devicePixelRatio: z.number().default(1),
});
export type ScreenshotRegionStartPayload = z.infer<typeof screenshotRegionStartSchema>;

// ---------- screenshot:region-result（overlay 窗口 → main，回传选区） ----------
export const screenshotRegionResultSchema = z.object({
  /** 选区坐标（屏幕物理像素） */
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ScreenshotRegionResultPayload = z.infer<typeof screenshotRegionResultSchema>;

// ---------- screenshot:region-cancel（overlay 窗口 → main，用户取消） ----------
export const screenshotRegionCancelSchema = z.object({});
export type ScreenshotRegionCancelPayload = z.infer<typeof screenshotRegionCancelSchema>;

// ---------- video:upload（渲染层 → main，上传视频文件） ----------
export const videoUploadSchema = z.object({
  /** 视频文件绝对路径（main 进程会再用 isSafeVideoPath 二次校验：扩展名白名单 + realpathSync + 敏感目录黑名单） */
  filePath: z.string().min(1),
  /** 视频文件名 */
  fileName: z.string().min(1),
  /** 视频大小（字节） */
  fileSize: z.number().nonnegative(),
  /** 安全：sessionId 同 agentChatSchema，限制字符集防路径遍历 */
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  /** 可选的用户提问 */
  prompt: z.string().max(2000).optional(),
});
export type VideoUploadPayload = z.infer<typeof videoUploadSchema>;

// ---------- video:result（main → 渲染层，视频分析结果） ----------
export const videoResultSchema = z.object({
  sessionId: z.string(),
  /** 分析描述 */
  description: z.string(),
  /** 抽取的帧数 */
  frameCount: z.number(),
  /** 视频时长（秒） */
  duration: z.number(),
  /** 帧图片路径 */
  imagePaths: z.array(z.string()),
  /** 抽帧策略：scene / uniform / mixed */
  strategy: z.enum(['scene', 'uniform', 'mixed']).optional(),
  /** OCR 文字（如果启用） */
  ocrText: z.string().optional(),
  /** v2.14：OCR 置信度摘要 */
  ocrConfidence: ocrConfidenceSchema.optional(),
  timestamp: z.number(),
});
export type VideoResultPayload = z.infer<typeof videoResultSchema>;

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
  [IpcChannel.BALANCE_GET]: balanceGetSchema,
  [IpcChannel.STT_START]: sttStartSchema,
  [IpcChannel.STT_STOP]: z.object({}),
  [IpcChannel.STT_RESULT]: sttResultSchema,
  [IpcChannel.EXPORT_CONVERSATION]: z.object({
    // 第五关 AUTH-03：sessionId 限制字符集，防 path.join 时被 ../ 拼出任意路径
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    format: z.enum(['markdown', 'json']),
    includeMetadata: z.boolean().optional(),
  }),
  [IpcChannel.IMAGE_UPLOAD]: imageUploadSchema,
  [IpcChannel.VISION_ANALYZE]: visionAnalyzeSchema,
  [IpcChannel.VISION_RESULT]: visionResultSchema,
  [IpcChannel.SCREENSHOT_REGION_START]: screenshotRegionStartSchema,
  [IpcChannel.SCREENSHOT_REGION_RESULT]: screenshotRegionResultSchema,
  [IpcChannel.SCREENSHOT_REGION_CANCEL]: screenshotRegionCancelSchema,
  [IpcChannel.VIDEO_UPLOAD]: videoUploadSchema,
  [IpcChannel.VIDEO_RESULT]: videoResultSchema,
  // v2.16: 屏幕实时监控
  [IpcChannel.MONITOR_START]: z.object({
    intervalMs: z.number().optional(),
    threshold: z.number().optional(),
    autoAnalyze: z.boolean().optional(),
  }),
  [IpcChannel.MONITOR_STOP]: z.object({}),
  [IpcChannel.MONITOR_STATE]: z.object({}),
  [IpcChannel.MONITOR_FRAME]: z.object({
    type: z.enum(['started', 'stopped']),
    state: z.object({
      isActive: z.boolean(),
      frameCount: z.number(),
      changeCount: z.number(),
    }).optional(),
    timestamp: z.number(),
  }),
} as const;

export type IpcSchemas = typeof ipcSchemas;
