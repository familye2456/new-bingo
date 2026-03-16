import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊', end: true },
  { to: '/dashboard/new-game', label: 'New Game', icon: '🎱', end: false },
  { to: '/dashboard/play', label: 'Play Bingo', icon: '🎲', end: false },
  { to: '/dashboard/cartelas', label: 'My Cartelas', icon: '🎴', end: false },
  { to: '/dashboard/balance', label: 'Balance History', icon: '💰', end: false },
  { to: '/dashboard/settings', label: 'Settings', icon: '⚙️', end: false },
];

export const UserLayout: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-[#1a1a2e] flex flex-col transition-all duration-200 shrink-0`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          {!collapsed && <span className="text-yellow-400 font-bold text-lg tracking-wide">Fidel Bingo</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-white ml-auto"
            aria-label="Toggle sidebar"
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        {/* Balance chip */}
        {!collapsed && (
          <div className="mx-3 mt-4 bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-3 py-2">
            <div className="text-xs text-yellow-300/70">Balance</div>
            <div className="text-yellow-400 font-bold text-lg">${Number(user?.balance ?? 0).toFixed(2)}</div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2 mt-2">
          {navItems.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-yellow-400/20 text-yellow-400 font-medium'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <span className="text-base shrink-0">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div className="border-t border-white/10 px-3 py-3">
          {!collapsed && (
            <div className="text-xs text-gray-400 mb-2 truncate font-medium">{user?.username}</div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 w-full"
          >
            <span>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
