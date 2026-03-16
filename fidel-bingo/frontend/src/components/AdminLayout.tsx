import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/admin/users', label: 'User Management', icon: '👥', end: false },
  { to: '/admin/cartelas', label: 'Cartela Management', icon: '🎴', end: false },
  { to: '/admin/packages', label: 'Add Balance', icon: '💰', end: false },
];

export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-white shadow-md flex flex-col transition-all duration-200 shrink-0`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b">
          {!collapsed && <span className="text-blue-600 font-bold text-lg">Fidel Bingo</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-gray-600 ml-auto"
            aria-label="Toggle sidebar"
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <span className="text-base shrink-0">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="border-t px-3 py-3">
          {!collapsed && (
            <div className="text-xs text-gray-500 mb-2 truncate">
              <span className="font-medium text-gray-700">{user?.username}</span>
              <span className="ml-1 bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">Admin</span>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 w-full"
          >
            <span>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
