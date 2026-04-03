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
  count?: number;
  total?: number;   // for SW step: total assets expected
  cached?: number;  // for SW step: assets cached so far
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
  { label: 'App & Sounds', status: 'pending' },
];

/** Wait for the service worker to finish installing and caching all assets, with progress */
async function waitForSWReady(
  onProgress: (cached: number, total: number) => void
): Promise<void> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.installing ?? reg.waiting;

    // Poll Cache Storage for progress
    const poll = async () => {
      try {
        const cacheNames = await caches.keys();
        let cached = 0;
        for (const name of cacheNames) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          cached += keys.length;
        }
        return cached;
      } catch { return 0; }
    };

    if (!sw) {
      // SW already active — just count what's cached
      const cached = await poll();
      onProgress(cached, cached || 1);
      return;
    }

    // Poll every 500ms while SW is installing
    await new Promise<void>((resolve) => {
      let lastCached = 0;

      const interval = setInterval(async () => {
        const cached = await poll();
        if (cached !== lastCached) {
          lastCached = cached;
          onProgress(cached, Math.max(cached, lastCached));
        }
      }, 500);

      sw.addEventListener('statechange', async function handler(e) {
        if ((e.target as ServiceWorker).state === 'activated') {
          sw.removeEventListener('statechange', handler);
          clearInterval(interval);
          const final = await poll();
          onProgress(final, final || 1);
          resolve();
        }
      });

      // Timeout after 90s
      setTimeout(() => { clearInterval(interval); resolve(); }, 90_000);
    });
  } catch {
    // SW not available — ignore
  }
}

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
        // Skip download screen if already cached for this user
        const cacheKey = `sw_cached_${user.id}`;
        const alreadyCached = localStorage.getItem(cacheKey) === '1';

        if (alreadyCached) {
          set({ user, loading: false, initialized: true });
        } else {
          // Show download screen — NOT initialized yet, user stays blocked
          set({ user, loading: false, initialized: false });

          const steps: CacheStep[] = STEPS.map(s => ({ ...s }));
          set({ cacheSteps: steps });

          const mark = (i: number, status: CacheStep['status'], count?: number) => {
            steps[i] = { ...steps[i], status, ...(count !== undefined ? { count } : {}) };
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
                mark(i, 'done', 1);
              } else {
                const items = data ?? [];
                for (const item of items) await dbPut(fetches[i].store, item);
                mark(i, 'done', items.length);
              }
            } catch {
              mark(i, 'skipped');
            }
          }

          // Mark as cached now (data is in IndexedDB) so next login skips this screen
          // even if the user closes before the SW finishes installing
          localStorage.setItem(cacheKey, '1');

          // Wait for service worker to finish caching all app assets & sounds
          // Only block if SW is still installing (first install). Skip if already active.
          mark(4, 'loading');
          const swAlreadyActive = await (async () => {
            if (!('serviceWorker' in navigator)) return true;
            try {
              const reg = await navigator.serviceWorker.ready;
              return !reg.installing && !reg.waiting;
            } catch { return true; }
          })();

          if (swAlreadyActive) {
            mark(4, 'done');
          } else {
            await waitForSWReady((cached, total) => {
              steps[4] = { ...steps[4], status: 'loading', cached, total };
              set({ cacheSteps: [...steps] });
            });
            mark(4, 'done', steps[4].cached);
          }

          // All done — now open the app
          set({ initialized: true });
        }
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
