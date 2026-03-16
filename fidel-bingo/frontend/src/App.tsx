import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, initialized } = useAuthStore();
  if (!initialized) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (!adminOnly && user.role === 'admin') return <Navigate to="/admin" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  const { fetchMe } = useAuthStore();

  useEffect(() => {
    fetchMe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/game/:gameId" element={<ProtectedRoute><GamePage /></ProtectedRoute>} />

          {/* Player section */}
          <Route path="/dashboard" element={<ProtectedRoute><UserLayout /></ProtectedRoute>}>
            <Route index element={<UserDashboard />} />
            <Route path="play" element={<PlayBingo />} />
            <Route path="new-game" element={<NewGame />} />
            <Route path="cartelas" element={<MyCartelas />} />
            <Route path="balance" element={<BalanceHistory />} />
            <Route path="settings" element={<Settings />} />
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
    </QueryClientProvider>
  );
};

export default App;
