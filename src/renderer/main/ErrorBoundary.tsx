import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React 错误边界 —— 捕获子组件渲染异常，渲染降级 UI
 *
 * 用途：
 *   - 防止 IPC 异常 / 数据格式错误把整个窗口变白屏
 *   - 渲染层在主进程 IPC 链路断掉时仍能给出可读提示
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] caught error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            background: 'linear-gradient(180deg, #f3f7f1 0%, #e8f1f4 100%)',
            color: '#2e3a32',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌿</div>
          <h2 style={{ color: '#2e7d32', marginBottom: 8, fontWeight: 600 }}>
            （花冠微颤）……界面出错了
          </h2>
          <p style={{ color: '#7a8d72', marginBottom: 16, fontSize: 14 }}>
            错误已记录，试试重启应用或者点击下方按钮恢复。
          </p>
          <pre
            style={{
              maxWidth: '80%',
              padding: 12,
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid #d9e4d4',
              borderRadius: 8,
              fontSize: 11,
              color: '#c62828',
              overflow: 'auto',
              maxHeight: 200,
            }}
          >
            {this.state.error?.message ?? 'Unknown error'}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16,
              padding: '8px 20px',
              border: 'none',
              borderRadius: 16,
              background: 'linear-gradient(135deg, #81c784 0%, #aed581 100%)',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(129, 199, 132, 0.4)',
            }}
          >
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
