import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, Sparkles, Upload, XCircle } from 'lucide-react';
import {
  adminApi,
  feedbackApi,
  FeedbackSample,
  mlApi,
  ModelMetricRow,
  RetrainFeedbackResponse,
  UserProfile,
} from '../services/api';

interface AdminDashboardData {
  total_users: number;
  total_predictions: number;
  total_spam: number;
  total_ham: number;
  total_datasets: number;
  active_model: string;
  model_metrics: ModelMetricRow[];
}

export function AdminPage() {
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [users, setUsers] = useState<Array<UserProfile & { prediction_count: number }>>([]);
  const [datasets, setDatasets] = useState<
    Array<{
      id: string;
      dataset_name: string;
      total_records: number;
      spam_count: number;
      ham_count: number;
      uploaded_by_name: string | null;
      uploaded_at: string;
    }>
  >([]);
  const [activities, setActivities] = useState<
    Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      activity_type: string;
      description: string;
      created_at: string;
    }>
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // Active Learning feedback state
  const [feedbackItems, setFeedbackItems] = useState<FeedbackSample[]>([]);
  const [feedbackCounts, setFeedbackCounts] = useState({ pending: 0, applied: 0, dismissed: 0 });
  const [retrainingFeedback, setRetrainingFeedback] = useState(false);
  const [retrainReport, setRetrainReport] = useState<RetrainFeedbackResponse | null>(null);

  // CSV upload state
  const [datasetName, setDatasetName] = useState('custom_spam_corpus.csv');
  const [csvContent, setCsvContent] = useState('');
  const [retrainOnUpload, setRetrainOnUpload] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [retraining, setRetraining] = useState(false);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashRes, usersRes, dsRes, actRes, fbRes] = await Promise.all([
        adminApi.dashboard(),
        adminApi.users(),
        adminApi.datasets(),
        adminApi.activity(),
        feedbackApi.list('ALL'),
      ]);
      setDashboard(dashRes.data);
      setUsers(usersRes.data.users);
      setDatasets(dsRes.data.datasets);
      setActivities(actRes.data.activities);
      setFeedbackItems(fbRes.data.items);
      setFeedbackCounts(fbRes.data.counts);
    } catch {
      setError('Unable to load administrator telemetry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDatasetName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvContent(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  };

  const handleUploadDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusMessage('');
    if (!csvContent.trim()) {
      setError('Please select a CSV file or paste CSV content with label and text columns.');
      return;
    }

    setUploading(true);
    try {
      const { data } = await adminApi.uploadDataset({
        dataset_name: datasetName.trim() || 'uploaded_dataset.csv',
        csv_content: csvContent,
        retrain: retrainOnUpload,
      });
      setStatusMessage(
        `${data.message} (${data.total_records} rows: ${data.spam_count} SPAM, ${data.ham_count} HAM. Selected: ${data.selected_model})`
      );
      setCsvContent('');
      await loadAdminData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Dataset upload failed validation.';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleRetrainDefault = async () => {
    setError('');
    setStatusMessage('');
    setRetraining(true);
    try {
      const { data } = await mlApi.retrain();
      setStatusMessage(`Retrained pipeline successfully. Active model: ${data.selected_model}`);
      await loadAdminData();
    } catch {
      setError('Failed to retrain default pipeline.');
    } finally {
      setRetraining(false);
    }
  };

  const handleToggleRole = async (u: UserProfile) => {
    setError('');
    const nextRole = u.role === 'admin' ? 'user' : 'admin';
    try {
      await adminApi.updateUserRole(u.id, nextRole);
      await loadAdminData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Unable to update user role.';
      setError(msg);
    }
  };

  const handleUpdateFeedbackStatus = async (
    item: FeedbackSample,
    nextStatus: 'pending' | 'dismissed'
  ) => {
    setError('');
    try {
      await feedbackApi.update(item.id, { status: nextStatus });
      await loadAdminData();
    } catch {
      setError('Failed to update feedback sample status.');
    }
  };

  const handleRetrainWithFeedback = async () => {
    setError('');
    setStatusMessage('');
    setRetrainingFeedback(true);
    try {
      const { data } = await feedbackApi.retrain();
      setRetrainReport(data);
      setStatusMessage(data.message);
      await loadAdminData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Active Learning retraining failed.';
      setError(msg);
    } finally {
      setRetrainingFeedback(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
          ))}
        </div>
        <div className="h-80 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/40 bg-rose-950/30 text-sm text-rose-200">
          {error}
        </div>
      )}
      {statusMessage && (
        <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-sm text-emerald-200">
          {statusMessage}
        </div>
      )}

      {/* System KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Total Users</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-white tabular-nums">
            {dashboard?.total_users ?? 0}
          </p>
        </div>
        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Total Predictions (All Users)</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-indigo-300 tabular-nums">
            {dashboard?.total_predictions ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {dashboard?.total_spam ?? 0} SPAM · {dashboard?.total_ham ?? 0} HAM
          </p>
        </div>
        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800">
          <p className="text-xs text-slate-400">Registered Datasets</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-white tabular-nums">
            {dashboard?.total_datasets ?? 0}
          </p>
        </div>
        <div className="p-5 rounded-xl bg-slate-900/75 border border-slate-800 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-400">Active Classifier</p>
            <p className="mt-1.5 font-display text-base font-semibold text-white truncate">
              {dashboard?.active_model}
            </p>
          </div>
          <button
            type="button"
            disabled={retraining}
            onClick={handleRetrainDefault}
            className="mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} />
            <span>{retraining ? 'Retraining...' : 'Retrain Corpus'}</span>
          </button>
        </div>
      </div>

      {/* Active Learning Feedback Queue & Incremental Retraining Lab */}
      <div className="rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Active Learning Feedback Queue &amp; Live Model Retraining
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              {feedbackCounts.pending} Pending · {feedbackCounts.applied} Applied ·{' '}
              {feedbackCounts.dismissed} Dismissed
            </p>
          </div>
          <button
            type="button"
            disabled={retrainingFeedback}
            onClick={handleRetrainWithFeedback}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {retrainingFeedback ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {retrainingFeedback ? 'Retraining with Feedback...' : 'Retrain Pipeline with Feedback'}
            </span>
          </button>
        </div>

        {retrainReport && (
          <div className="px-6 py-4 bg-indigo-950/25 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-slate-400">Training Corpus</p>
              <p className="mt-1 font-mono font-semibold text-white tabular-nums">
                {retrainReport.before.total_records} &rarr; {retrainReport.after.total_records} rows
              </p>
            </div>
            <div>
              <p className="text-slate-400">Validation Accuracy</p>
              <p className="mt-1 font-mono font-semibold text-white tabular-nums">
                {(retrainReport.before.accuracy * 100).toFixed(2)}% &rarr;{' '}
                {(retrainReport.after.accuracy * 100).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-slate-400">Validation F1-Score</p>
              <p className="mt-1 font-mono font-semibold text-indigo-300 tabular-nums">
                {(retrainReport.before.f1_score * 100).toFixed(2)}% &rarr;{' '}
                {(retrainReport.after.f1_score * 100).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-slate-400">Active Model</p>
              <p className="mt-1 font-semibold text-emerald-300">{retrainReport.after.selected_model}</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          {feedbackItems.length === 0 ? (
            <p className="px-6 py-8 text-xs text-slate-500 text-center">
              No feedback corrections queued yet. Flag misclassified emails from Detection or History to refine the corpus.
            </p>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-3 px-6">Email Sample &amp; Notes</th>
                  <th className="py-3 px-4">Label Correction</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Submitted By</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {feedbackItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/35">
                    <td className="py-3 px-6 max-w-md">
                      <p className="font-medium text-slate-100 truncate">{item.email_subject}</p>
                      {item.sender_address && (
                        <p className="text-slate-500 truncate">{item.sender_address}</p>
                      )}
                      {item.notes && <p className="text-slate-400 mt-0.5 truncate">{item.notes}</p>}
                    </td>
                    <td className="py-3 px-4 font-mono whitespace-nowrap">
                      <span className="text-slate-400">{item.original_prediction}</span>
                      <span className="mx-1.5 text-slate-600">&rarr;</span>
                      <span
                        className={
                          item.corrected_label === 'SPAM'
                            ? 'text-rose-400 font-semibold'
                            : 'text-emerald-400 font-semibold'
                        }
                      >
                        {item.corrected_label}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono">
                      {item.status === 'applied' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Applied</span>
                        </span>
                      ) : item.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Pending</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Dismissed</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {item.submitted_by_email || 'Analyst'}
                    </td>
                    <td className="py-3 px-6 text-right whitespace-nowrap">
                      {item.status !== 'dismissed' ? (
                        <button
                          type="button"
                          onClick={() => handleUpdateFeedbackStatus(item, 'dismissed')}
                          className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
                        >
                          Dismiss
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUpdateFeedbackStatus(item, 'pending')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Re-Queue</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Dataset Upload & Retraining + Dataset Registry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleUploadDataset}
          className="lg:col-span-5 p-6 rounded-xl bg-slate-900/75 border border-slate-800 space-y-4"
        >
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Upload CSV Dataset &amp; Retrain
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Requires <code className="font-mono text-slate-300">label</code> (spam/ham) and{' '}
              <code className="font-mono text-slate-300">text</code> columns (min 20 rows).
            </p>
          </div>

          <div>
            <label htmlFor="dsName" className="block text-xs font-medium text-slate-300 mb-1">
              Dataset Name
            </label>
            <input
              id="dsName"
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="csvFile" className="block text-xs font-medium text-slate-300 mb-1">
              Select CSV File
            </label>
            <input
              id="csvFile"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-700 file:text-xs file:font-medium file:bg-slate-950 file:text-slate-200 hover:file:bg-slate-800"
            />
          </div>

          <div>
            <label htmlFor="csvText" className="block text-xs font-medium text-slate-300 mb-1">
              Or Paste CSV Preview
            </label>
            <textarea
              id="csvText"
              rows={4}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder={'label,text\nspam,"Win a free $500 gift card now"\nham,"Meeting moved to 3pm tomorrow"'}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={retrainOnUpload}
              onChange={(e) => setRetrainOnUpload(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-indigo-600"
            />
            <span>Retrain and evaluate all 3 ML models immediately</span>
          </label>

          <button
            type="submit"
            disabled={uploading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Validating & Training...' : 'Upload Dataset'}</span>
          </button>
        </form>

        {/* Registered Datasets */}
        <div className="lg:col-span-7 rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-display text-base font-semibold text-white">
              Dataset Registry
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-3 px-6">Dataset</th>
                  <th className="py-3 px-4 text-right">Records</th>
                  <th className="py-3 px-4 text-right">SPAM / HAM</th>
                  <th className="py-3 px-6 text-right">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {datasets.map((ds) => (
                  <tr key={ds.id} className="hover:bg-slate-800/35">
                    <td className="py-3 px-6 font-medium text-slate-200">{ds.dataset_name}</td>
                    <td className="py-3 px-4 text-right font-mono text-white tabular-nums">
                      {ds.total_records.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                      {ds.spam_count} / {ds.ham_count}
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-slate-400 tabular-nums">
                      {new Date(ds.uploaded_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* User Management & Audit Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-display text-base font-semibold text-white">
              User Management
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-3 px-6">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4 text-right">Predictions</th>
                  <th className="py-3 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/35">
                    <td className="py-3 px-6">
                      <p className="font-medium text-slate-200">{u.full_name}</p>
                      <p className="text-slate-500">{u.email}</p>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{u.role}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-200 tabular-nums">
                      {u.prediction_count}
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleRole(u)}
                        className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors whitespace-nowrap"
                      >
                        {u.role === 'admin' ? 'Set User' : 'Make Admin'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-display text-base font-semibold text-white">
              System Audit Activity
            </h2>
          </div>
          <div className="divide-y divide-slate-800/70 max-h-96 overflow-y-auto">
            {activities.map((act) => (
              <div key={act.id} className="px-6 py-3 space-y-0.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium text-indigo-300">
                    {act.activity_type}
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {new Date(act.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-slate-300">{act.description}</p>
                {act.email && <p className="text-slate-500">{act.email}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
