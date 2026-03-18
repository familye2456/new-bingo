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
    to: '/dashboard',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: '/new-game',
    label: 'New Game',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/play',
    label: 'Play Bingo',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <polygon points="5,3 19,12 5,21" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/cartelas',
    label: 'My Cartelas',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18" strokeLinecap="round" />
        <path d="M7 13h2M11 13h2M15 13h2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/balance',
    label: 'Balance History',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path d="M3 17l4-4 4 4 4-6 4 3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 21h18" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export const UserLayout: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const online = useOnlineStatus();

  const initials = (user?.username ?? 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex" style={{ background: '#0e1a35', color: '#fff' }}>

      {/* ── Offline banner ── */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-gray-900 text-center text-xs font-semibold py-1.5">
          ⚠ You are offline — showing cached data
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col shrink-0 transition-all duration-200"
        style={{
          width: collapsed ? 64 : 220,
          background: 'linear-gradient(180deg, #0b1628 0%, #0e1e38 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center px-4 py-5" style={{ minHeight: 64 }}>
          {!collapsed && (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center shrink-0">
                <span className="text-gray-900 font-extrabold text-sm">FB</span>
              </div>
              <span className="text-white font-bold text-base tracking-wide">Fidel Bingo</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
            className="ml-auto p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              {collapsed
                ? <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
          </button>
        </div>

        {/* Balance card */}
        {!collapsed && (
          <div className="mx-3 mb-4 rounded-xl px-4 py-3"
            style={{ background: 'linear-gradient(135deg,#1a3a6a,#0f2548)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <div className="text-xs text-yellow-300/60 mb-0.5 uppercase tracking-wider">Balance</div>
            <div className="text-yellow-400 font-extrabold text-xl">
              {Number(user?.balance ?? 0).toFixed(2)}
              <span className="text-yellow-400/60 text-sm font-normal ml-1">BIRR</span>
            </div>
          </div>
        )}

        {/* Nav section label */}
        {!collapsed && (
          <div className="px-4 mb-2">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">Menu</span>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-yellow-400/15 text-yellow-400'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active indicator bar */}
                  <span className={`shrink-0 transition-colors ${isActive ? 'text-yellow-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
                    {icon}
                  </span>
                  {!collapsed && (
                    <span className="truncate">{label}</span>
                  )}
                  {!collapsed && isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-3 my-2" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        {/* User profile + logout */}
        <div className="px-3 pb-4">
          {!collapsed ? (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shrink-0">
                <span className="text-gray-900 font-bold text-xs">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{user?.username}</div>
                <div className="text-xs text-gray-500 truncate">{user?.email ?? 'Player'}</div>
              </div>
              <button
                onClick={logout}
                title="Logout"
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" />
                  <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
                <span className="text-gray-900 font-bold text-xs">{initials}</span>
              </div>
              <button
                onClick={logout}
                title="Logout"
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" />
                  <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto" style={{ background: '#0e1a35' }}>
        <Outlet />
      </main>
    </div>
  );
};
