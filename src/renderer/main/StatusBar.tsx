/**
 * 状态栏 —— 消费 agent:state-change 推送
 *
 * 职责：展示 Perception 报警（帧率/温度/瓶颈）的轻量 toast
 * 设计：
 *   - 监听 'agent:state-change' 通道
 *   - 只处理 state === 'error' 且 reason 以 [Perception: 开头的报警
 *   - 5 秒后自动消失
 *   - 挂在 ChatPanel 底部，输入栏上方
 *
 * 不占 GPU，纯 UI 壳。等 Perception 真推数据时即可见。
 */
import React, { useEffect, useState } from 'react';

/** IPC 推送的 state-change payload（与 src/shared/types/ipc.ts 对齐） */
interface StateChangePayload {
  state: 'idle' | 'thinking' | 'tool_calling' | 'speaking' | 'error';
  reason?: string;
  game?: {
    game?: 'GI' | 'SR' | 'none';
    fps_avg?: number;
    fps_low?: number;
    gpu_temp?: number;
    gpu_load?: number;
  };
  timestamp: number;
}

/** 报警类型 → 图标 + 颜色映射 */
const ALERT_STYLE: Record<string, { icon: string; color: string }> = {
  low_fps:             { icon: '⚠️', color: '#ff9800' },
  overheat_gpu:        { icon: '🌡️', color: '#f44336' },
  overheat_cpu:        { icon: '🌡️', color: '#f44336' },
  hardware_bottleneck: { icon: '🔧', color: '#9c27b0' },
};

/** 自动消失时长 */
const DISMISS_MS = 5000;

export const StatusBar: React.FC = () => {
  const [notice, setNotice] = useState<{ text: string; color: string } | null>(null);

  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('agent:state-change', (payload) => {
      const data = payload as StateChangePayload;
      // 只处理 Perception 报警（reason 带 [Perception:type] 前缀）
      if (data.state !== 'error' || !data.reason) return;
      const match = data.reason.match(/^\[Perception:(\w+)\]\s*(.*)$/);
      if (!match) return;

      const alertType = match[1] ?? '';
      const message = match[2] ?? '';
      const style = ALERT_STYLE[alertType] ?? { icon: 'ℹ️', color: '#666' };
      // 附带游戏名（如有）
      const gameSuffix = data.game?.game && data.game.game !== 'none'
        ? ` [${data.game.game}]`
        : '';
      setNotice({ text: `${style.icon} ${message}${gameSuffix}`, color: style.color });

      // 5 秒后自动消失
      const timer = setTimeout(() => setNotice(null), DISMISS_MS);
      return () => clearTimeout(timer);
    });

    return () => { cleanup?.(); };
  }, []);

  // 无通知时不渲染（占位 0 高度）
  if (!notice) return null;

  return (
    <div
      style={{
        padding: '6px 12px',
        backgroundColor: notice.color,
        color: '#fff',
        fontSize: 12,
        borderRadius: 4,
        margin: '0 8px 4px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }}
    >
      {notice.text}
    </div>
  );
};
