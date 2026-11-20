import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function ProfilePage() {
  const { user, stats, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="p-6 sm:p-8 rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h2 className="font-display text-xl font-bold text-white">{user.full_name}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {user.email} · {user.role === 'admin' ? 'System Administrator' : 'Security Analyst'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-rose-200 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/40 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs text-slate-500">Account Identifier</p>
            <p className="mt-1 font-mono text-xs text-slate-300 break-all">{user.id}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Account Created</p>
            <p className="mt-1 font-mono text-xs text-slate-300 tabular-nums">
              {new Date(user.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Prediction Statistics */}
      <div className="p-6 rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 space-y-4">
        <h3 className="font-display text-base font-semibold text-white">
          Personal Classification Statistics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800">
            <p className="text-xs text-slate-400">Total Analyzed</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
              {stats?.total_predictions ?? 0}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800">
            <p className="text-xs text-slate-400">Spam Caught</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-rose-400 tabular-nums">
              {stats?.spam_count ?? 0}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800">
            <p className="text-xs text-slate-400">Legitimate (HAM)</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {stats?.ham_count ?? 0}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800">
            <p className="text-xs text-slate-400">Avg Confidence</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-indigo-300 tabular-nums">
              {stats ? `${(stats.avg_confidence * 100).toFixed(1)}%` : '0.0%'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
