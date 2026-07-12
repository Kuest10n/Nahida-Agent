import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPanel } from './ChatPanel';

/**
 * T4 完整聊天界面
 *
 * 替换 T1 骨架验证面板，提供：
 *   - 消息列表（用户 + 助手）
 *   - 流式输出支持
 *   - 输入栏（回车发送）
 */
const App: React.FC = () => {
  return <ChatPanel />;
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);