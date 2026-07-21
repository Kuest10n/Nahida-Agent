/**
 * 视觉感知控制面板
 *
 * 功能：
 *   - 截图按钮：触发区域截图
 *   - 监控开关：启动/停止屏幕监控
 *   - 监控状态：显示帧数、变化次数
 *   - OCR 结果：显示识别文本
 */

import React, { useState, useEffect, useCallback } from 'react';
import { IpcChannel } from '../../shared/types/ipc';

interface MonitorState {
  isActive: boolean;
  frameCount: number;
  changeCount: number;
  lastChangeTime: number;
}

interface VisionPanelProps {
  onClose: () => void;
}

export const VisionPanel: React.FC<VisionPanelProps> = ({ onClose }) => {
  const [monitorState, setMonitorState] = useState<MonitorState | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastOcrText, setLastOcrText] = useState<string | null>(null);

  // 获取当前监控状态
  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await window.nahidaAPI?.invoke(IpcChannel.MONITOR_STATE, {}) as {
          ok: boolean;
          state?: MonitorState;
        } | undefined;
        if (res?.ok && res.state) {
          setMonitorState(res.state);
        }
      } catch (err) {
        console.error('[VisionPanel] get state failed:', err);
      }
    };
    fetchState();
  }, []);

  // 监听监控状态更新
  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('monitor:frame', (payload) => {
      const data = payload as {
        type: 'started' | 'stopped' | 'frame';
        state?: MonitorState;
      };
      if (data.state) {
        setMonitorState(data.state);
      }
    });
    return () => { cleanup?.(); };
  }, []);

  // 监听 OCR 结果
  useEffect(() => {
    const cleanup = window.nahidaAPI?.on('vision:result', (payload) => {
      const data = payload as { ocrText?: string };
      if (data.ocrText) {
        setLastOcrText(data.ocrText);
      }
    });
    return () => { cleanup?.(); };
  }, []);

  // 区域截图
  const handleRegionCapture = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      await window.nahidaAPI?.invoke(IpcChannel.SCREENSHOT_REGION_START, {
        message: '请选择截图区域',
      });
    } catch (err) {
      console.error('[VisionPanel] region capture failed:', err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  // 全屏截图
  const handleFullscreenCapture = useCallback(async () => {
    try {
      await window.nahidaAPI?.invoke(IpcChannel.VISION_ANALYZE, {
        message: '请描述屏幕内容',
      });
    } catch (err) {
      console.error('[VisionPanel] fullscreen capture failed:', err);
    }
  }, []);

  // 启动监控
  const handleStartMonitor = useCallback(async () => {
    try {
      await window.nahidaAPI?.invoke(IpcChannel.MONITOR_START, {
        intervalMs: 2000,
        threshold: 5,
        autoAnalyze: false,
      });
    } catch (err) {
      console.error('[VisionPanel] start monitor failed:', err);
    }
  }, []);

  // 停止监控
  const handleStopMonitor = useCallback(async () => {
    try {
      await window.nahidaAPI?.invoke(IpcChannel.MONITOR_STOP, {});
      setMonitorState(null);
    } catch (err) {
      console.error('[VisionPanel] stop monitor failed:', err);
    }
  }, []);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const panelStyle: React.CSSProperties = {
    width: 400,
    backgroundColor: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(46, 125, 50, 0.25)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const buttonStyle = (primary?: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    border: primary ? 'none' : '1px solid #ccc',
    borderRadius: 6,
    backgroundColor: primary ? '#4caf50' : '#fff',
    color: primary ? '#fff' : '#333',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'all 0.15s',
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={headerStyle}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#2e7d32' }}>
            👁️ 视觉感知
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: '#666',
            }}
          >
            ✕
          </button>
        </div>

        {/* 截图区 */}
        <div style={{ padding: 20 }}>
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>📸 截图</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={buttonStyle(true)}
                onClick={handleRegionCapture}
                disabled={isCapturing}
              >
                <span>🔲</span>
                <span>{isCapturing ? '选择中...' : '区域截图'}</span>
              </button>
              <button
                style={buttonStyle()}
                onClick={handleFullscreenCapture}
              >
                <span>🖥️</span>
                <span>全屏截图</span>
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
              区域截图：框选屏幕区域后自动分析
            </div>
          </section>

          {/* 监控区 */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>📡 屏幕监控</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {monitorState?.isActive ? (
                <>
                  <button
                    style={{ ...buttonStyle(), backgroundColor: '#ffebee', borderColor: '#ef5350', color: '#c62828' }}
                    onClick={handleStopMonitor}
                  >
                    ⏹️ 停止监控
                  </button>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    <div>已捕获 {monitorState.frameCount} 帧</div>
                    <div>检测到 {monitorState.changeCount} 次变化</div>
                  </div>
                </>
              ) : (
                <button style={buttonStyle(true)} onClick={handleStartMonitor}>
                  ▶️ 启动监控
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
              自动监测屏幕变化，每 2 秒采样一次
            </div>
          </section>

          {/* OCR 结果区 */}
          {lastOcrText && (
            <section>
              <h3 style={{ fontSize: 14, color: '#2e7d32', marginBottom: 12 }}>📝 最近识别</h3>
              <div
                style={{
                  padding: 12,
                  backgroundColor: '#f5f5f5',
                  borderRadius: 6,
                  fontSize: 12,
                  maxHeight: 150,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {lastOcrText}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default VisionPanel;