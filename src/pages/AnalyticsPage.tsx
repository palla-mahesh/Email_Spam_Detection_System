import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi, mlApi, ModelMetricRow } from '../services/api';

export function AnalyticsPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [distribution, setDistribution] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [trends, setTrends] = useState<
    Array<{ date: string; spam: number; ham: number; total: number; avg_spam_probability: number }>
  >([]);
  const [keywords, setKeywords] = useState<Array<{ term: string; count: number; avg_weight: number }>>([]);
  const [metrics, setMetrics] = useState<ModelMetricRow[]>([]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      const [distRes, trendRes, kwRes, metricsRes] = await Promise.all([
        analyticsApi.distribution(params),
        analyticsApi.trends(params),
        analyticsApi.keywords(params),
        mlApi.getModelMetrics(),
      ]);
      setDistribution(distRes.data.distribution);
      setTrends(trendRes.data.trends);
      setKeywords(kwRes.data.keywords);
      setMetrics(metricsRes.data.metrics);
    } catch {
      setError('Failed to fetch analytics data.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const activeModelMetric = metrics.find((m) => m.is_selected) || metrics[0];
  const cm = activeModelMetric?.confusion_matrix || [
    [0, 0],
    [0, 0],
  ];

  const doughnutModelData = metrics.map((m, idx) => ({
    name: m.model_name,
    f1: Number((m.f1_score * 100).toFixed(2)),
    color: idx === 0 ? '#6366F1' : idx === 1 ? '#3B82F6' : '#8B5CF6',
  }));

  return (
    <div className="space-y-6">
      {/* Date Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Real-Time Detection Analytics
          </h2>
          <p className="text-xs text-slate-400">
            All charts compute dynamically from stored predictions and held-out model evaluation metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Filter start date"
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="Filter end date"
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/40 bg-rose-950/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-80 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Pie Chart: Spam vs Ham */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                01. Spam vs. Legitimate (HAM) Distribution
              </h3>
              <p className="text-xs text-slate-400">Proportion of analyzed emails by predicted class</p>
            </div>
            <div className="h-64">
              {distribution.every((d) => d.value === 0) ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  No prediction data in selected date range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={88}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {distribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#1E293B',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 2. Bar Chart: Daily Spam and Ham Counts */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                02. Daily Spam &amp; Ham Counts
              </h3>
              <p className="text-xs text-slate-400">Daily classification volume stacked by verdict</p>
            </div>
            <div className="h-64">
              {trends.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  No daily volume records in selected date range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} />
                    <YAxis stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#1E293B',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="spam" name="SPAM" fill="#EF4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ham" name="HAM" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 3. Line Chart: Detection Trends */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                03. Detection Volume &amp; Risk Trend
              </h3>
              <p className="text-xs text-slate-400">Total volume vs. average spam probability (%)</p>
            </div>
            <div className="h-64">
              {trends.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  No trend points in selected date range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} />
                    <YAxis stroke="#94A3B8" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#1E293B',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total Analyzed"
                      stroke="#6366F1"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_spam_probability"
                      name="Avg Spam Prob (%)"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 4. Doughnut Chart: Model Performance Comparison */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                04. Model F1-Score Comparison (Doughnut)
              </h3>
              <p className="text-xs text-slate-400">Held-out test F1-scores (%) across trained algorithms</p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={doughnutModelData}
                    dataKey="f1"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={86}
                    label={({ value }) => `${value}%`}
                  >
                    {doughnutModelData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#1E293B',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 5. Confusion Matrix Visualization */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                05. Confusion Matrix — {activeModelMetric?.model_name || 'Selected Model'}
              </h3>
              <p className="text-xs text-slate-400">
                Held-out 20% test split predictions vs. ground truth labels
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div />
              <div className="text-xs font-medium text-slate-400 pb-1">Predicted HAM</div>
              <div className="text-xs font-medium text-slate-400 pb-1">Predicted SPAM</div>

              <div className="flex items-center justify-end pr-2 text-xs font-medium text-slate-400">
                Actual HAM
              </div>
              <div className="p-4 rounded-lg bg-emerald-950/35 border border-emerald-500/30">
                <p className="text-xs text-emerald-300">True Negative</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
                  {cm[0][0]}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-amber-950/30 border border-amber-500/30">
                <p className="text-xs text-amber-300">False Positive</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
                  {cm[0][1]}
                </p>
              </div>

              <div className="flex items-center justify-end pr-2 text-xs font-medium text-slate-400">
                Actual SPAM
              </div>
              <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-500/30">
                <p className="text-xs text-rose-300">False Negative</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
                  {cm[1][0]}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-indigo-950/40 border border-indigo-500/40">
                <p className="text-xs text-indigo-300">True Positive</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
                  {cm[1][1]}
                </p>
              </div>
            </div>
          </div>

          {/* 6. Horizontal Bar Chart: Top Suspicious Keywords */}
          <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                06. Common Suspicious Keywords
              </h3>
              <p className="text-xs text-slate-400">
                Most frequent high-weight tokens extracted from classified SPAM messages
              </p>
            </div>
            <div className="h-64">
              {keywords.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Analyze spam emails to populate keyword frequency rankings.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={keywords} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis type="number" stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="term"
                      stroke="#CBD5E1"
                      fontSize={11}
                      width={110}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#1E293B',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" name="Occurrences" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
