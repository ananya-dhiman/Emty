import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MetricsCharts from '../components/MetricsCharts';
import type { MetricsResult, AggregateMetrics, MetricsInfo } from '../utils/metricsTypes';
import '../styles/MetricsDashboard.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const MetricsDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [aggregateMetrics, setAggregateMetrics] = useState<AggregateMetrics | null>(null);
  const [trend, setTrend] = useState<Array<{ date: string; metrics: MetricsResult }> | null>(null);
  const [metricsInfo, setMetricsInfo] = useState<MetricsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [source, setSource] = useState<'ai_insight' | 'pre_filter' | undefined>(undefined);

  const getAuthToken = (): string | null => {
    return localStorage.getItem('authToken');
  };

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const params: any = {};
      if (startDate) params.startDate = new Date(startDate).toISOString();
      if (endDate) params.endDate = new Date(endDate).toISOString();
      if (source) params.source = source;

      const [metricsRes, aggregateRes, trendRes, infoRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/metrics/ranking-feedback`, { headers, params }),
        axios.get(`${API_BASE_URL}/api/metrics/ranking-feedback/aggregate`, { params }),
        axios.get(`${API_BASE_URL}/api/metrics/ranking-feedback/trend`, {
          headers,
          params: { ...params, granularity },
        }),
        axios.get(`${API_BASE_URL}/api/metrics/ranking-feedback/info`),
      ]);

      setMetrics(metricsRes.data.data);
      setAggregateMetrics(aggregateRes.data.data);
      setTrend(trendRes.data.data);
      setMetricsInfo(infoRes.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch metrics');
      console.error('Error fetching metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [startDate, endDate, granularity, source]);

  const formatPercentage = (value: number | null): string => {
    if (value === null || isNaN(value)) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  if (loading) {
    return <div className="metrics-dashboard loading">Loading metrics...</div>;
  }

  return (
    <div className="metrics-dashboard">
      <h1>Ranking Feedback Metrics</h1>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-section">
        <h2>Filters</h2>
        <div className="filters-grid">
          <div className="filter-group">
            <label htmlFor="startDate">Start Date</label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="endDate">End Date</label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="granularity">Granularity</label>
            <select
              id="granularity"
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as any)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="source">Source</label>
            <select
              id="source"
              value={source || ''}
              onChange={(e) => setSource(e.target.value ? (e.target.value as any) : undefined)}
            >
              <option value="">All Sources</option>
              <option value="ai_insight">AI Insight</option>
              <option value="pre_filter">Pre-Filter</option>
            </select>
          </div>
        </div>
      </div>

      {metrics && (
        <div className="metrics-cards-section">
          <h2>Your Metrics</h2>
          <div className="metrics-cards">
            <div className="metric-card">
              <h3>Precision</h3>
              <div className="metric-value">{formatPercentage(metrics.precision)}</div>
              <p className="metric-description">
                Of all "boost" signals predicted, what % were beneficial?
              </p>
            </div>
            <div className="metric-card">
              <h3>Recall</h3>
              <div className="metric-value">{formatPercentage(metrics.recall)}</div>
              <p className="metric-description">
                Of all emails you suppressed, what % did we predict?
              </p>
            </div>
            <div className="metric-card">
              <h3>F1 Score</h3>
              <div className="metric-value">{formatPercentage(metrics.f1Score)}</div>
              <p className="metric-description">
                Balanced score of precision and recall
              </p>
            </div>
            <div className="metric-card">
              <h3>Total Feedback</h3>
              <div className="metric-value">{metrics.totalFeedback}</div>
              <p className="metric-description">
                Boost: {metrics.boostCount} | Suppress: {metrics.suppressCount} | None: {metrics.noneCount}
              </p>
            </div>
          </div>
        </div>
      )}

      {aggregateMetrics && (
        <div className="aggregate-metrics-section">
          <h2>System-Wide Metrics</h2>
          <div className="metrics-cards">
            <div className="metric-card aggregate">
              <h3>Global Precision</h3>
              <div className="metric-value">{formatPercentage(aggregateMetrics.globalPrecision)}</div>
            </div>
            <div className="metric-card aggregate">
              <h3>Global Recall</h3>
              <div className="metric-value">{formatPercentage(aggregateMetrics.globalRecall)}</div>
            </div>
            <div className="metric-card aggregate">
              <h3>Global F1</h3>
              <div className="metric-value">{formatPercentage(aggregateMetrics.globalF1Score)}</div>
            </div>
            <div className="metric-card aggregate">
              <h3>Total Feedback</h3>
              <div className="metric-value">{aggregateMetrics.totalFeedbackAcrossUsers}</div>
              <p className="metric-description">Across {aggregateMetrics.uniqueUsers} users</p>
            </div>
          </div>
        </div>
      )}

      {(metrics || aggregateMetrics || trend) && (
        <div className="charts-section">
          <h2>Visualizations</h2>
          <MetricsCharts metrics={metrics || undefined} aggregateMetrics={aggregateMetrics || undefined} trend={trend || undefined} />
        </div>
      )}

      {metricsInfo && (
        <div className="info-section">
          <h2>What Do These Metrics Mean?</h2>
          <div className="info-grid">
            <div className="info-card">
              <h3>📊 Precision</h3>
              <p><strong>Definition:</strong> {metricsInfo.metrics.precision.definition}</p>
              <p><strong>Formula:</strong> {metricsInfo.metrics.precision.formula}</p>
              <p><strong>Interpretation:</strong> {metricsInfo.metrics.precision.interpretation}</p>
              <p><strong>Range:</strong> {metricsInfo.metrics.precision.range}</p>
            </div>
            <div className="info-card">
              <h3>🎯 Recall</h3>
              <p><strong>Definition:</strong> {metricsInfo.metrics.recall.definition}</p>
              <p><strong>Formula:</strong> {metricsInfo.metrics.recall.formula}</p>
              <p><strong>Interpretation:</strong> {metricsInfo.metrics.recall.interpretation}</p>
              <p><strong>Range:</strong> {metricsInfo.metrics.recall.range}</p>
            </div>
            <div className="info-card">
              <h3>⚖️ F1 Score</h3>
              <p><strong>Definition:</strong> {metricsInfo.metrics.f1Score.definition}</p>
              <p><strong>Formula:</strong> {metricsInfo.metrics.f1Score.formula}</p>
              <p><strong>Interpretation:</strong> {metricsInfo.metrics.f1Score.interpretation}</p>
              <p><strong>Range:</strong> {metricsInfo.metrics.f1Score.range}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MetricsDashboard;
