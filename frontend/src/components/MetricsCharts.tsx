import React from 'react';
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
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';
import { MetricsResult, AggregateMetrics } from '../utils/metricsTypes';
import '../styles/MetricsCharts.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface MetricsChartsProps {
  metrics?: MetricsResult;
  aggregateMetrics?: AggregateMetrics;
  trend?: Array<{ date: string; metrics: MetricsResult }>;
}

export const MetricsCharts: React.FC<MetricsChartsProps> = ({
  metrics,
  aggregateMetrics,
  trend,
}) => {
  // Chart: Precision, Recall, F1 Score comparison
  const performanceChartData = {
    labels: ['Precision', 'Recall', 'F1 Score'],
    datasets: [
      {
        label: 'Score',
        data: [
          metrics?.precision ?? 0,
          metrics?.recall ?? 0,
          metrics?.f1Score ?? 0,
        ],
        backgroundColor: [
          'rgba(75, 192, 192, 0.6)',
          'rgba(54, 162, 235, 0.6)',
          'rgba(153, 102, 255, 0.6)',
        ],
        borderColor: [
          'rgba(75, 192, 192, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(153, 102, 255, 1)',
        ],
        borderWidth: 1,
      },
    ],
  };

  // Chart: Signal distribution
  const signalDistributionData = {
    labels: ['Boost', 'Suppress', 'None'],
    datasets: [
      {
        label: 'Signal Count',
        data: [
          metrics?.boostCount ?? 0,
          metrics?.suppressCount ?? 0,
          metrics?.noneCount ?? 0,
        ],
        backgroundColor: [
          'rgba(255, 159, 64, 0.6)',
          'rgba(255, 99, 132, 0.6)',
          'rgba(201, 203, 207, 0.6)',
        ],
        borderColor: [
          'rgba(255, 159, 64, 1)',
          'rgba(255, 99, 132, 1)',
          'rgba(201, 203, 207, 1)',
        ],
        borderWidth: 1,
      },
    ],
  };

  // Chart: Source comparison
  const sourceComparisonData = {
    labels: ['AI Insight', 'Pre-Filter'],
    datasets: [
      {
        label: 'Precision',
        data: [
          aggregateMetrics?.bySource.ai_insight.precision ?? 0,
          aggregateMetrics?.bySource.pre_filter.precision ?? 0,
        ],
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1,
      },
      {
        label: 'Recall',
        data: [
          aggregateMetrics?.bySource.ai_insight.recall ?? 0,
          aggregateMetrics?.bySource.pre_filter.recall ?? 0,
        ],
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      },
    ],
  };

  // Chart: Metrics trend over time
  const trendChartData = {
    labels: trend?.map((item) => item.date) || [],
    datasets: [
      {
        label: 'Precision',
        data: trend?.map((item) => item.metrics.precision ?? 0) || [],
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        tension: 0.3,
      },
      {
        label: 'Recall',
        data: trend?.map((item) => item.metrics.recall ?? 0) || [],
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.1)',
        tension: 0.3,
      },
      {
        label: 'F1 Score',
        data: trend?.map((item) => item.metrics.f1Score ?? 0) || [],
        borderColor: 'rgba(153, 102, 255, 1)',
        backgroundColor: 'rgba(153, 102, 255, 0.1)',
        tension: 0.3,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 1,
      },
    },
  };

  return (
    <div className="metrics-charts-container">
      {metrics && (
        <>
          <div className="chart-wrapper">
            <h3>Performance Metrics</h3>
            <Bar data={performanceChartData} options={chartOptions} />
          </div>

          <div className="chart-wrapper">
            <h3>Signal Distribution</h3>
            <Pie data={signalDistributionData} options={{
              responsive: true,
              maintainAspectRatio: true,
              plugins: {
                legend: {
                  position: 'bottom' as const,
                },
              },
            }} />
          </div>
        </>
      )}

      {aggregateMetrics && (
        <div className="chart-wrapper">
          <h3>Metrics by Source</h3>
          <Bar data={sourceComparisonData} options={chartOptions} />
        </div>
      )}

      {trend && trend.length > 0 && (
        <div className="chart-wrapper full-width">
          <h3>Metrics Trend Over Time</h3>
          <Line data={trendChartData} options={{
            ...chartOptions,
            scales: {
              y: {
                beginAtZero: true,
                max: 1,
              },
            },
          }} />
        </div>
      )}
    </div>
  );
};

export default MetricsCharts;
