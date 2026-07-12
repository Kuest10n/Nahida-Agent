import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initLive2D, playAction } from './manager';

/**
 * Live2D 窗入口
 *
 * - 有模型素材 → Pixi + Cubism4 真实渲染
 * - 没模型素材 → stub 模式（草光呼吸占位），不炸
 * - 统一通过 manager.ts 的 playAction() 播动作
 *
 * 素材路径：后续放到 public/models/nahida/nahida.model3.json
 */
const Live2dApp: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>('loading');
  const [lastAction, setLastAction] = useState<string>('idle');

  useEffect(() => {
    if (!canvasRef.current) return;

    // 素材路径（后续配置化，先空走 stub）
    const modelUrl = '';

    initLive2D({
      canvas: canvasRef.current,
      modelUrl,
      width: window.innerWidth,
      height: window.innerHeight,
    })
      .then(() => {
        setStatus('ready');
        console.log('[Live2D] initialized');
      })
      .catch((e) => {
        setStatus('error');
        console.error('[Live2D] init failed:', e);
      });

    // 监听主进程 action（唯一监听点，manager.ts 不再重复监听）
    const cleanup = window.nahidaAPI?.on('live2d:action', (payload) => {
      const data = payload as { actionTag: string; expression?: string };
      setLastAction(data.actionTag);
      playAction({ tag: data.actionTag, expression: data.expression });
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
    }}>
      {/* Pixi canvas 占满透明窗 */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* 状态标签（调试用，后续可关） */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        fontSize: 11,
        color: '#81c784',
        opacity: 0.6,
        userSelect: 'none',
      }}>
        {status} · {lastAction}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Live2dApp />);
