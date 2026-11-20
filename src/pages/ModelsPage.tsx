import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2 } from 'lucide-react';
import { mlApi, ModelInfoResponse, ModelMetricRow } from '../services/api';

export function ModelsPage() {
  const [metrics, setMetrics] = useState<ModelMetricRow[]>([]);
  const [datasetStats, setDatasetStats] = useState<ModelInfoResponse['dataset'] | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('');
  const [inspectModel, setInspectModel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([mlApi.getModelMetrics(), mlApi.getModelInfo()])
      .then(([mRes, infoRes]) => {
        setMetrics(mRes.data.metrics);
        setDatasetStats(infoRes.data.dataset);
        setSelectedModelName(mRes.data.selected_model);
        setInspectModel(mRes.data.selected_model);
      })
      .catch(() => setError('Failed to load model evaluation metrics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
        <div className="h-72 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl border border-rose-500/40 bg-rose-950/30 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  const activeInspect = metrics.find((m) => m.model_name === inspectModel) || metrics[0];
  const cm = activeInspect?.confusion_matrix || [
    [0, 0],
    [0, 0],
  ];

  const chartData = metrics.map((m) => ({
    name: m.model_name,
    Accuracy: Number((m.accuracy * 100).toFixed(2)),
    Precision: Number((m.precision_score * 100).toFixed(2)),
    Recall: Number((m.recall_score * 100).toFixed(2)),
    'F1-Score': Number((m.f1_score * 100).toFixed(2)),
  }));

  return (
    <div className="space-y-6">
      {/* Dataset & Selection Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Best Performing Model</p>
          <p className="mt-2 font-display text-lg font-semibold text-indigo-300">
            {selectedModelName}
          </p>
          <p className="mt-1 text-xs text-slate-500">Selected by validation F1 &amp; ROC-AUC</p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Dataset Size</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
            {datasetStats?.totalRecords.toLocaleString() || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {datasetStats?.spamCount} SPAM · {datasetStats?.hamCount} HAM
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Stratified Split</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-white tabular-nums">
            {datasetStats?.trainSize} / {datasetStats?.testSize}
          </p>
          <p className="mt-1 text-xs text-slate-500">80% Training · 20% Held-out Test</p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">TF-IDF Vocabulary</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-blue-300 tabular-nums">
            {datasetStats?.vocabSize.toLocaleString() || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Unigrams + Bigrams (fitted on train)</p>
        </div>
      </div>

      {/* Algorithm Comparison Table */}
      <div className="rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="font-display text-base font-semibold text-white">
            Algorithm Evaluation Comparison
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Metrics computed strictly on the held-out 20% stratified test split plus 5-fold cross-validation.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                <th className="py-3 px-6">Algorithm</th>
                <th className="py-3 px-4 text-right">Accuracy</th>
                <th className="py-3 px-4 text-right">Precision</th>
                <th className="py-3 px-4 text-right">Recall</th>
                <th className="py-3 px-4 text-right">F1-Score</th>
                <th className="py-3 px-4 text-right">ROC-AUC</th>
                <th className="py-3 px-4 text-right">5-Fold CV</th>
                <th className="py-3 px-6">Probability Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {metrics.map((m) => (
                <tr key={m.id} className="hover:bg-slate-800/35 transition-colors">
                  <td className="py-3.5 px-6 font-medium text-white whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{m.model_name}</span>
                      {m.is_selected && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(m.accuracy * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(m.precision_score * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(m.recall_score * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-indigo-300 tabular-nums">
                    {(m.f1_score * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-blue-300 tabular-nums">
                    {m.roc_auc !== null ? m.roc_auc.toFixed(4) : 'N/A'}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                    {m.cv_accuracy !== null ? `${(m.cv_accuracy * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-400">
                    {m.calibration_note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grouped Bar Chart + Interactive Confusion Matrix Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
          <h3 className="font-display text-sm font-semibold text-white">
            Metric Comparison Across Classifiers (%)
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#94A3B8" fontSize={11} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Legend />
                <Bar dataKey="Accuracy" fill="#6366F1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Precision" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Recall" fill="#10B981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="F1-Score" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-white">
              Confusion Matrix Inspector
            </h3>
            <select
              value={inspectModel}
              onChange={(e) => setInspectModel(e.target.value)}
              aria-label="Select classifier confusion matrix"
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {metrics.map((m) => (
                <option key={m.model_name} value={m.model_name}>
                  {m.model_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center pt-2">
            <div />
            <div className="text-xs text-slate-400">Pred HAM</div>
            <div className="text-xs text-slate-400">Pred SPAM</div>

            <div className="flex items-center justify-end pr-2 text-xs text-slate-400">
              True HAM
            </div>
            <div className="p-4 rounded-lg bg-emerald-950/35 border border-emerald-500/30">
              <p className="text-[11px] text-emerald-300">TN</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[0][0]}</p>
            </div>
            <div className="p-4 rounded-lg bg-amber-950/30 border border-amber-500/30">
              <p className="text-[11px] text-amber-300">FP</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[0][1]}</p>
            </div>

            <div className="flex items-center justify-end pr-2 text-xs text-slate-400">
              True SPAM
            </div>
            <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-500/30">
              <p className="text-[11px] text-rose-300">FN</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[1][0]}</p>
            </div>
            <div className="p-4 rounded-lg bg-indigo-950/40 border border-indigo-500/40">
              <p className="text-[11px] text-indigo-300">TP</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[1][1]}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
