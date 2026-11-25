import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ScanSearch } from 'lucide-react';
import { analyticsApi, PredictionRecord } from '../services/api';
import { VerdictLabel } from '../components/VerdictLabel';

interface OverviewData {
  total_analyzed: number;
  total_spam: number;
  total_ham: number;
  spam_percentage: number;
  ham_percentage: number;
  avg_confidence: number;
  avg_processing_time_ms: number;
  latest_predictions: PredictionRecord[];
  active_model: {
    modelName: string;
    accuracy: number;
    precisionScore: number;
    recallScore: number;
    f1Score: number;
    rocAuc: number;
  };
}

export function DashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    analyticsApi
      .overview()
      .then((res) => setData(res.data))
      .catch(() => setError('Unable to load dashboard statistics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-xl border border-rose-500/40 bg-rose-950/30 text-sm text-rose-200">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900/70 backdrop-blur-md border border-slate-800">
          <p className="text-xs font-medium text-slate-400">Total Emails Analyzed</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-white tabular-nums">
            {data.total_analyzed.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
            Avg latency {data.avg_processing_time_ms} ms
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 backdrop-blur-md border border-slate-800">
          <p className="text-xs font-medium text-slate-400">Spam Detected</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-rose-400 tabular-nums">
            {data.total_spam.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            {data.spam_percentage}% of analyzed traffic
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 backdrop-blur-md border border-slate-800">
          <p className="text-xs font-medium text-slate-400">Legitimate Emails (HAM)</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
            {data.total_ham.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            {data.ham_percentage}% of analyzed traffic
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 backdrop-blur-md border border-slate-800">
          <p className="text-xs font-medium text-slate-400">Active Model Performance</p>
          <p className="mt-2 font-display text-lg font-semibold text-indigo-300 truncate">
            {data.active_model.modelName}
          </p>
          <p className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
            Acc {(data.active_model.accuracy * 100).toFixed(1)}% · F1 {(data.active_model.f1Score * 100).toFixed(1)}% · AUC {data.active_model.rocAuc.toFixed(3)}
          </p>
        </div>
      </div>

      {/* Latest Predictions Table + Quick Launch */}
      <div className="rounded-xl bg-slate-900/70 backdrop-blur-md border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Recent Classifications
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Latest email predictions persisted in your database · Avg confidence {data.avg_confidence}%
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/history"
              className="text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap"
            >
              View All History
            </Link>
            <Link
              to="/detect"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap"
            >
              <ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Analysis</span>
            </Link>
          </div>
        </div>

        {data.latest_predictions.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-300">No emails analyzed yet under your account.</p>
            <Link
              to="/detect"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
            >
              <span>Analyze First Email</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                  <th className="py-3 px-6">Subject</th>
                  <th className="py-3 px-4">Verdict</th>
                  <th className="py-3 px-4 text-right">Spam Prob.</th>
                  <th className="py-3 px-4 text-right">Latency</th>
                  <th className="py-3 px-4">Classifier</th>
                  <th className="py-3 px-6 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {data.latest_predictions.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/35 transition-colors">
                    <td className="py-3.5 px-6 max-w-xs">
                      <p className="font-medium text-slate-100 truncate">{row.email_subject}</p>
                      {row.sender_address && (
                        <p className="text-xs text-slate-500 truncate">{row.sender_address}</p>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <VerdictLabel prediction={row.prediction} />
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                      {(row.spam_probability * 100).toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-400 tabular-nums">
                      {row.processing_time.toFixed(2)} ms
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-300 whitespace-nowrap">
                      {row.model_name}
                    </td>
                    <td className="py-3.5 px-6 text-right text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Zero-API-Key AI & ML Capabilities Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/detect"
          className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/40 transition-colors space-y-2"
        >
          <p className="font-display text-sm font-semibold text-white">
            01. Header &amp; Threat Forensics
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Inspect SPF/DKIM/DMARC authentication headers, Reply-To spoofing, sentence-level risk, Soft-Voting Ensemble consensus, and export JSON or printable SOC briefs.
          </p>
        </Link>

        <Link
          to="/models"
          className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/40 transition-colors space-y-2"
        >
          <p className="font-display text-sm font-semibold text-white">
            02. Live ROC &amp; Feature Explorer
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Tune decision thresholds against real held-out ROC curves, simulate confusion matrices in real time, and inspect global SPAM vs. HAM TF-IDF n-gram coefficients.
          </p>
        </Link>

        <Link
          to="/mailbox"
          className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/40 transition-colors space-y-2"
        >
          <p className="font-display text-sm font-semibold text-white">
            03. Active Learning &amp; AI Gatekeeper
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Flag misclassified predictions for human-in-the-loop model retraining, scan batches of 50 emails, or send client mail routed through automatic Spam Quarantine.
          </p>
        </Link>
      </div>
    </div>
  );
}
