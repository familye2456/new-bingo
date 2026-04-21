import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const navItems = [
  {
    to: '/admin',
    label: 'Overview',
    end: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Users',
    end: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/admin/cartelas',
    label: 'Cartelas',
    end: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    to: '/admin/packages',
    label: 'Balance',
    end: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const pageTitle = navItems.find(n =>
    n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)
  )?.label ?? 'Admin';

  // On mobile the sidebar is never collapsed — always full width when open
  const isCollapsed = collapsed; // only applies on lg+

  return (
    <div className="h-screen flex bg-[#f0f2f5] overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 bg-[#0f172a] flex flex-col shrink-0 h-screen overflow-hidden',
          'lg:static lg:translate-x-0',
          isCollapsed ? 'lg:w-[68px]' : 'lg:w-60',
          'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'transition-transform lg:transition-[width] duration-200',
        ].join(' ')}
      >
        {/* Logo */}
        <div className={`flex items-center ${isCollapsed ? 'lg:justify-center lg:px-0 px-5' : 'px-5'} h-16 border-b border-white/10`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
              <img src="/icons/logo.png" alt="Fidel Bingo" className="w-full h-full object-contain" />
            </div>
            <span className={`text-white font-bold text-base tracking-tight ${isCollapsed ? 'lg:hidden' : ''}`}>Fidel Bingo</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group ${
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <span className="shrink-0">{icon}</span>
              <span className={isCollapsed ? 'lg:hidden' : ''}>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className={`flex items-center gap-2.5 px-1 mb-2 ${isCollapsed ? 'lg:hidden' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.username?.[0]?.toUpperCase() ?? 'A'}
            </div>
            <div className="min-w-0">
              <div className="text-white text-xs font-medium truncate">{user?.username}</div>
              <div className="text-slate-400 text-[10px]">{user?.role === 'agent' ? 'Agent' : 'Administrator'}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-slate-400 hover:bg-white/5 hover:text-red-400 transition-colors text-sm ${isCollapsed ? 'lg:justify-center' : ''}`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className={isCollapsed ? 'lg:hidden' : ''}>Logout</span>
          </button>
        </div>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex absolute -right-3 top-[72px] w-6 h-6 bg-[#0f172a] border border-white/20 rounded-full items-center justify-center text-slate-400 hover:text-white transition-colors z-10"
          aria-label="Toggle sidebar"
        >
          <svg className={`w-3 h-3 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </aside>

      {/* Main — full width on mobile, flex-1 on desktop */}
      <div className="flex-1 flex flex-col min-w-0 w-full">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 sm:px-6 shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden mr-3 p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Open sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-gray-800 font-semibold text-base">{pageTitle}</h1>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
              {user?.username?.[0]?.toUpperCase() ?? 'A'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
