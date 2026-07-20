import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../shared/types/ipc';

console.log('[Preload] nahida-agent preload script loaded');

// 通道白名单 —— 只允许列表内的 channel，防渲染层乱发
const INVOKE_CHANNELS = new Set<string>([
  IpcChannel.AGENT_CHAT,
  IpcChannel.AUTOSTART_SET,
  IpcChannel.AUTOSTART_GET,
  IpcChannel.LIVE2D_PENETRATE,
  IpcChannel.PERSONALITY_GET,
  IpcChannel.PERSONALITY_LIST,
  IpcChannel.PERSONALITY_SWITCH,
  IpcChannel.PERSONALITY_CREATE,
  IpcChannel.PERSONALITY_DELETE,
  IpcChannel.BALANCE_GET,
  IpcChannel.STT_START,
  IpcChannel.STT_STOP,
  IpcChannel.STT_RESULT,
  IpcChannel.EXPORT_CONVERSATION,
  IpcChannel.IMAGE_UPLOAD,
  IpcChannel.VISION_ANALYZE,
  IpcChannel.SCREENSHOT_REGION_RESULT,
  IpcChannel.SCREENSHOT_REGION_CANCEL,
  IpcChannel.VIDEO_UPLOAD,
  // v2.16: 屏幕实时监控
  IpcChannel.MONITOR_START,
  IpcChannel.MONITOR_STOP,
  IpcChannel.MONITOR_STATE,
]);

// 渲染层能监听的通道（main → renderer 单向推）
const LISTEN_CHANNELS = new Set<string>([
  IpcChannel.AGENT_MODEL_DELTA,
  IpcChannel.AGENT_TOOL_CALL,
  IpcChannel.AGENT_STATE_CHANGE,
  IpcChannel.LIVE2D_ACTION,
  IpcChannel.TTS_CHUNK,
  IpcChannel.RAND_ERROR_REPORT,
  IpcChannel.VISION_RESULT,
  IpcChannel.SCREENSHOT_REGION_START,
  IpcChannel.VIDEO_RESULT,
  // v2.16: 屏幕实时监控帧差事件
  IpcChannel.MONITOR_FRAME,
  // v3.0: 反馈窗口打开事件
  IpcChannel.FEEDBACK_OPEN,
]);

// 给渲染层暴露的 API
// 注意：只暴露最小必要能力，不直接暴露 ipcRenderer
const nahidaAPI = {
  // 发送消息（渲染层 → main），带 channel 白名单
  invoke: (channel: string, payload: unknown): Promise<unknown> => {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`[Preload] forbidden invoke channel: ${channel}`);
    }
    // preload 只做白名单轻校验，全量 zod 校验在 main ipc/validate.ts
    return ipcRenderer.invoke(channel, payload);
  },

  // 监听推送（main → 渲染层）
  on: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    if (!LISTEN_CHANNELS.has(channel)) {
      throw new Error(`[Preload] forbidden listen channel: ${channel}`);
    }
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, handler);
    // 返回解绑函数
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

// 通过 contextBridge 暴露，保持 contextIsolation=true
contextBridge.exposeInMainWorld('nahidaAPI', nahidaAPI);
console.log('[Preload] nahidaAPI exposed to renderer via contextBridge');

// 类型声明（渲染层用 Window['nahidaAPI']）
export type NahidaAPI = typeof nahidaAPI;
