import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';
import { IpcChannel } from '../../shared/types/ipc';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

interface ChartResponse {
  ok: boolean;
  chartData?: {
    dates: string[];
    tokens: number[];
    conversations: number[];
    modelDistribution: { labels: string[]; values: number[] };
  };
}

type ChartType = 'line' | 'bar' | 'pie';

const CHART_COLORS = [
  '#43a047', '#1e88e5', '#fb8c00', '#e53935', '#8e24aa',
  '#00acc1', '#fdd835', '#6d4c41', '#546e7a', '#ec407a',
];

/**
 * Token 统计图表卡片
 *
 * - 渲染 markdown 摘要文本
 * - 通过 IPC 获取 chart 数据，支持折线/柱状/饼图切换
 */
export const StatsCard: React.FC<{ summary: string }> = ({ summary }) => {
  const [chartType, setChartType] = useState<ChartType>('line');
  const [lineData, setLineData] = useState<ChartData<'line'> | null>(null);
  const [barData, setBarData] = useState<ChartData<'bar'> | null>(null);
  const [pieData, setPieData] = useState<ChartData<'pie'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadChart = async () => {
      try {
        const res = await window.nahidaAPI?.invoke(IpcChannel.STATS_GET_CHART, {}) as ChartResponse | undefined;
        if (!res?.ok || !res.chartData) {
          setError('图表数据暂时拿不到');
          return;
        }

        const { dates, tokens, conversations, modelDistribution } = res.chartData;

        setLineData({
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

        setBarData({
          labels: dates,
          datasets: [
            {
              label: 'Token 使用量',
              data: tokens,
              backgroundColor: 'rgba(67, 160, 71, 0.6)',
              borderColor: '#43a047',
              borderWidth: 1,
            },
          ],
        });

        setPieData({
          labels: modelDistribution.labels,
          datasets: [
            {
              data: modelDistribution.values,
              backgroundColor: modelDistribution.labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
              borderColor: '#fff',
              borderWidth: 2,
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

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    border: '1px solid #a5d6a7',
    borderRadius: 4,
    backgroundColor: active ? '#4caf50' : '#fff',
    color: active ? '#fff' : '#2e7d32',
    cursor: 'pointer',
    fontSize: 12,
    marginRight: 6,
  });

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

        {/* 图表切换按钮 */}
        {(lineData || barData || pieData) && (
          <div style={{ marginTop: 12, marginBottom: 8 }}>
            <button style={btnStyle(chartType === 'line')} onClick={() => setChartType('line')}>📈 折线</button>
            <button style={btnStyle(chartType === 'bar')} onClick={() => setChartType('bar')}>📊 柱状</button>
            <button style={btnStyle(chartType === 'pie')} onClick={() => setChartType('pie')}>🥧 饼图</button>
          </div>
        )}

        {chartType === 'line' && lineData && (
          <div style={{ marginTop: 8, height: 220 }}>
            <Line
              data={lineData}
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

        {chartType === 'bar' && barData && (
          <div style={{ marginTop: 8, height: 220 }}>
            <Bar
              data={barData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'top' },
                  title: { display: true, text: '近 30 日 Token 使用量' },
                },
                scales: {
                  x: { grid: { display: false } },
                  y: {
                    display: true,
                    title: { display: true, text: 'Token' },
                  },
                },
              }}
            />
          </div>
        )}

        {chartType === 'pie' && pieData && (
          <div style={{ marginTop: 8, height: 240 }}>
            <Pie
              data={pieData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'right' },
                  title: { display: true, text: '模型使用分布' },
                },
              }}
            />
          </div>
        )}

        {error && !lineData && (
          <div style={{ marginTop: 8, color: '#c62828', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
