import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Cpu,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  ScanSearch,
  Shield,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Overview Dashboard',
  '/detect': 'Spam Detection',
  '/mailbox': 'Mailbox & Gatekeeper',
  '/history': 'Prediction History',
  '/analytics': 'Analytics & Trends',
  '/models': 'Model Performance',
  '/admin': 'Admin Console',
  '/profile': 'User Profile',
};

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/detect', label: 'Spam Detection', icon: ScanSearch },
    { to: '/mailbox', label: 'Mailbox', icon: Mail },
    { to: '/history', label: 'Prediction History', icon: History },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/models', label: 'Model Performance', icon: Cpu },
    ...(user?.role === 'admin'
      ? [{ to: '/admin', label: 'Admin Panel', icon: Shield }]
      : []),
    { to: '/profile', label: 'Profile', icon: User },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentTitle = ROUTE_TITLES[location.pathname] || 'Workspace';

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0B1120] border-r border-slate-800/80">
      <div className="h-16 px-5 flex items-center border-b border-slate-800/80 shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-white font-display font-bold text-lg tracking-tight whitespace-nowrap shrink-0"
          onClick={() => setMobileMenuOpen(false)}
        >
          <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0" />
          <span>MailGuard AI</span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Primary Workspace">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800/80 space-y-3 shrink-0">
        <div className="px-2">
          <p className="text-sm font-medium text-slate-200 truncate">{user?.full_name}</p>
          <p className="text-xs text-slate-400 truncate">
            {user?.email} · {user?.role === 'admin' ? 'Administrator' : 'Analyst'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#070B16] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[80vw] h-full z-10">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="absolute top-4 right-3 p-2 text-slate-400 hover:text-white rounded-lg"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-slate-800/80 bg-[#070B16]/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">Workspace</span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-display font-semibold text-slate-100 truncate">
                {currentTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/detect"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Analyze Email</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
