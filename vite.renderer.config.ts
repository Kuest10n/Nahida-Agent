import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vite 渲染层配置 —— 多入口
 *   - main  : 聊天/设置主窗口 (http://localhost:5173/main/index.html)
 *   - live2d: Live2D 透明漂浮窗 (http://localhost:5173/live2d/index.html)
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
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
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
      },
    },
  },
});
