import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/dashboard';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (mode === 'register' && fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(cleanEmail, password);
      } else {
        await register(fullName.trim(), cleanEmail, password);
      }
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Authentication failed. Please verify your credentials.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (role: 'analyst' | 'admin') => {
    setError('');
    if (role === 'admin') {
      setEmail('admin@mailguard.ai');
      setPassword('Admin@2026!');
    } else {
      setEmail('analyst@mailguard.ai');
      setPassword('Analyst@2026!');
    }
  };

  return (
    <div className="min-h-screen bg-[#070B16] text-slate-100 flex flex-col justify-center px-4 py-12">
      <div className="max-w-md w-full mx-auto space-y-6">
        <div className="text-center space-y-2">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-display text-xl font-bold text-white"
          >
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            <span>MailGuard AI</span>
          </Link>
          <h1 className="font-display text-2xl font-bold text-white">
            {mode === 'login' ? 'Sign in to your workspace' : 'Create your analyst account'}
          </h1>
          <p className="text-sm text-slate-400">
            {mode === 'login'
              ? 'Access real-time spam classification, history, and model analytics.'
              : 'Register to analyze emails and track prediction history in the database.'}
          </p>
        </div>

        <div className="bg-slate-900/75 backdrop-blur-md border border-slate-800 rounded-xl p-6 sm:p-8 space-y-5">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <div>
                <label htmlFor="fullName" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@university.edu"
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors"
            >
              {submitting
                ? mode === 'login'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          {mode === 'login' && (
            <div className="pt-4 border-t border-slate-800 space-y-2.5">
              <p className="text-xs text-slate-400">
                Quick evaluation credentials
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => fillDemo('analyst')}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap"
                >
                  Standard Analyst
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('admin')}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap"
                >
                  Administrator
                </button>
              </div>
            </div>
          )}

          <div className="pt-2 text-center text-xs text-slate-400">
            {mode === 'login' ? (
              <>
                New to MailGuard AI?{' '}
                <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-medium">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
