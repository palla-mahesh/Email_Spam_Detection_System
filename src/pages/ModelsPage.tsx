import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { CheckCircle2, Search, SlidersHorizontal } from 'lucide-react';
import {
  EnsembleEvaluation,
  FeatureWeightItem,
  mlApi,
  ModelInfoResponse,
  ModelMetricRow,
  ModelRocCurve,
} from '../services/api';

const CURVE_COLORS: Record<string, string> = {
  'Multinomial Naive Bayes': '#38BDF8',
  'Logistic Regression': '#10B981',
  'Linear SVM': '#6366F1',
  'Soft-Voting Ensemble': '#F59E0B',
};

export function ModelsPage() {
  const [metrics, setMetrics] = useState<ModelMetricRow[]>([]);
  const [ensembleEval, setEnsembleEval] = useState<EnsembleEvaluation | null>(null);
  const [rocCurves, setRocCurves] = useState<ModelRocCurve[]>([]);
  const [topSpam, setTopSpam] = useState<FeatureWeightItem[]>([]);
  const [topHam, setTopHam] = useState<FeatureWeightItem[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [featureQuery, setFeatureQuery] = useState('');
  const [searchingFeatures, setSearchingFeatures] = useState(false);

  const [datasetStats, setDatasetStats] = useState<ModelInfoResponse['dataset'] | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('');
  const [inspectModel, setInspectModel] = useState<string>('');
  const [simThreshold, setSimThreshold] = useState<number>(0.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([mlApi.getModelMetrics(), mlApi.getModelInfo()])
      .then(([mRes, infoRes]) => {
        setMetrics(mRes.data.metrics);
        setEnsembleEval(mRes.data.ensemble_evaluation || null);
        setRocCurves(mRes.data.roc_curves || []);
        setTopSpam(mRes.data.feature_importance?.topSpam || []);
        setTopHam(mRes.data.feature_importance?.topHam || []);
        setTotalMatches(infoRes.data.dataset.vocabSize || 0);
        setDatasetStats(infoRes.data.dataset);
        setSelectedModelName(mRes.data.selected_model);
        setInspectModel(mRes.data.selected_model);
      })
      .catch(() => setError('Failed to load model evaluation metrics.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchingFeatures(true);
      mlApi
        .getFeatures(featureQuery.trim(), 15)
        .then((res) => {
          setTopSpam(res.data.top_spam);
          setTopHam(res.data.top_ham);
          setTotalMatches(res.data.total_matches);
        })
        .catch(() => {
          // Retain current feature weights on transient error
        })
        .finally(() => setSearchingFeatures(false));
    }, 180);

    return () => clearTimeout(timer);
  }, [featureQuery]);

  const sortedCurves = useMemo(() => {
    return rocCurves.map((c) => ({
      ...c,
      sortedPoints: [...c.points].sort((a, b) => a.fpr - b.fpr || a.tpr - b.tpr),
    }));
  }, [rocCurves]);

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

  const allModelsForSelect = [
    ...metrics.map((m) => m.model_name),
    ...(ensembleEval ? [ensembleEval.modelName] : []),
  ];

  const activeCurve =
    rocCurves.find((c) => c.modelName === inspectModel) || rocCurves[0];
  const simulatedPoint =
    activeCurve?.points.find((p) => Math.abs(p.threshold - simThreshold) < 0.001) ||
    activeCurve?.points.find((p) => Math.abs(p.threshold - 0.5) < 0.001);

  const cm: [[number, number], [number, number]] = simulatedPoint
    ? [
        [simulatedPoint.tn, simulatedPoint.fp],
        [simulatedPoint.fn, simulatedPoint.tp],
      ]
    : [
        [0, 0],
        [0, 0],
      ];

  const chartData = [
    ...metrics.map((m) => ({
      name: m.model_name,
      Accuracy: Number((m.accuracy * 100).toFixed(2)),
      Precision: Number((m.precision_score * 100).toFixed(2)),
      Recall: Number((m.recall_score * 100).toFixed(2)),
      'F1-Score': Number((m.f1_score * 100).toFixed(2)),
    })),
    ...(ensembleEval
      ? [
          {
            name: 'Soft-Voting Ensemble',
            Accuracy: Number((ensembleEval.accuracy * 100).toFixed(2)),
            Precision: Number((ensembleEval.precisionScore * 100).toFixed(2)),
            Recall: Number((ensembleEval.recallScore * 100).toFixed(2)),
            'F1-Score': Number((ensembleEval.f1Score * 100).toFixed(2)),
          },
        ]
      : []),
  ];

  const maxSpamWeight = Math.max(0.01, ...topSpam.map((i) => Math.abs(i.spamWeight)));
  const maxHamWeight = Math.max(0.01, ...topHam.map((i) => Math.abs(i.spamWeight)));

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

      {/* Algorithm Comparison Table (3 Individual Models + Soft-Voting Ensemble) */}
      <div className="rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="font-display text-base font-semibold text-white">
            Algorithm Evaluation &amp; Soft-Voting Ensemble Comparison
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
                <th className="py-3 px-6">Probability Calibration</th>
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
              {ensembleEval && (
                <tr className="bg-indigo-950/20 hover:bg-indigo-950/35 transition-colors">
                  <td className="py-3.5 px-6 font-medium text-amber-200 whitespace-nowrap">
                    {ensembleEval.modelName}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(ensembleEval.accuracy * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(ensembleEval.precisionScore * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                    {(ensembleEval.recallScore * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-amber-300 tabular-nums">
                    {(ensembleEval.f1Score * 100).toFixed(2)}%
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-blue-300 tabular-nums">
                    {ensembleEval.rocAuc.toFixed(4)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-400 tabular-nums">
                    Consensus
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-400">
                    {ensembleEval.calibrationNote}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live ROC Curve & Interactive Decision Threshold Tuner */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Held-Out ROC Curve Comparison (TPR vs. FPR)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                True Positive Rate against False Positive Rate evaluated across 21 probability thresholds.
              </p>
            </div>
            {activeCurve && (
              <span className="font-mono text-xs text-indigo-300 tabular-nums">
                {activeCurve.modelName} AUC: {activeCurve.rocAuc.toFixed(4)}
              </span>
            )}
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  type="number"
                  dataKey="fpr"
                  name="False Positive Rate"
                  domain={[0, 1]}
                  stroke="#94A3B8"
                  fontSize={11}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <YAxis
                  type="number"
                  dataKey="tpr"
                  name="True Positive Rate"
                  domain={[0, 1]}
                  stroke="#94A3B8"
                  fontSize={11}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <ZAxis range={[22, 22]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: '#475569' }}
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#1E293B',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                  formatter={(value: unknown, name: unknown) => [
                    typeof value === 'number' ? value.toFixed(3) : String(value),
                    String(name),
                  ]}
                />
                <Legend />
                <Scatter
                  name="Random Baseline (AUC 0.50)"
                  data={[
                    { fpr: 0, tpr: 0 },
                    { fpr: 1, tpr: 1 },
                  ]}
                  fill="#475569"
                  line={{ stroke: '#475569', strokeDasharray: '5 5', strokeWidth: 1.5 }}
                  lineType="joint"
                  shape="circle"
                />
                {sortedCurves.map((curve) => (
                  <Scatter
                    key={curve.modelName}
                    name={`${curve.modelName} (${curve.rocAuc.toFixed(3)})`}
                    data={curve.sortedPoints}
                    fill={CURVE_COLORS[curve.modelName] || '#6366F1'}
                    line={{
                      stroke: CURVE_COLORS[curve.modelName] || '#6366F1',
                      strokeWidth: curve.modelName === inspectModel ? 2.8 : 1.7,
                    }}
                    lineType="joint"
                  />
                ))}
                {simulatedPoint && (
                  <Scatter
                    name={`Operating Point (t=${simThreshold.toFixed(2)})`}
                    data={[simulatedPoint]}
                    fill="#FFFFFF"
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Interactive Decision Threshold Simulator + Confusion Matrix */}
        <div className="lg:col-span-5 p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
              <h3 className="font-display text-sm font-semibold text-white">
                Decision Threshold Tuner
              </h3>
            </div>
            <select
              value={inspectModel}
              onChange={(e) => setInspectModel(e.target.value)}
              aria-label="Select classifier for threshold simulation"
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {allModelsForSelect.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/75 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Simulated Classification Threshold</span>
              <span className="font-mono font-semibold text-indigo-300 tabular-nums">
                {simThreshold.toFixed(2)} ({(simThreshold * 100).toFixed(0)}%)
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={simThreshold}
              onChange={(e) => setSimThreshold(Number(e.target.value))}
              aria-label="Simulate validation threshold"
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="grid grid-cols-4 gap-2 pt-1 text-center text-xs">
              <div>
                <p className="text-slate-500">Acc</p>
                <p className="font-mono font-semibold text-white tabular-nums">
                  {simulatedPoint ? `${(simulatedPoint.accuracy * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Prec</p>
                <p className="font-mono font-semibold text-blue-300 tabular-nums">
                  {simulatedPoint ? `${(simulatedPoint.precision * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Recall</p>
                <p className="font-mono font-semibold text-emerald-300 tabular-nums">
                  {simulatedPoint ? `${(simulatedPoint.recall * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">F1</p>
                <p className="font-mono font-semibold text-indigo-300 tabular-nums">
                  {simulatedPoint ? `${(simulatedPoint.f1 * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div />
            <div className="text-xs text-slate-400">Pred HAM</div>
            <div className="text-xs text-slate-400">Pred SPAM</div>

            <div className="flex items-center justify-end pr-2 text-xs text-slate-400">
              True HAM
            </div>
            <div className="p-3.5 rounded-lg bg-emerald-950/35 border border-emerald-500/30">
              <p className="text-[11px] text-emerald-300">TN</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[0][0]}</p>
            </div>
            <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-500/30">
              <p className="text-[11px] text-amber-300">FP</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[0][1]}</p>
            </div>

            <div className="flex items-center justify-end pr-2 text-xs text-slate-400">
              True SPAM
            </div>
            <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-500/30">
              <p className="text-[11px] text-rose-300">FN</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[1][0]}</p>
            </div>
            <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-500/40">
              <p className="text-[11px] text-indigo-300">TP</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">{cm[1][1]}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Grouped Bar Chart */}
      <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4">
        <h3 className="font-display text-sm font-semibold text-white">
          Metric Comparison Across Classifiers &amp; Ensemble (%)
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

      {/* Global Feature Importance Explorer */}
      <div className="p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              Global Feature Importance Explorer (TF-IDF N-Gram Weights)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect strongest learned SPAM vs. legitimate HAM token coefficients across Logistic Regression, Linear SVM, and Naive Bayes log-odds.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={featureQuery}
              onChange={(e) => setFeatureQuery(e.target.value)}
              placeholder="Filter n-grams (e.g., bank, verify)..."
              aria-label="Filter vocabulary n-grams"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
          <span>
            {searchingFeatures
              ? 'Querying vocabulary weights...'
              : `Matching features: ${totalMatches.toLocaleString()}`}
          </span>
          <span>Composite Weight = 0.45·LR + 0.35·SVM + 0.20·NB</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top SPAM Indicators */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-rose-300">
              Top Positive SPAM Indicators (+)
            </p>
            {topSpam.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No matching SPAM-weighted tokens.</p>
            ) : (
              <div className="space-y-2">
                {topSpam.map((item) => (
                  <div key={item.term} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-200">{item.term}</span>
                      <span className="font-mono text-rose-300 tabular-nums">
                        +{item.spamWeight.toFixed(3)} · LR {item.lrWeight.toFixed(2)} · SVM{' '}
                        {item.svmWeight.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{
                          width: `${Math.max(6, (Math.abs(item.spamWeight) / maxSpamWeight) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Legitimate HAM Indicators */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-emerald-300">
              Top Protective HAM Indicators (−)
            </p>
            {topHam.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No matching HAM-weighted tokens.</p>
            ) : (
              <div className="space-y-2">
                {topHam.map((item) => (
                  <div key={item.term} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-200">{item.term}</span>
                      <span className="font-mono text-emerald-300 tabular-nums">
                        {item.spamWeight.toFixed(3)} · LR {item.lrWeight.toFixed(2)} · SVM{' '}
                        {item.svmWeight.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{
                          width: `${Math.max(6, (Math.abs(item.spamWeight) / maxHamWeight) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
