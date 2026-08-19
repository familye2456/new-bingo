import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { GamePage } from './pages/GamePage';
import { getSocket } from './services/socket';

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
const AdminBalancePage   = lazy(() => import('./pages/admin/AdminBalancePage').then(m => ({ default: m.AdminBalancePage })));

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

const CLIENT_VERSION = import.meta.env.VITE_APP_VERSION || '2.0.1';

const UpdateRequired: React.FC = () => {
  const [updating, setUpdating] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const updateClient = async () => {
    setUpdating(true);
    setProgress(10);
    
    try {
      // Step 1: Update service worker
      setProgress(30);
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
      
      // Step 2: Clear all caches
      setProgress(60);
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      
      // Step 3: Unregister service worker
      setProgress(80);
      await registration?.unregister();
      
      // Step 4: Clear local storage flags
      setProgress(90);
      localStorage.removeItem('neg_balance_locked');
      
      setProgress(100);
    } finally {
      // Always reload after cleanup, even if some steps failed
      setTimeout(() => window.location.reload(), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-6" 
      style={{ 
        background: 'linear-gradient(135deg, #0a1220 0%, #1a1f35 100%)',
        backdropFilter: 'blur(10px)'
      }}>
      <div className="w-full max-w-md text-center">
        {/* Animated logo */}
        <div className="relative mb-8">
          <div className="absolute inset-0 animate-ping opacity-20">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 mx-auto" />
          </div>
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mx-auto overflow-hidden shadow-2xl"
            style={{ boxShadow: '0 0 60px rgba(251,191,36,0.4)' }}>
            <img src="/icons/logo.png" alt="Fidel Bingo" className="w-full h-full object-contain" />
          </div>
        </div>

        {/* Title with pulse animation */}
        <h1 className="text-white text-2xl font-bold mb-3 animate-pulse">
          Update Required
        </h1>
        
        <p className="text-gray-400 text-sm mb-2">
          A new version of Fidel Bingo is available.
        </p>
        <p className="text-yellow-400 text-xs font-semibold mb-8">
          ⚠️ You must update to continue using the app
        </p>

        {/* Update button */}
        <button 
          onClick={updateClient} 
          disabled={updating}
          className="w-full px-6 py-4 rounded-xl text-base font-bold shadow-xl transform transition-all hover:scale-105 disabled:hover:scale-100 disabled:opacity-90"
          style={{ 
            background: updating 
              ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' 
              : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
            color: '#111',
            boxShadow: '0 8px 32px rgba(251,191,36,0.3)'
          }}>
          {updating ? (
            <div className="flex items-center justify-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-gray-800/30 border-t-gray-800 animate-spin" />
              <span>Updating... {progress}%</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Update Now
            </div>
          )}
        </button>

        {/* Progress bar */}
        {updating && (
          <div className="mt-6">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div 
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                  boxShadow: '0 0 8px rgba(251,191,36,0.5)'
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Please wait, don't close this window...
            </p>
          </div>
        )}

        {/* Info */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <p className="text-xs text-gray-600 mb-2">
            This ensures you have the latest features and bug fixes
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-700">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/40" />
            <span>System will restart automatically</span>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const { user, initialized, cacheSteps, negativeBalance, lastPositiveBalance } = useAuthStore();
  const [showRestoredBanner, setShowRestoredBanner] = React.useState(false);

  // Listen for recovery event from sync.ts
  React.useEffect(() => {
    const handler = () => {
      setShowRestoredBanner(true);
      setTimeout(() => setShowRestoredBanner(false), 6000);
    };
    window.addEventListener('balance-restored', handler);
    return () => window.removeEventListener('balance-restored', handler);
  }, []);

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

  // Block prepaid players with negative balance — must top up before continuing
  if (negativeBalance && !adminOnly && user.role === 'player' && user.paymentType === 'prepaid') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0a1220' }}>
        <div className="w-full max-w-xs text-center">
          {/* Icon */}
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>

          <p className="text-white font-bold text-xl mb-1">Account Locked</p>
          <p className="text-gray-500 text-sm mb-6">Your balance went negative. All features are disabled until your admin tops up your account.</p>

          {/* Balance info */}
          <div className="rounded-2xl px-5 py-4 mb-4 space-y-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Current balance</span>
              <span className="text-red-400 font-bold text-base">{Number(user.balance ?? 0).toFixed(2)} Birr</span>
            </div>
            {lastPositiveBalance !== null && (
              <div className="flex items-center justify-between border-t border-white/5 pt-3">
                <span className="text-xs text-gray-500">Last positive balance</span>
                <span className="text-emerald-400 font-semibold text-sm">{lastPositiveBalance.toFixed(2)} Birr</span>
              </div>
            )}
          </div>

          {/* Contact admin */}
          <div className="rounded-2xl px-5 py-4 mb-6 text-left"
            style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <p className="text-yellow-400 text-xs font-semibold mb-3 uppercase tracking-wide">Contact Admin</p>
            <a href="tel:+251911234567"
              className="flex items-center gap-3 text-white text-sm font-medium hover:text-yellow-400 transition-colors">
              <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              +251 911 234 567
            </a>
          </div>

          <p className="text-xs text-gray-600">Checking for updates every 15 seconds…</p>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Restored banner — shown briefly after admin resolves the negative balance */}
      {showRestoredBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-lg flex items-center gap-3 text-sm font-medium text-white"
          style={{ background: 'rgba(16,185,129,0.95)', backdropFilter: 'blur(12px)' }}>
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Balance restored — insufficient funds were cleared. You can play again.
        </div>
      )}
      {children}
    </>
  );
};

// Inner component — lives inside QueryClientProvider so useQueryClient works
const AppRoutes: React.FC = () => {
  const { fetchMe, refreshBalance } = useAuthStore();
  const qc = useQueryClient();
  const fetchedRef = React.useRef(false);
  const [updateRequired, setUpdateRequired] = React.useState(false);
  const [versionChecked, setVersionChecked] = React.useState(false);

  // Check for version updates — runs on mount and every 30 seconds
  const checkVersion = React.useCallback(async () => {
    try {
      if (!navigator.onLine) return false;
      
      const response = await fetch(
        `${(import.meta.env.VITE_API_URL || 'https://fidel-bingo.onrender.com/api')}/version`,
        { cache: 'no-store' }
      );
      
      if (response.ok) {
        const { version } = await response.json();
        console.log('[version] Client:', CLIENT_VERSION, 'Server:', version);
        
        if (version && version !== CLIENT_VERSION) {
          console.log('[version] Update required!');
          setUpdateRequired(true);
          return true;
        }
      }
    } catch (err) {
      console.warn('[version] Check failed:', err);
    }
    return false;
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return; // prevent double-invoke in React dev mode
    fetchedRef.current = true;
    
    const initialize = async () => {
      const needsUpdate = await checkVersion();
      
      if (!needsUpdate) {
        fetchMe();
        const token = localStorage.getItem('access_token');
        if (token) getSocket(token);
        import('./services/sync').then(({ startPeriodicSync }) => startPeriodicSync());
        if (navigator.onLine) {
          import('./services/sync').then(({ syncWhenOnline }) => setTimeout(syncWhenOnline, 2000));
        }
      }
      
      setVersionChecked(true);
    };
    
    initialize();
  }, [checkVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous version checking every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      checkVersion();
    }, 30_000); // 30 seconds
    
    return () => clearInterval(interval);
  }, [checkVersion]);

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

  if (!versionChecked) return <Splash />;
  if (updateRequired) return <UpdateRequired />;

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
            <Route path="balance" element={<AdminBalancePage />} />
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
