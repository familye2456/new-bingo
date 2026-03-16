import { create } from 'zustand';
import { authApi } from '../services/api';

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

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,

  login: async (identifier, password) => {
    set({ loading: true });
    try {
      const res = await authApi.login({ identifier, password });
      set({ user: res.data.data.user, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  logout: async () => {
    await authApi.logout();
    set({ user: null });
  },

  fetchMe: async () => {
    try {
      const res = await authApi.me();
      set({ user: res.data.data, initialized: true });
    } catch {
      set({ user: null, initialized: true });
    }
  },
}));
