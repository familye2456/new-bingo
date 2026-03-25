import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { GamePage } from './pages/GamePage';

// User layout + pages
import { UserLayout } from './components/UserLayout';
import { UserDashboard } from './pages/user/UserDashboard';
import { PlayBingo } from './pages/user/PlayBingo';
import { MyCartelas } from './pages/user/MyCartelas';
import { BalanceHistory } from './pages/user/BalanceHistory';
import { Settings } from './pages/user/Settings';
import { NewGame } from './pages/user/NewGame';

// Admin layout + pages
import { AdminLayout } from './components/AdminLayout';
import { AdminOverview } from './pages/admin/AdminOverview';
import { UserManagement } from './pages/admin/UserManagement';
import { UserDetail } from './pages/admin/UserDetail';
import { CartelaManagement } from './pages/admin/CartelaManagement';
import { PackageManagement } from './pages/admin/PackageManagement';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30 * 1000,      // 30s — don't refetch if data is fresh
      refetchOnWindowFocus: false, // don't hammer server on tab switch
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, initialized, cacheSteps } = useAuthStore();

  // Still bootstrapping (page refresh / fetchMe in progress)
  if (!initialized && !user) return null;

  // Logged in but cache download in progress — show blocking screen
  if (!initialized && user) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: '#0a1220' }}>
        <div className="text-center w-72">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white font-black text-xl mx-auto mb-6">B</div>
          <p className="text-white font-semibold mb-1">Setting up your account</p>
          <p className="text-gray-500 text-xs mb-6">Downloading data for offline use…</p>
          <div className="space-y-2">
            {cacheSteps.map((step) => (
              <div key={step.label} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                <span className="text-base w-5 text-center">
                  {step.status === 'done'    ? '✓' :
                   step.status === 'loading' ? '⟳' :
                   step.status === 'skipped' ? '—' : '·'}
                </span>
                <span className={`text-sm flex-1 text-left ${
                  step.status === 'done'    ? 'text-emerald-400' :
                  step.status === 'loading' ? 'text-yellow-400 animate-pulse' :
                  step.status === 'skipped' ? 'text-gray-500' :
                  'text-gray-600'
                }`}>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/admin" replace />;
  if (!adminOnly && user.role === 'admin') return <Navigate to="/admin" replace />;
  return <>{children}</>;
};

// Inner component — lives inside QueryClientProvider so useQueryClient works
const AppRoutes: React.FC = () => {
  const { fetchMe, refreshBalance } = useAuthStore();
  const qc = useQueryClient();

  useEffect(() => {
    fetchMe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll balance every 60 seconds when online
  useEffect(() => {
    const id = setInterval(() => refreshBalance(), 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When sync.ts finishes flushing + refreshing cache, invalidate all queries
  useEffect(() => {
    const handler = () => { qc.invalidateQueries(); refreshBalance(); };
    window.addEventListener('cache-refreshed', handler);
    return () => window.removeEventListener('cache-refreshed', handler);
  }, [qc]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/game/:gameId" element={<ProtectedRoute><GamePage /></ProtectedRoute>} />

          {/* Player section — all under UserLayout */}
          <Route element={<ProtectedRoute><UserLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<UserDashboard />} />
            <Route path="/play" element={<PlayBingo />} />
            <Route path="/new-game" element={<NewGame />} />
            <Route path="/cartelas" element={<MyCartelas />} />
            <Route path="/balance" element={<BalanceHistory />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Admin section */}
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<UserManagement />} />
            <Route path="users/:id" element={<UserDetail />} />
            <Route path="cartelas" element={<CartelaManagement />} />
            <Route path="packages" element={<PackageManagement />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
  );
};

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <AppRoutes />
  </QueryClientProvider>
);

export default App;
