// 渲染层全局类型声明 —— 让 window.nahidaAPI 有类型
// 只在 renderer 的 tsconfig 里生效（main/preload 不管）

declare global {
  interface Window {
    nahidaAPI: {
      invoke: (channel: string, payload: unknown) => Promise<unknown>;
      on: (channel: string, callback: (payload: unknown) => void) => () => void;
    };
  }
}

export {};
