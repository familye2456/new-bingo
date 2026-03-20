import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (!navigator.onLine) return Promise.reject(error);
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/refresh')
    ) {
      original._retry = true;
      try {
        await api.post('/auth/refresh');
        return api(original);
      } catch {
        // Refresh failed — only redirect if on a protected page
        const path = window.location.pathname;
        if (!path.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/auth/register', data),
  login: (data: { identifier: string; password: string }) =>
    api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/users/me'),
};

export const adminApi = {
  listUsers: () => api.get('/users'),
  getUser: (id: string) => api.get(`/users/${id}`),
  createUser: (data: { username: string; email: string; password: string; firstName?: string; lastName?: string; phone?: string }) =>
    api.post('/users', data),
  updateUser: (id: string, data: { firstName?: string; lastName?: string; email?: string; username?: string; phone?: string; paymentType?: string }) =>
    api.patch(`/users/${id}`, data),
  activateUser: (id: string) => api.patch(`/users/${id}/activate`),
  deactivateUser: (id: string) => api.patch(`/users/${id}/deactivate`),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  topUpBalance: (id: string, amount: number) => api.patch(`/users/${id}/balance`, { amount }),
  getUserTransactions: (id: string) => api.get(`/users/${id}/transactions`),
  getUserCartelas: (id: string) => api.get(`/users/${id}/cartelas`),
};

export const cartelaAdminApi = {
  list: (params?: Record<string, string>) => api.get('/cartelas', { params }),
  get: (id: string) => api.get(`/cartelas/${id}`),
  assign: (data: { userId: string; cardNumber: number }) => api.post('/cartelas/assign', data),
  assignRange: (data: { fromCard: number; toCard: number; userId: string }) =>
    api.post('/cartelas/assign-range', data),
  unassign: (id: string, userId: string) => api.patch(`/cartelas/${id}/unassign`, { userId }),
  unassignRange: (data: { fromCard: number; toCard: number; userId: string }) =>
    api.post('/cartelas/unassign-range', data),
  update: (id: string, data: { isActive?: boolean; userId?: string; numbers?: number[] }) =>
    api.patch(`/cartelas/${id}`, data),
};

export const userApi = {
  updateMe: (data: { firstName?: string; lastName?: string }) =>
    api.patch('/users/me', data),
  myCartelas: () => api.get('/cartelas/mine'),
  myTransactions: () => api.get('/users/me/transactions'),
};

export const gameApi = {
  list: (status?: string) => api.get('/games', { params: { status } }),
  myGames: () => api.get('/games/mine'),
  get: (id: string) => api.get(`/games/${id}`),
  create: (data: { cartelaIds: string[]; betAmountPerCartela: number; winPattern?: string }) =>
    api.post('/games', data),
  getCartelas: (gameId: string) => api.get(`/games/${gameId}/cartelas`),
  join: (gameId: string, cartelaCount: number) =>
    api.post(`/games/${gameId}/join`, { cartelaCount }),
  start: (gameId: string) => api.post(`/games/${gameId}/start`),
  callNumber: (gameId: string) => api.post(`/games/${gameId}/call`),
  finish: (gameId: string) => api.post(`/games/${gameId}/finish`),
  claimBingo: (gameId: string, cartelaId: string) =>
    api.post(`/games/${gameId}/bingo`, { cartelaId }),
  markNumber: (cartelaId: string, number: number) =>
    api.post(`/games/cartelas/${cartelaId}/mark`, { number }),
};
