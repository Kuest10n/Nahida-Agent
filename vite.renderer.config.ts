import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vite 渲染层配置 —— 多入口
 *   - main           : 聊天/设置主窗口 (http://localhost:5173/main/index.html)
 *   - live2d         : Live2D 透明漂浮窗 (http://localhost:5173/live2d/index.html)
 *   - capture-overlay: 区域截图覆盖窗 (http://localhost:5173/capture-overlay/index.html)  v2.9
 *
 * 主进程 electron 启动时：
 *   - dev 模式: mainWindow.loadURL('http://localhost:5173/main/index.html')
 *                live2dWindow.loadURL('http://localhost:5173/live2d/index.html')
 *   - 生产模式: loadFile('dist/renderer/main/index.html') 等
 */
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: resolve(__dirname, 'assets'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@memory': resolve(__dirname, 'src/main/memory'),
      '@tools': resolve(__dirname, 'src/main/tools'),
      '@agent': resolve(__dirname, 'src/main/agent'),
      '@ipc': resolve(__dirname, 'src/main/ipc'),
      '@router': resolve(__dirname, 'src/main/router'),
      '@vision': resolve(__dirname, 'src/main/vision'),
      '@perception': resolve(__dirname, 'src/main/perception'),
      '@health': resolve(__dirname, 'src/main/health'),
      '@soul': resolve(__dirname, 'src/main/soul'),
      '@tts': resolve(__dirname, 'src/main/tts'),
      '@plugins': resolve(__dirname, 'src/main/plugins'),
      '@api': resolve(__dirname, 'src/main/api'),
      '@community': resolve(__dirname, 'src/main/community'),
      '@mcp': resolve(__dirname, 'src/main/mcp'),
      '@rag': resolve(__dirname, 'src/main/rag'),
      '@safety': resolve(__dirname, 'src/main/safety'),
      '@python': resolve(__dirname, 'src/main/python'),
      '@hotkeys': resolve(__dirname, 'src/main/hotkeys'),
      '@tray': resolve(__dirname, 'src/main/tray'),
      '@config': resolve(__dirname, 'src/main/config'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/main/index.html'),
        live2d: resolve(__dirname, 'src/renderer/live2d/index.html'),
        'capture-overlay': resolve(__dirname, 'src/renderer/capture-overlay/index.html'),
      },
    },
  },
});
