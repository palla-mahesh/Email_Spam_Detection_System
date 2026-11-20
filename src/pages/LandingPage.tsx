import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { mlApi, ModelInfoResponse } from '../services/api';
import { useAuth } from '../context/AuthContext';

export function LandingPage() {
  const { user } = useAuth();
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    mlApi
      .getModelInfo()
      .then((res) => setModelInfo(res.data))
      .catch(() => {
        // Keep page resilient if API is still warming
      });
  }, []);

  const best = modelInfo?.best_metrics;
  const dataset = modelInfo?.dataset;

  return (
    <div className="min-h-screen bg-[#070B16] text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#070B16]/90 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            MailGuard AI
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#overview" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Overview
            </a>
            <a href="#pipeline" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              ML Pipeline
            </a>
            <a href="#benchmarks" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Benchmarks
            </a>
            <a href="#architecture" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Architecture
            </a>
          </nav>

          <div className="shrink-0">
            <Link
              to={user ? '/dashboard' : '/login'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{user ? 'Open Console' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Split Section */}
        <section id="overview" className="max-w-[1280px] mx-auto px-6 pt-14 pb-16 lg:pt-20 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="lg:col-span-6 flex flex-col justify-center space-y-6"
            >
              <p className="text-xs font-medium tracking-wide text-indigo-400">
                Natural Language Processing · Supervised Classification · Real-Time Inference
              </p>

              <h1 className="font-display font-bold tracking-tight text-white leading-[1.1] text-[clamp(2.25rem,4vw,3.4rem)] [text-wrap:balance]">
                E-Mail Spam Detection System Using Machine Learning
              </h1>

              <p className="text-base text-slate-300 leading-relaxed max-w-xl">
                Classify incoming email messages into SPAM or legitimate HAM using TF-IDF unigram and bigram vectorization, Multinomial Naive Bayes, Logistic Regression, and Platt-calibrated Linear SVM—with built-in phishing intent categorization, brand spoofing inspection, sentence-level risk scoring, and batch scanning requiring zero external API keys.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  to={user ? '/detect' : '/register'}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 transition-all whitespace-nowrap shrink-0"
                >
                  <span>{user ? 'Analyze an Email' : 'Create Analyst Account'}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                </Link>
                <a
                  href="#benchmarks"
                  className="px-5 py-3 rounded-lg text-sm font-medium text-slate-200 border border-slate-700 hover:border-slate-500 hover:bg-slate-900/60 transition-colors whitespace-nowrap shrink-0"
                >
                  View Model Benchmarks
                </a>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="lg:col-span-6"
            >
              <div className="h-full min-h-[280px] rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60">
                {!imgError ? (
                  <img
                    src="/src/assets/images/hero_email_security_1795081782209.jpg"
                    alt="Isometric email security prism separating encrypted mail streams"
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 text-center">
                    <ShieldCheck className="w-14 h-14 text-indigo-400 mb-3" />
                    <p className="font-display font-semibold text-slate-200">
                      TF-IDF &amp; Supervised Classification Pipeline
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Full-width 4-Column Live Benchmark Strip */}
          <div
            id="benchmarks"
            className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-xl bg-slate-900/50 backdrop-blur-md divide-y sm:divide-y-0 sm:divide-x divide-slate-800"
          >
            <div className="p-6">
              <p className="text-xs text-slate-400">Selected Classifier</p>
              <p className="mt-2 font-display text-lg font-semibold text-white">
                {modelInfo?.selected_model || 'Loading model...'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Stratified 80/20 split · 5-fold CV
              </p>
            </div>

            <div className="p-6">
              <p className="text-xs text-slate-400">Held-Out Test Accuracy</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-indigo-300 tabular-nums">
                {best ? `${(best.accuracy * 100).toFixed(2)}%` : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                {best ? `F1-Score: ${(best.f1Score * 100).toFixed(2)}%` : 'Evaluating...'}
              </p>
            </div>

            <div className="p-6">
              <p className="text-xs text-slate-400">ROC-AUC Score</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-blue-300 tabular-nums">
                {best ? best.rocAuc.toFixed(4) : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Calibrated spam probability output
              </p>
            </div>

            <div className="p-6">
              <p className="text-xs text-slate-400">Training Corpus &amp; Features</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
                {dataset ? `${dataset.totalRecords.toLocaleString()} emails` : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                {dataset ? `${dataset.vocabSize.toLocaleString()} TF-IDF n-grams` : 'Loading...'}
              </p>
            </div>
          </div>
        </section>

        {/* ML Methodology Pipeline Section */}
        <section id="pipeline" className="border-t border-slate-800/70 bg-slate-950/40 py-20">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="max-w-2xl mb-12">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight [text-wrap:balance]">
                Four-Stage Machine Learning Pipeline
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-400">
                Every prediction passes through deterministic text normalization, leakage-free TF-IDF feature extraction, and calibrated classification.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  step: '01. NLP Preprocessing',
                  detail:
                    'Strips HTML markup, normalizes URLs and currency tokens, removes punctuation, applies lowercase folding, and filters English stop words before tokenization.',
                },
                {
                  step: '02. TF-IDF Vectorization',
                  detail:
                    'Extracts unigram and bigram features using sublinear term frequency and smooth inverse document frequency, fitted strictly on the training split to prevent data leakage.',
                },
                {
                  step: '03. Algorithm Comparison',
                  detail:
                    'Trains Multinomial Naive Bayes, L2-regularized Logistic Regression, and Linear SVM with 3-fold Platt scaling calibration, selecting the top F1/ROC-AUC classifier.',
                },
                {
                  step: '04. Explainable Audit',
                  detail:
                    'Returns real-time latency, calibrated spam probability, suspicious token attribution weights, and saves every classification permanently to the database.',
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm space-y-3"
                >
                  <h3 className="font-display text-base font-semibold text-white">
                    {item.step}
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture & Technology Stack */}
        <section id="architecture" className="border-t border-slate-800/70 py-20">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              <div className="lg:col-span-5 space-y-4">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  Full-Stack Engineering Architecture
                </h2>
                <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
                  Built with strict separation of concerns: authenticated REST API routes, role-based access control, relational foreign-key persistence, and interactive data visualizations powered exclusively by real database queries.
                </p>
                <div className="pt-2">
                  <Link
                    to={user ? '/models' : '/login'}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <span>Explore Evaluation Metrics</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    layer: 'Frontend Interface',
                    stack: 'React · Vite · Tailwind CSS · Recharts · Framer Motion · Axios',
                  },
                  {
                    layer: 'Backend & API Layer',
                    stack: 'REST API · JWT Authentication · Rate Limiting · Input Validation',
                  },
                  {
                    layer: 'Machine Learning Engine',
                    stack: 'TF-IDF N-Grams · Naive Bayes · Logistic Regression · Calibrated SVM',
                  },
                  {
                    layer: 'Database & Security',
                    stack: 'PostgreSQL Schema · Foreign Keys · Row Level Security · Audit Logs',
                  },
                ].map((box) => (
                  <div
                    key={box.layer}
                    className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1.5"
                  >
                    <h3 className="font-display text-sm font-semibold text-white">
                      {box.layer}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{box.stack}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-8">
        <div className="max-w-[1280px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>MailGuard AI · E-Mail Spam Detection System</span>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-slate-300 transition-colors">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-slate-300 transition-colors">
              Register
            </Link>
            <a href="#pipeline" className="hover:text-slate-300 transition-colors">
              Methodology
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
