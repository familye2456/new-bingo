import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { GamePage } from './pages/GamePage';

// Error boundary — catches extension-injected DOM conflicts and other runtime errors
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0b1120' }}>
          <div className="text-center">
            <div className="text-red-400 text-sm mb-3">Something went wrong. Please refresh.</div>
            <button onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: '#fbbf24', color: '#111' }}>
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// User layout + pages
import { UserLayout } from './components/UserLayout';
const UserDashboard   = lazy(() => import('./pages/user/UserDashboard').then(m => ({ default: m.UserDashboard })));
const PlayBingo       = lazy(() => import('./pages/user/PlayBingo').then(m => ({ default: m.PlayBingo })));
const MyCartelas      = lazy(() => import('./pages/user/MyCartelas').then(m => ({ default: m.MyCartelas })));
const BalanceHistory  = lazy(() => import('./pages/user/BalanceHistory').then(m => ({ default: m.BalanceHistory })));
const OwnerDashboard  = lazy(() => import('./pages/user/OwnerDashboard').then(m => ({ default: m.OwnerDashboard })));
const Settings        = lazy(() => import('./pages/user/Settings').then(m => ({ default: m.Settings })));
const NewGame         = lazy(() => import('./pages/user/NewGame').then(m => ({ default: m.NewGame })));

// Admin layout + pages
import { AdminLayout } from './components/AdminLayout';
const AdminOverview      = lazy(() => import('./pages/admin/AdminOverview').then(m => ({ default: m.AdminOverview })));
const UserManagement     = lazy(() => import('./pages/admin/UserManagement').then(m => ({ default: m.UserManagement })));
const UserDetail         = lazy(() => import('./pages/admin/UserDetail').then(m => ({ default: m.UserDetail })));
const CartelaManagement  = lazy(() => import('./pages/admin/CartelaManagement').then(m => ({ default: m.CartelaManagement })));
const PackageManagement  = lazy(() => import('./pages/admin/PackageManagement').then(m => ({ default: m.PackageManagement })));

const PageFallback = () => (
  <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
);

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

const Splash: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a1220' }}>
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mx-auto mb-4 overflow-hidden">
        <img src="/icons/logo.png" alt="Fidel Bingo" className="w-full h-full object-contain" />
      </div>
      <div className="w-6 h-6 rounded-full border-2 border-yellow-400/30 border-t-yellow-400 animate-spin mx-auto" />
    </div>
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, initialized, cacheSteps } = useAuthStore();

  // Still bootstrapping — show splash instead of blank white screen
  if (!initialized && !user) return <Splash />;

  // Logged in but cache download in progress — show blocking screen
  if (!initialized && user) {
    const total = cacheSteps.length;
    const done = cacheSteps.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
      <div className="min-h-screen flex items-center justify-center px-6"
        style={{ background: '#0a1220' }}>
        <div className="w-full max-w-xs">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-4 shadow-lg overflow-hidden"
              style={{ boxShadow: '0 0 32px rgba(251,191,36,0.3)' }}>
              <img src="/icons/logo.png" alt="Fidel Bingo" className="w-full h-full object-contain" />
            </div>
            <p className="text-white font-bold text-lg">Fidel Bingo</p>
            <p className="text-gray-500 text-xs mt-1">Preparing offline mode…</p>
          </div>

          {/* Overall progress bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Downloading</span>
              <span className="text-xs font-bold text-yellow-400">{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                  boxShadow: pct > 0 ? '0 0 8px rgba(251,191,36,0.5)' : 'none',
                }}
              />
            </div>
          </div>

          {/* Step list */}
          <div className="space-y-2">
            {cacheSteps.map((step) => {
              const isDone    = step.status === 'done' || step.status === 'skipped';
              const isLoading = step.status === 'loading';
              return (
                <div key={step.label} className="rounded-xl overflow-hidden transition-all duration-300">
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      background: isDone
                        ? 'rgba(34,197,94,0.08)'
                        : isLoading
                        ? 'rgba(251,191,36,0.08)'
                        : 'rgba(255,255,255,0.04)',
                      borderTop: isDone ? '1px solid rgba(34,197,94,0.2)' : isLoading ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.06)',
                      borderLeft: isDone ? '1px solid rgba(34,197,94,0.2)' : isLoading ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.06)',
                      borderRight: isDone ? '1px solid rgba(34,197,94,0.2)' : isLoading ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.06)',
                      borderBottom: isLoading && step.cached !== undefined ? 'none' : isDone ? '1px solid rgba(34,197,94,0.2)' : isLoading ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: isLoading && step.cached !== undefined ? '12px 12px 0 0' : '12px',
                    }}>
                    {/* Icon */}
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {isDone ? (
                        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isLoading ? (
                        <div className="w-4 h-4 rounded-full border-2 border-yellow-400/30 border-t-yellow-400 animate-spin" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-gray-700" />
                      )}
                    </div>
                    {/* Label */}
                    <span className={`text-sm font-medium flex-1 ${
                      isDone    ? 'text-emerald-400' :
                      isLoading ? 'text-yellow-400' :
                      'text-gray-600'
                    }`}>{step.label}</span>
                    {/* Status / count */}
                    {isLoading && step.cached === undefined && <span className="text-[10px] text-yellow-500 animate-pulse">Loading…</span>}
                    {isLoading && step.cached !== undefined && (
                      <span className="text-[10px] font-bold text-yellow-400">{step.cached} files</span>
                    )}
                    {isDone && step.count !== undefined && step.count > 1 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
                        {step.count}
                      </span>
                    )}
                    {isDone && (step.count === undefined || step.count <= 1) && (
                      <span className="text-[10px] text-emerald-500">✓</span>
                    )}
                  </div>
                  {/* SW sub-progress bar */}
                  {isLoading && step.cached !== undefined && (
                    <div className="h-1.5"
                      style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                      <div className="h-full rounded-b-xl transition-all duration-500"
                        style={{
                          width: step.total ? `${Math.min(100, Math.round((step.cached / step.total) * 100))}%` : '100%',
                          background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                          animation: !step.total ? 'pulse 1.5s infinite' : undefined,
                        }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin' && user.role !== 'agent') return <Navigate to="/dashboard" replace />;
  if (!adminOnly && (user.role === 'admin' || user.role === 'agent')) return <Navigate to="/admin" replace />;
  return <>{children}</>;
};

// Inner component — lives inside QueryClientProvider so useQueryClient works
const AppRoutes: React.FC = () => {
  const { fetchMe, refreshBalance } = useAuthStore();
  const qc = useQueryClient();
  const fetchedRef = React.useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return; // prevent double-invoke in React dev mode
    fetchedRef.current = true;
    fetchMe();
    // Trigger sync once on app load if online and there are pending items
    if (navigator.onLine) {
      import('./services/sync').then(({ syncWhenOnline }) => {
        setTimeout(syncWhenOnline, 2000); // delay to let auth settle first
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep Render backend alive — ping /health every 10 min to prevent cold starts
  useEffect(() => {
    const BACKEND = (import.meta.env.VITE_API_URL || 'https://fidel-bingo.onrender.com/api')
      .replace('/api', '');
    const ping = () => fetch(`${BACKEND}/health`, { method: 'GET' }).catch(() => {});
    ping();
    const id = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(id);
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
      <Suspense fallback={<PageFallback />}>
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
            <Route path="/owner" element={<OwnerDashboard />} />
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

          <Route path="*" element={<Navigate to="/play" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
