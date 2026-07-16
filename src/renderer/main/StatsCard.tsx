import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { IpcChannel } from '../../shared/types/ipc';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

interface ChartResponse {
  ok: boolean;
  chartData?: {
    dates: string[];
    tokens: number[];
    conversations: number[];
  };
}

/**
 * Token 统计图表卡片
 *
 * - 渲染 markdown 摘要文本
 * - 通过 IPC 获取 chart 数据，绘制 7 日 token / 对话数折线图
 */
export const StatsCard: React.FC<{ summary: string }> = ({ summary }) => {
  const [chartData, setChartData] = useState<ChartData<'line'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadChart = async () => {
      try {
        const res = await window.nahidaAPI?.invoke(IpcChannel.STATS_GET_CHART, {}) as ChartResponse | undefined;
        if (!res?.ok || !res.chartData) {
          setError('图表数据暂时拿不到');
          return;
        }

        const { dates, tokens, conversations } = res.chartData;
        setChartData({
          labels: dates,
          datasets: [
            {
              label: 'Token 使用量',
              data: tokens,
              borderColor: '#43a047',
              backgroundColor: 'rgba(67, 160, 71, 0.15)',
              fill: true,
              tension: 0.3,
              yAxisID: 'y',
            },
            {
              label: '对话次数',
              data: conversations,
              borderColor: '#1e88e5',
              backgroundColor: 'rgba(30, 136, 229, 0.15)',
              fill: true,
              tension: 0.3,
              yAxisID: 'y1',
            },
          ],
        });
      } catch (err) {
        console.error('[StatsCard] load chart failed:', err);
        setError('图表加载失败');
      }
    };

    void loadChart();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '14px 16px',
          borderRadius: 12,
          backgroundColor: '#fff',
          border: '1px solid #a5d6a7',
          color: '#1b5e20',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
          }}
        >
          {summary}
        </pre>

        {chartData && (
          <div style={{ marginTop: 12, height: 220 }}>
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: { position: 'top' },
                  title: { display: true, text: '近 30 日 Token / 对话趋势' },
                },
                scales: {
                  x: { grid: { display: false } },
                  y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Token' },
                  },
                  y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: '对话次数' },
                    grid: { drawOnChartArea: false },
                  },
                },
              }}
            />
          </div>
        )}

        {error && !chartData && (
          <div style={{ marginTop: 8, color: '#c62828', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
