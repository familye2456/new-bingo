import { create } from 'zustand';
import { authApi } from '../services/api';
import { dbPut, dbGet, dbClear } from '../services/db';
import { api } from '../services/api';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  balance?: number;
  firstName?: string;
  lastName?: string;
  paymentType?: string;
  status?: string;
}

export interface CacheStep {
  label: string;
  status: 'pending' | 'loading' | 'done' | 'skipped';
}

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  cacheSteps: CacheStep[];
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  adjustUserBalance: (delta: number) => void;
}

const STEPS: CacheStep[] = [
  { label: 'Profile',      status: 'pending' },
  { label: 'Cartelas',     status: 'pending' },
  { label: 'Games',        status: 'pending' },
  { label: 'Transactions', status: 'pending' },
];

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,
  cacheSteps: [],

  login: async (identifier, password) => {
    set({ loading: true, cacheSteps: [] });
    try {
      const res = await authApi.login({ identifier, password });
      const { user, accessToken } = res.data.data;
      if (accessToken) localStorage.setItem('access_token', accessToken);
      await dbPut('user', user, 'me');

      if (user.paymentType === 'prepaid') {
        // Show download screen — NOT initialized yet, user stays blocked
        set({ user, loading: false, initialized: false });

        const steps: CacheStep[] = STEPS.map(s => ({ ...s }));
        set({ cacheSteps: steps });

        const mark = (i: number, status: CacheStep['status']) => {
          steps[i] = { ...steps[i], status };
          set({ cacheSteps: [...steps] });
        };

        const fetches: Array<{ url: string; store: string; key?: string }> = [
          { url: '/users/me',              store: 'user',         key: 'me' },
          { url: '/cartelas/mine',         store: 'cartelas' },
          { url: '/games/mine',            store: 'games' },
          { url: '/users/me/transactions', store: 'transactions' },
        ];

        for (let i = 0; i < fetches.length; i++) {
          mark(i, 'loading');
          try {
            const r = await api.get(fetches[i].url);
            const data = r.data.data;
            if (fetches[i].key) {
              await dbPut(fetches[i].store, data, fetches[i].key);
            } else {
              for (const item of (data ?? [])) await dbPut(fetches[i].store, item);
            }
            mark(i, 'done');
          } catch {
            mark(i, 'skipped');
          }
        }

        // All done — now open the app
        set({ initialized: true });
      } else {
        // Non-prepaid: no cache needed, open immediately
        set({ user, loading: false, initialized: true });
      }
    } catch (err) {
      set({ loading: false, cacheSteps: [] });
      throw err;
    }
  },

  logout: async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem('access_token');
    await Promise.all([
      dbClear('user'),
      dbClear('cartelas'),
      dbClear('games'),
      dbClear('transactions'),
      dbClear('syncQueue'),
    ]);
    set({ user: null, cacheSteps: [], initialized: false });
    window.location.href = '/login';
  },

  /** Lightweight balance-only refresh — hits /users/me and updates just the balance field */
  refreshBalance: async () => {
    if (!navigator.onLine) return;
    try {
      const res = await api.get('/users/me');
      const fresh = res.data?.data as User;
      if (fresh?.id) {
        await dbPut('user', fresh, 'me');
        set((state) => ({
          user: state.user ? { ...state.user, balance: fresh.balance } : fresh,
        }));
      }
    } catch {}
  },

  adjustUserBalance: (delta: number) => {
    set((state) => {
      if (!state.user) return state;
      return { user: { ...state.user, balance: (Number(state.user.balance) || 0) + delta } };
    });
  },

  fetchMe: async () => {
    // Try server first — only use cache as fallback if offline/unreachable
    try {
      const res = await api.get('/users/me');
      const fresh = res.data?.data as User;
      if (fresh?.id) {
        await dbPut('user', fresh, 'me');
        set({ user: fresh, initialized: true });
        return;
      }
    } catch (err: any) {
      // HTTP error (401 etc) — not authenticated, don't fall back to cache
      if (err?.response?.status) {
        set({ user: null, initialized: true });
        return;
      }
      // Network error — fall back to cached user
    }

    // Offline fallback
    const cached = await dbGet<User>('user', 'me');
    set({ user: cached ?? null, initialized: true });
  },
}));
