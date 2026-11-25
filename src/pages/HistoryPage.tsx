import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Flag, Search, Trash2, X } from 'lucide-react';
import { feedbackApi, historyApi, PredictionRecord } from '../services/api';
import { VerdictLabel } from '../components/VerdictLabel';

export function HistoryPage() {
  const [items, setItems] = useState<PredictionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [predictionFilter, setPredictionFilter] = useState<'ALL' | 'SPAM' | 'HAM'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedRecord, setSelectedRecord] = useState<PredictionRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PredictionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState('');

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await historyApi.list({
        search: search.trim() || undefined,
        prediction: predictionFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
        limit: 8,
      });
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch {
      setError('Failed to load prediction history.');
    } finally {
      setLoading(false);
    }
  }, [search, predictionFilter, startDate, endDate, page]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await historyApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      if (selectedRecord?.id === deleteTarget.id) {
        setSelectedRecord(null);
      }
      await fetchHistory();
    } catch {
      setError('Unable to delete prediction record.');
    } finally {
      setDeleting(false);
    }
  };

  const handleFlagFeedback = async (record: PredictionRecord) => {
    if (feedbackSubmitting) return;
    const corrected: 'SPAM' | 'HAM' = record.prediction === 'SPAM' ? 'HAM' : 'SPAM';
    setFeedbackSubmitting(true);
    setFeedbackBanner('');
    try {
      await feedbackApi.submit({
        prediction_id: record.id,
        email_subject: record.email_subject,
        sender_address: record.sender_address,
        email_content: record.email_content || record.email_subject,
        original_prediction: record.prediction,
        corrected_label: corrected,
        notes: 'Flagged from Prediction History audit log',
      });
      setFeedbackBanner(`Queued for Active Learning: corrected ${record.prediction} -> ${corrected}.`);
    } catch {
      setError('Unable to submit Active Learning correction.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="p-4 rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search subject, body, or sender..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Segmented Filter */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
            {(['ALL', 'SPAM', 'HAM'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setPage(1);
                  setPredictionFilter(opt);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  predictionFilter === opt
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt === 'ALL' ? 'All Emails' : opt}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setPage(1);
              setStartDate(e.target.value);
            }}
            aria-label="Start date"
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setPage(1);
              setEndDate(e.target.value);
            }}
            aria-label="End date"
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          {(search || predictionFilter !== 'ALL' || startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPredictionFilter('ALL');
                setStartDate('');
                setEndDate('');
                setPage(1);
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

      {/* History Data Table */}
      <div className="rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">
            Saved Predictions
          </h2>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {total} total records
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-12 rounded-lg bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-sm text-slate-300">No prediction records match your current filters.</p>
            <p className="text-xs text-slate-500">
              Try clearing search criteria or analyze a new email message.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                  <th className="py-3 px-6">Email Subject</th>
                  <th className="py-3 px-4">Prediction</th>
                  <th className="py-3 px-4 text-right">Spam Prob.</th>
                  <th className="py-3 px-4">Model</th>
                  <th className="py-3 px-4 text-right">Date</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {items.map((row) => (
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
                    <td className="py-3.5 px-4 text-xs text-slate-300 whitespace-nowrap">
                      {row.model_name}
                    </td>
                    <td className="py-3.5 px-4 text-right text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackBanner('');
                            setSelectedRecord(row);
                          }}
                          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                          aria-label={`View details for ${row.email_subject}`}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                          aria-label={`Delete ${row.email_subject}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Details Inspection Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="max-w-xl w-full bg-[#0D1326] border border-slate-800 rounded-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <VerdictLabel prediction={selectedRecord.prediction} />
                <h3 className="mt-2 font-display text-lg font-semibold text-white">
                  {selectedRecord.email_subject}
                </h3>
                {selectedRecord.sender_address && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    From: {selectedRecord.sender_address}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                aria-label="Close details modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 py-3 border-y border-slate-800 text-xs">
              <div>
                <p className="text-slate-500">Spam Probability</p>
                <p className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                  {(selectedRecord.spam_probability * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-slate-500">Confidence</p>
                <p className="font-mono text-sm font-semibold text-indigo-300 mt-0.5 tabular-nums">
                  {(selectedRecord.confidence_score * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-slate-500">Processing Time</p>
                <p className="font-mono text-sm font-semibold text-slate-200 mt-0.5 tabular-nums">
                  {selectedRecord.processing_time.toFixed(2)} ms
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-400 mb-1.5">Analyzed Content</p>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                {selectedRecord.email_content}
              </div>
            </div>

            {selectedRecord.suspicious_keywords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1.5">
                  Top Suspicious Keywords
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedRecord.suspicious_keywords.map((kw) => (
                    <span
                      key={kw.term}
                      className="text-xs font-mono text-rose-300 bg-rose-950/40 border border-rose-500/30 px-2.5 py-1 rounded-md"
                    >
                      {kw.term} (+{kw.weight.toFixed(2)})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {feedbackBanner && (
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/35 text-xs text-emerald-200">
                {feedbackBanner}
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                Incorrect label? Send correction to Active Learning retraining queue.
              </p>
              <button
                type="button"
                disabled={feedbackSubmitting}
                onClick={() => handleFlagFeedback(selectedRecord)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-200 bg-amber-950/40 hover:bg-amber-950/70 border border-amber-500/30 whitespace-nowrap shrink-0"
              >
                <Flag className="w-3.5 h-3.5" />
                <span>
                  {feedbackSubmitting
                    ? 'Submitting...'
                    : `Mark as ${selectedRecord.prediction === 'SPAM' ? 'HAM' : 'SPAM'}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (No window.confirm) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="max-w-sm w-full bg-[#0D1326] border border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-base font-semibold text-white">
              Delete Prediction Record?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will permanently remove <span className="text-slate-200 font-medium">"{deleteTarget.email_subject}"</span> from your prediction history and update analytics counts.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
