import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel, ipcSchemas, type IpcSchemas } from '../../shared/types/ipc';
import { z, ZodError } from 'zod';

// 全量 zod 校验 —— main handler 进业务逻辑前调用
// preload 只做轻校验（channel名 + 基础shape），全量在这层
// 返回的是 zod 输出类型（带 default 值填充后）
export function validateIpcPayload<C extends IpcChannel>(
  channel: C,
  payload: unknown,
): z.infer<IpcSchemas[C]> {
  const schema = ipcSchemas[channel];
  if (!schema) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ZodError(result.error.issues);
  }
  return result.data as z.infer<IpcSchemas[C]>;
}

// 注册带全量校验的 handler
// handler 拿到的 payload 是经过 zod 校验 + default 填充后的输出类型
export function registerValidatedHandler<C extends IpcChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    payload: z.infer<IpcSchemas[C]>,
  ) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, (event, rawPayload) => {
    try {
      const payload = validateIpcPayload(channel, rawPayload);
      return handler(event, payload);
    } catch (err) {
      console.error(`[IPC] validate failed on ${channel}:`, err);
      throw err;
    }
  });
}
