import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initLive2D, playAction, hitTestModel, playAudioForViseme, updateMousePosition } from './manager';
import { IpcChannel } from '../../shared/types/ipc';

const Live2dApp: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>('loading');
  const [lastAction, setLastAction] = useState<string>('idle');
  const [isHoveringModel, setIsHoveringModel] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Electron loadFile() 模式下使用相对路径
    // Vite dev server 模式下 publicDir assets/ 会被映射到 /models/
    const modelUrl = './models/nahida/Nahida.model3.json';

    initLive2D({
      canvas: canvasRef.current,
      modelUrl,
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 0.25,
    })
      .then(() => {
        setStatus('ready');
        console.log('[Live2D] initialized');
      })
      .catch((e) => {
        setStatus('error');
        console.error('[Live2D] init failed:', e);
      });

    const cleanupAction = window.nahidaAPI?.on('live2d:action', (payload) => {
      const data = payload as { actionTag: string; expression?: string };
      setLastAction(data.actionTag);
      playAction({ tag: data.actionTag, expression: data.expression });
    });

    const cleanupTts = window.nahidaAPI?.on('tts:chunk', (payload) => {
      const data = payload as { audioBase64: string };
      if (data.audioBase64) {
        void playAudioForViseme(data.audioBase64);
      }
    });

    return () => {
      cleanupAction?.();
      cleanupTts?.();
    };
  }, []);

  useEffect(() => {
    // 模型未加载完成时不启用动态穿透，避免错误设置为穿透模式后无法恢复交互
    if (status !== 'ready') return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTestModel(x, y);
      setIsHoveringModel(hit);

      // 眼神跟随：把鼠标位置传给 manager，每帧驱动 ParamAngleX/Y
      updateMousePosition(x, y, rect.width, rect.height);

      // 只有状态变化时才发 IPC，减少主进程压力
      window.nahidaAPI?.invoke(IpcChannel.LIVE2D_PENETRATE, { enable: !hit }).catch(() => {
        // IPC 失败静默处理，避免抛异常打断交互
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [status]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        fontSize: 11,
        color: '#81c784',
        opacity: 0.6,
        userSelect: 'none',
      }}>
        {status} · {lastAction} · hover:{isHoveringModel ? 'yes' : 'no'}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Live2dApp />);
