import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eraser,
  FileSpreadsheet,
  Link2,
  Loader2,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { BatchPredictionResponse, mlApi, PredictionRecord } from '../services/api';
import { VerdictLabel } from '../components/VerdictLabel';

const SAMPLE_EMAILS = [
  {
    label: 'Phishing Alert',
    subject: 'URGENT: Your Chase Bank Account Has Been Suspended',
    sender: 'security-verify@chase-portal-update.xyz',
    body: 'Dear customer, we detected an unauthorized wire transfer of $3,400 from your Chase checking account. Click http://chase-portal-update.xyz/verify immediately to confirm your Social Security Number, ATM PIN, and password within 12 hours or your funds will be frozen permanently.',
  },
  {
    label: 'Promotional Spam',
    subject: 'CONGRATULATIONS! Claim Your Free $1,000 Walmart Gift Card!',
    sender: 'rewards@sweepstakes-promo-now.top',
    body: 'You were randomly selected as today winner! Claim your $1,000 prize voucher before midnight by answering 2 quick survey questions and paying a $1.95 shipping fee. Limited slots available, act now!',
  },
  {
    label: 'Legitimate Work Email',
    subject: 'Re: PostgreSQL Schema Review & Sprint Notes',
    sender: 'priya.nair@engineering.org',
    body: 'Hi team, I reviewed the pull request for the email_predictions composite index on (user_id, created_at). Query latency in staging dropped to 14ms. Let us discuss the confusion matrix chart layout during Thursday afternoon architecture review.',
  },
];

const SAMPLE_BATCH_TEXT = `subject | sender | body
URGENT: PayPal Account Limited | alert@paypal-security.xyz | Verify your credit card CVV and password within 24 hours at http://paypal-security.xyz/login or your balance is frozen!
Q3 Architecture Review Notes | priya@engineering.org | Hi team, Thursday architecture meeting is moved to 3:30 PM PST after the PostgreSQL migration test.
Double Your Bitcoin in 48h | vip@crypto-wealth.biz | Guaranteed 300% ROI! Deposit $250 today for risk-free automated payouts.
CS-410 Assignment Reminder | prof.chen@university.edu | Please submit your TF-IDF Jupyter notebook and confusion matrix report before Friday 11:59 PM.`;

function parseBatchInput(raw: string): Array<{ subject: string; sender: string; body: string }> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const rows: Array<{ subject: string; sender: string; body: string }> = [];
  const hasPipeHeader = lines[0].toLowerCase().includes('subject') && lines[0].includes('|');
  const startIdx = hasPipeHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('|')) {
      const [subj = '', sndr = '', ...rest] = line.split('|');
      const bdy = rest.join('|').trim();
      if (subj.trim() || bdy) {
        rows.push({ subject: subj.trim(), sender: sndr.trim(), body: bdy || subj.trim() });
      }
    } else if (line.includes(',')) {
      const firstComma = line.indexOf(',');
      const secondComma = line.indexOf(',', firstComma + 1);
      if (secondComma !== -1) {
        const subj = line.slice(0, firstComma).replace(/^"|"$/g, '').trim();
        const sndr = line.slice(firstComma + 1, secondComma).replace(/^"|"$/g, '').trim();
        const bdy = line.slice(secondComma + 1).replace(/^"|"$/g, '').trim();
        if (i === 0 && subj.toLowerCase() === 'subject') continue;
        rows.push({ subject: subj, sender: sndr, body: bdy || subj });
      } else {
        const subj = line.slice(0, firstComma).replace(/^"|"$/g, '').trim();
        const bdy = line.slice(firstComma + 1).replace(/^"|"$/g, '').trim();
        if (i === 0 && (subj.toLowerCase() === 'subject' || subj.toLowerCase() === 'label')) continue;
        rows.push({ subject: subj, sender: '', body: bdy || subj });
      }
    } else {
      rows.push({ subject: `Email #${i + 1}`, sender: '', body: line });
    }
  }
  return rows.slice(0, 50);
}

export function DetectPage() {
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // Single analysis state
  const [subject, setSubject] = useState('');
  const [sender, setSender] = useState('');
  const [body, setBody] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PredictionRecord | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Batch scanner state
  const [batchRaw, setBatchRaw] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<BatchPredictionResponse | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!subject.trim() && !body.trim()) {
      setError('Please enter an email subject or body text to analyze.');
      return;
    }

    setAnalyzing(true);
    try {
      const { data } = await mlApi.predict({
        subject: subject.trim(),
        sender: sender.trim() || undefined,
        body: body.trim(),
      });
      setResult(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Prediction request failed. Please check your input and try again.';
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleClear = () => {
    setSubject('');
    setSender('');
    setBody('');
    setError('');
    setResult(null);
  };

  const loadSample = (sample: (typeof SAMPLE_EMAILS)[number]) => {
    setSubject(sample.subject);
    setSender(sample.sender);
    setBody(sample.body);
    setError('');
  };

  const handleCopyReply = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    } catch {
      // Clipboard fallback silently ignored
    }
  };

  const handleBatchScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError('');
    const parsed = parseBatchInput(batchRaw);
    if (parsed.length === 0) {
      setBatchError('Paste at least one email row (format: subject | sender | body, or one email per line).');
      return;
    }

    setBatchRunning(true);
    try {
      const { data } = await mlApi.predictBatch(parsed);
      setBatchResult(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Batch scan failed. Please check formatting and try again.';
      setBatchError(msg);
    } finally {
      setBatchRunning(false);
    }
  };

  const handleBatchFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBatchRaw(reader.result);
        setBatchError('');
      }
    };
    reader.readAsText(file);
  };

  const exportBatchCsv = () => {
    if (!batchResult) return;
    const header = 'index,subject,sender,prediction,spam_probability,confidence_score,threat_category,urgency_score,processing_ms';
    const lines = batchResult.results.map((r) => {
      const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
      return [
        r.index + 1,
        esc(r.subject),
        esc(r.sender),
        r.prediction,
        (r.spamProbability * 100).toFixed(2),
        (r.confidenceScore * 100).toFixed(2),
        esc(r.threatCategory),
        r.urgencyScore,
        r.processingTimeMs.toFixed(2),
      ].join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mailguard_batch_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'single'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Single Email AI Analysis</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('batch')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'batch'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Batch Multi-Email Scanner</span>
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Zero-API-key on-device NLP, TF-IDF classification, phishing threat forensics, and sentence scoring
        </p>
      </div>

      {mode === 'single' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Input Form */}
          <div className="lg:col-span-6 bg-slate-900/75 backdrop-blur-md border border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Analyze Email Message
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspects ML verdict, threat category, social engineering urgency, domain spoofing, and sentence-level risk.
              </p>
            </div>

            {/* Sample Loaders */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 mr-1">Load test case:</span>
              {SAMPLE_EMAILS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => loadSample(sample)}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleAnalyze} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="subject" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Email Subject
                  </label>
                  <input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g., Quarterly Engineering Review"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="sender" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Sender Address (Optional)
                  </label>
                  <input
                    id="sender"
                    type="text"
                    value={sender}
                    onChange={(e) => setSender(e.target.value)}
                    placeholder="e.g., colleague@company.com"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="body" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Email Body
                </label>
                <textarea
                  id="body"
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Paste the email content you want to classify..."
                  className="w-full px-3.5 py-3 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed resize-y"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <ScanSearch className="w-4 h-4" aria-hidden="true" />
                      <span>Analyze Email</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap"
                >
                  <Eraser className="w-4 h-4" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </form>
          </div>

          {/* Classification & AI Intelligence Result Panel */}
          <div className="lg:col-span-6 bg-slate-900/75 backdrop-blur-md border border-slate-800 rounded-xl p-6 space-y-5">
            <h2 className="font-display text-lg font-semibold text-white">
              Classification &amp; AI Threat Forensics
            </h2>

            {!result && !analyzing && (
              <div className="py-16 text-center space-y-2 border border-dashed border-slate-800 rounded-lg px-4">
                <p className="text-sm text-slate-300">Ready for real-time inference</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Enter an email on the left or pick a sample case to inspect ML consensus, threat category, domain spoofing, and sentence-level risk scoring.
                </p>
              </div>
            )}

            {analyzing && (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-7 h-7 text-indigo-400 animate-spin" />
                <p className="text-xs text-slate-400">Running TF-IDF pipeline &amp; AI forensics...</p>
              </div>
            )}

            {result && !analyzing && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-5"
              >
                {/* Primary Verdict Banner */}
                <div
                  className={`p-4 rounded-lg border ${
                    result.prediction === 'SPAM'
                      ? 'bg-rose-950/35 border-rose-500/40'
                      : 'bg-emerald-950/30 border-emerald-500/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <VerdictLabel prediction={result.prediction} />
                    <span className="text-xs font-mono text-slate-300 tabular-nums">
                      {result.threat_category || 'Classified'} · {result.processing_time.toFixed(2)} ms
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">
                    Classified by <span className="font-semibold text-white">{result.model_name}</span> and saved to prediction history.
                  </p>
                </div>

                {/* Probabilities + Urgency Score */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <p className="text-xs text-slate-400">Spam Prob.</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-white tabular-nums">
                      {(result.spam_probability * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <p className="text-xs text-slate-400">Confidence</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-indigo-300 tabular-nums">
                      {(result.confidence_score * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <p className="text-xs text-slate-400">Urgency Index</p>
                    <p
                      className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                        (result.risk_indicators?.urgencyScore || 0) >= 50
                          ? 'text-amber-300'
                          : 'text-slate-200'
                      }`}
                    >
                      {result.risk_indicators?.urgencyScore ?? 0}/100
                    </p>
                  </div>
                </div>

                {/* AI Security Advisory */}
                {result.ai_advisory && (
                  <div className="p-4 rounded-lg bg-slate-950/75 border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                      {result.prediction === 'SPAM' ? (
                        <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      <span>AI Security Advisory</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{result.ai_advisory}</p>
                  </div>
                )}

                {/* Brand Spoofing & URL Forensics */}
                {result.risk_indicators &&
                  (result.risk_indicators.brandMismatch ||
                    result.risk_indicators.urlFindings.length > 0 ||
                    result.risk_indicators.manipulationTriggers.length > 0) && (
                    <div className="space-y-3 pt-2 border-t border-slate-800">
                      <p className="text-xs font-medium text-slate-300">
                        Social Engineering &amp; Domain Forensics
                      </p>

                      {result.risk_indicators.brandMismatch && (
                        <div className="p-3 rounded-lg bg-rose-950/35 border border-rose-500/40 flex items-start gap-2.5 text-xs text-rose-200">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold">
                              Brand Spoofing Detected: {result.risk_indicators.brandMismatch.claimedBrand}
                            </p>
                            <p className="text-rose-200/80 mt-0.5">
                              {result.risk_indicators.brandMismatch.detail}
                            </p>
                          </div>
                        </div>
                      )}

                      {result.risk_indicators.urlFindings.length > 0 && (
                        <div className="space-y-1.5">
                          {result.risk_indicators.urlFindings.map((u) => (
                            <div
                              key={u.url}
                              className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Link2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="font-mono text-slate-200 truncate">{u.url}</span>
                              </div>
                              <span className="text-amber-300 shrink-0">{u.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {result.risk_indicators.manipulationTriggers.length > 0 && (
                        <p className="text-xs text-slate-400">
                          Triggers detected:{' '}
                          <span className="text-slate-200">
                            {result.risk_indicators.manipulationTriggers.join(' · ')}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                {/* Sentence-Level Risk Highlighter */}
                {result.sentence_analysis && result.sentence_analysis.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <p className="text-xs font-medium text-slate-300">
                      Sentence-by-Sentence Risk Analysis
                    </p>
                    <div className="space-y-1.5">
                      {result.sentence_analysis.map((s, idx) => (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                            s.riskLevel === 'high'
                              ? 'bg-rose-950/30 border-rose-500/35 text-rose-100'
                              : s.riskLevel === 'medium'
                                ? 'bg-amber-950/25 border-amber-500/35 text-amber-100'
                                : 'bg-slate-950/70 border-slate-800 text-slate-300'
                          }`}
                        >
                          <span className="leading-relaxed">{s.sentence}</span>
                          <span className="font-mono tabular-nums shrink-0 text-[11px]">
                            {(s.spamProbability * 100).toFixed(0)}% {s.riskLevel}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Suggested Replies / Actions */}
                {result.suggested_replies && result.suggested_replies.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <p className="text-xs font-medium text-slate-300">
                      {result.prediction === 'SPAM' ? 'Recommended Security Actions' : 'AI Safe Reply Coach'}
                    </p>
                    <div className="space-y-1.5">
                      {result.suggested_replies.map((reply, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-200"
                        >
                          <span>{reply}</span>
                          {result.prediction === 'HAM' && (
                            <button
                              type="button"
                              onClick={() => handleCopyReply(reply, idx)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300 shrink-0"
                            >
                              {copiedIdx === idx ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cross-Algorithm Breakdown */}
                {result.model_breakdown && result.model_breakdown.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <p className="text-xs font-medium text-slate-300">
                      Algorithm Consensus Breakdown
                    </p>
                    <div className="space-y-2">
                      {result.model_breakdown.map((m) => (
                        <div key={m.modelName} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-300">{m.modelName}</span>
                            <span className="font-mono text-slate-200 tabular-nums">
                              {m.prediction} · {(m.spamProbability * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                m.prediction === 'SPAM' ? 'bg-rose-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.max(3, m.spamProbability * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suspicious Keywords Attribution */}
                <div className="space-y-2.5 pt-2 border-t border-slate-800">
                  <p className="text-xs font-medium text-slate-300">
                    Suspicious Keyword Indicators (TF-IDF Attribution)
                  </p>
                  {result.suspicious_keywords.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No strong spam-weighted keywords detected in this message.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-lg bg-slate-950/60">
                      {result.suspicious_keywords.map((kw) => (
                        <div
                          key={kw.term}
                          className="px-3 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="font-mono text-slate-200">{kw.term}</span>
                          <span className="font-mono text-rose-300 tabular-nums">
                            +{kw.weight.toFixed(3)} weight · TF-IDF {kw.tfidf.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      ) : (
        /* Batch Multi-Email AI Scanner */
        <div className="space-y-6">
          <div className="bg-slate-900/75 backdrop-blur-md border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Batch Multi-Email AI Scanner
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scan up to 50 emails simultaneously from CSV or pipe-delimited rows (<code className="font-mono text-slate-300">subject | sender | body</code>).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBatchRaw(SAMPLE_BATCH_TEXT);
                    setBatchError('');
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 whitespace-nowrap"
                >
                  Load Sample Batch
                </button>
                <label className="cursor-pointer px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 whitespace-nowrap">
                  <span>Import CSV / TXT</span>
                  <input type="file" accept=".csv,.txt" onChange={handleBatchFile} className="sr-only" />
                </label>
              </div>
            </div>

            {batchError && (
              <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
                {batchError}
              </div>
            )}

            <form onSubmit={handleBatchScan} className="space-y-4">
              <textarea
                rows={7}
                value={batchRaw}
                onChange={(e) => setBatchRaw(e.target.value)}
                placeholder={`subject | sender | body\nURGENT: Account Alert | alert@fake.xyz | Verify your ATM PIN immediately...\nTeam Standup | alex@company.org | Daily standup moved to 10:30 AM.`}
                className="w-full px-3.5 py-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={batchRunning}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  {batchRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Scanning Batch...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Run Batch AI Scan</span>
                    </>
                  )}
                </button>
                {batchResult && (
                  <button
                    type="button"
                    onClick={exportBatchCsv}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download CSV</span>
                  </button>
                )}
              </div>
            </form>
          </div>

          {batchResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/75 border border-slate-800">
                  <p className="text-xs text-slate-400">Total Scanned</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
                    {batchResult.total}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/75 border border-slate-800">
                  <p className="text-xs text-slate-400">SPAM Detected</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-rose-400 tabular-nums">
                    {batchResult.spam_count}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/75 border border-slate-800">
                  <p className="text-xs text-slate-400">Legitimate HAM</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                    {batchResult.ham_count}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/75 border border-slate-800">
                  <p className="text-xs text-slate-400">High Urgency (&ge;50)</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
                    {batchResult.high_urgency_count}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                        <th className="py-3 px-4">#</th>
                        <th className="py-3 px-4">Subject &amp; Sender</th>
                        <th className="py-3 px-4">Verdict</th>
                        <th className="py-3 px-4">Threat Category</th>
                        <th className="py-3 px-4 text-right">Spam Prob.</th>
                        <th className="py-3 px-4 text-right">Urgency</th>
                        <th className="py-3 px-4 text-right">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-sm">
                      {batchResult.results.map((row) => (
                        <tr key={row.index} className="hover:bg-slate-800/35">
                          <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {row.index + 1}
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="font-medium text-slate-100 truncate">{row.subject}</p>
                            {row.sender && (
                              <p className="text-xs text-slate-500 truncate">{row.sender}</p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <VerdictLabel prediction={row.prediction} />
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-300 whitespace-nowrap">
                            {row.threatCategory}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-200 tabular-nums">
                            {(row.spamProbability * 100).toFixed(1)}%
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-amber-300 tabular-nums">
                            {row.urgencyScore}/100
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-400 tabular-nums">
                            {row.processingTimeMs.toFixed(2)} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
