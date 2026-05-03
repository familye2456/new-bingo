import React, { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

const NAV = [
  {
    to: '/dashboard', label: 'Dashboard', end: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  },
  {
    to: '/play', label: 'Play Bingo', end: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><polygon points="5,3 19,12 5,21" strokeLinejoin="round" /></svg>,
  },
  {
    to: '/cartelas', label: 'My Cartelas', end: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" strokeLinecap="round" /><path d="M7 13h2M11 13h2M15 13h2" strokeLinecap="round" /></svg>,
  },
  {
    to: '/balance', label: 'Balance History', end: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M3 17l4-4 4 4 4-6 4 3" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 21h18" strokeLinecap="round" /></svg>,
  },
  {
    to: '/settings', label: 'Settings', end: true,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
  },
];

export const UserLayout: React.FC = () => {
  const { user, logout, swReady, dismissSwReady, refreshBalance } = useAuthStore();
  const [open, setOpen] = useState(false);
  const online = useOnlineStatus();
  const initials = (user?.username ?? 'U').slice(0, 2).toUpperCase();

  // Keep balance fresh — refresh every 30s while online, and immediately on tab focus
  useEffect(() => {
    if (!online) return;
    refreshBalance();
    const interval = setInterval(refreshBalance, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshBalance(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [online, refreshBalance]);

  // Auto-dismiss the SW ready toast after 6 seconds
  useEffect(() => {
    if (!swReady) return;
    const t = setTimeout(dismissSwReady, 6000);
    return () => clearTimeout(t);
  }, [swReady, dismissSwReady]);

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: '#0a1628', color: '#fff' }}>

      {/* ── Toggle button — always visible ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle sidebar"
        className="fixed top-4 left-4 z-50 w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-105"
        style={{
          background: open ? 'rgba(251,191,36,0.15)' : '#1a2e50',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-300">
          {open
            ? <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            : <><path d="M4 6h16" strokeLinecap="round" /><path d="M4 12h16" strokeLinecap="round" /><path d="M4 18h16" strokeLinecap="round" /></>}
        </svg>
      </button>

      {/* ── Backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Sidebar drawer ── */}
      <aside
        className="fixed top-0 left-0 h-full z-40 flex flex-col transition-transform duration-300"
        style={{
          width: 240,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          background: 'linear-gradient(180deg, #080f1e 0%, #0b1628 60%, #0d1e35 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: open ? '8px 0 32px rgba(0,0,0,0.6)' : 'none',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <div
            className="w-9 h-9 rounded-xl shrink-0 overflow-hidden"
            style={{ boxShadow: '0 2px 12px rgba(251,191,36,0.35)' }}
          >
            <img src="/icons/logo.png" alt="Fidel Bingo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-wide">Fidel Bingo</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className={`text-[10px] font-medium ${online ? 'text-emerald-400' : 'text-red-400'}`}>
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Balance card */}
        <div className="mx-3 mb-5 rounded-2xl px-4 py-3.5 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0.04) 100%)',
            border: '1px solid rgba(251,191,36,0.2)',
          }}
        >
          <div className="absolute -right-4 -top-4 w-16 h-16 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle,#fbbf24,transparent)' }} />
          <div className="text-[10px] font-semibold text-yellow-400/50 uppercase tracking-widest mb-1">Balance</div>
          <div className="flex items-end gap-1.5">
            <span className="text-yellow-400 font-extrabold text-2xl leading-none">
              {Number(user?.balance ?? 0).toFixed(2)}
            </span>
            <span className="text-yellow-400/50 text-xs font-medium mb-0.5">BIRR</span>
          </div>
        </div>

        {/* Section label */}
        <div className="px-5 mb-2">
          <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em]">Navigation</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
                }`
              }
              style={({ isActive }) => isActive ? {
                background: 'linear-gradient(90deg, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0.04) 100%)',
              } : {}}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-yellow-400" />
                  )}
                  <span className={`shrink-0 ${isActive ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-300'}`}>
                    {icon}
                  </span>
                  <span className="truncate flex-1">{label}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3" style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

        {/* User */}
        <div className="px-3 pb-5">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-xs text-gray-900"
              style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate leading-tight">{user?.username}</div>
              <div className="text-[11px] text-gray-600 truncate mt-0.5">{user?.email ?? 'Player'}</div>
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" />
                <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-hidden h-full" style={{ background: '#0e1a35' }}>
        {/* SW ready toast */}
        {swReady && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, #064e3b, #065f46)',
              border: '1px solid rgba(52,211,153,0.35)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(52,211,153,0.1)',
              minWidth: 260,
            }}
          >
            {/* Wifi-off icon */}
            <span className="shrink-0 text-emerald-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                <path d="M5 12.55a11 11 0 0114.08 0" strokeLinecap="round" />
                <path d="M1.42 9a16 16 0 0121.16 0" strokeLinecap="round" />
                <path d="M8.53 16.11a6 6 0 016.95 0" strokeLinecap="round" />
                <circle cx="12" cy="20" r="1" fill="currentColor" />
              </svg>
            </span>
            <div className="flex-1">
              <div className="text-emerald-300 font-semibold text-sm leading-tight">Ready to go offline</div>
              <div className="text-emerald-500 text-xs mt-0.5">App & data fully cached</div>
            </div>
            <button
              onClick={dismissSwReady}
              aria-label="Dismiss"
              className="shrink-0 text-emerald-600 hover:text-emerald-300 transition-colors ml-1"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};
