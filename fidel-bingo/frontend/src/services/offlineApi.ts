/**
 * Offline-aware API — falls back to IndexedDB when the server is unreachable.
 * Offline fallback only applies to prepaid users.
 */
import { api } from './api';
import { dbGet, dbGetAll, dbPut, enqueue, adjustBalance } from './db';
import { useAuthStore } from '../store/authStore';

/** Update both IndexedDB and Zustand store atomically */
async function applyBalanceDelta(delta: number) {
  await adjustBalance(delta);
  useAuthStore.getState().adjustUserBalance(delta);
}

// ── Server reachability ───────────────────────────────────────────────────────

let _serverDown = false;

export function isOnline() {
  return navigator.onLine && !_serverDown;
}

async function tryApi<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  if (!navigator.onLine) {
    _serverDown = true;
    return { ok: false };
  }
  try {
    const data = await fn();
    _serverDown = false;
    return { ok: true, data };
  } catch (err: any) {
    // If we got an HTTP status back, server is up — re-throw (e.g. 401, 400)
    if (err?.response?.status) {
      _serverDown = false;
      throw err;
    }
    // No status = network error = server unreachable
    _serverDown = true;
    return { ok: false };
  }
}

async function isPrepaid(): Promise<boolean> {
  const user = await dbGet<{ paymentType?: string }>('user', 'me');
  if (!user) return false;
  return !user.paymentType || user.paymentType === 'prepaid';
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const offlineAuthApi = {
  me: async () => {
    try {
      const result = await tryApi(() => api.get('/users/me'));
      if (result.ok) {
        await dbPut('user', result.data.data.data, 'me');
        return result.data;
      }
    } catch {
      // server up but auth failed — fall through to cache
    }
    const cached = await dbGet<any>('user', 'me');
    if (cached) return { data: { data: cached } };
    throw new Error('Not authenticated');
  },
};

// ── User ─────────────────────────────────────────────────────────────────────

export const offlineUserApi = {
  updateMe: (data: object) => api.patch('/users/me', data),

  myCartelas: async (): Promise<any[]> => {
    const result = await tryApi(() => api.get('/cartelas/mine'));
    if (result.ok) {
      const list = result.data.data.data ?? [];
      for (const c of list) await dbPut('cartelas', c);
      return list;
    }
    return dbGetAll<any>('cartelas');
  },

  myTransactions: async (): Promise<any[]> => {
    const result = await tryApi(() => api.get('/users/me/transactions'));
    if (result.ok) {
      const list = result.data.data.data ?? [];
      for (const t of list) await dbPut('transactions', t);
      return list;
    }
    return dbGetAll<any>('transactions');
  },
};

// ── Games ─────────────────────────────────────────────────────────────────────

export const offlineGameApi = {
  list: async (_status?: string): Promise<any[]> => {
    const result = await tryApi(() =>
      api.get('/games', { params: _status ? { status: _status } : undefined })
    );
    if (result.ok) {
      const list = result.data.data.data ?? [];
      for (const g of list) await dbPut('games', g);
      return list;
    }
    return dbGetAll<any>('games');
  },

  myGames: async (): Promise<any[]> => {
    const result = await tryApi(() => api.get('/games/mine'));
    if (result.ok) {
      const list = result.data.data.data ?? [];
      for (const g of list) await dbPut('games', g);
      return list;
    }
    const user = await dbGet<any>('user', 'me');
    const all = await dbGetAll<any>('games');
    return user ? all.filter((g: any) => g.creatorId === user.id) : all;
  },

  get: async (id: string): Promise<any> => {
    const result = await tryApi(() => api.get(`/games/${id}`));
    if (result.ok) return result.data.data.data;
    if (await isPrepaid()) return dbGet('games', id);
    return null;
  },

  /**
   * Create a game.
   * Online  → POST to server, cache result + write bet transactions + deduct balance.
   * Offline → save locally, write bet transactions, deduct balance, enqueue for sync.
   */
  create: async (data: { cartelaIds: string[]; betAmountPerCartela: number; winPattern?: string }) => {
    const HOUSE_PCT = 10; // must match backend HOUSE_PERCENTAGE
    const result = await tryApi(() => api.post('/games', data));
    if (result.ok) {
      const game = result.data.data.data;
      await dbPut('games', game);
      await _writeBetTransactions(game.id, data.cartelaIds, data.betAmountPerCartela);
      // Deduct only houseCut — same as updated server behaviour
      const houseCut = data.betAmountPerCartela * data.cartelaIds.length * (HOUSE_PCT / 100);
      await applyBalanceDelta(-houseCut);
      return result.data;
    }

    if (!(await isPrepaid())) throw new Error('Server unavailable');

    const user = await dbGet<any>('user', 'me');
    const tempId = `offline-${Date.now()}`;
    const now = new Date().toISOString();
    const totalBet = data.betAmountPerCartela * data.cartelaIds.length;
    const houseCut = totalBet * (HOUSE_PCT / 100);
    // prizePool = totalBets (house cut already taken upfront)
    const prizePool = totalBet;

    const game = {
      id: tempId,
      status: 'active',
      betAmount: data.betAmountPerCartela,
      cartelaCount: data.cartelaIds.length,
      totalBets: totalBet,
      prizePool,
      houseCut,
      housePercentage: HOUSE_PCT,
      calledNumbers: [],
      winnerIds: [],
      isWinner: false,
      winPattern: data.winPattern ?? 'any',
      creatorId: user?.id ?? '',
      createdAt: now,
      cartelaIds: data.cartelaIds,
    };

    await dbPut('games', game);
    await _writeBetTransactions(tempId, data.cartelaIds, data.betAmountPerCartela);
    // Deduct only houseCut from local balance
    await applyBalanceDelta(-houseCut);
    await enqueue({ type: 'createGame', payload: { tempId, ...data } });

    return { data: { data: game } };
  },

  callNumber: async (gameId: string) => {
    const result = await tryApi(() => api.post(`/games/${gameId}/call`));
    if (result.ok) {
      // Keep local game in sync with server response
      const called = result.data.data.data?.calledNumbers;
      if (called) {
        const game = await dbGet<any>('games', gameId);
        if (game) { game.calledNumbers = called; await dbPut('games', game); }
      }
      return result.data;
    }

    if (!(await isPrepaid())) throw new Error('Server unavailable');

    const game = await dbGet<any>('games', gameId);
    if (!game) return { data: { data: { number: null, remaining: 0 } } };

    const called: number[] = game.calledNumbers ?? [];
    const pool = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !called.includes(n));
    if (pool.length === 0) return { data: { data: { number: null, remaining: 0 } } };

    const number = pool[Math.floor(Math.random() * pool.length)];
    game.calledNumbers = [...called, number];
    await dbPut('games', game);
    // Don't enqueue individual callNumber — server will re-derive state from finish

    return { data: { data: { number, remaining: pool.length - 1 } } };
  },

  /**
   * Finish a game.
   * Online  → POST to server, update cached game status.
   * Offline → mark finished locally, enqueue for sync.
   */
  finish: async (gameId: string) => {
    const result = await tryApi(() => api.post(`/games/${gameId}/finish`));
    if (result.ok) {
      const game = await dbGet<any>('games', gameId);
      if (game) { game.status = 'finished'; await dbPut('games', game); }
      return result.data;
    }

    if (!(await isPrepaid())) throw new Error('Server unavailable');

    const game = await dbGet<any>('games', gameId);
    if (game) {
      game.status = 'finished';
      await dbPut('games', game);
    }
    await enqueue({ type: 'finishGame', payload: { gameId } });
    return { data: { data: null } };
  },

  /**
   * Claim bingo.
   * Online  → POST to server, add prize to local balance from server response.
   * Offline → mark winner locally, write win transaction, add prizePool to balance, enqueue.
   */
  claimBingo: async (gameId: string, cartelaId: string) => {
    const result = await tryApi(() => api.post(`/games/${gameId}/bingo`, { cartelaId }));
    if (result.ok) {
      // Server returns the actual share amount — update local balance
      const amount = Number(result.data.data.data?.amount ?? 0);
      if (amount > 0) await applyBalanceDelta(amount);
      return result.data;
    }

    if (!(await isPrepaid())) throw new Error('Server unavailable');

    const [game, user] = await Promise.all([
      dbGet<any>('games', gameId),
      dbGet<any>('user', 'me'),
    ]);

    if (game) {
      game.isWinner = true;
      game.winnerIds = [...(game.winnerIds ?? []), user?.id].filter(Boolean);
      await dbPut('games', game);

      // prizePool is already correctly calculated (totalBets - houseCut)
      const prize = Number(game.prizePool ?? 0);
      if (prize > 0) {
        await dbPut('transactions', {
          id: `tx-win-${gameId}-${cartelaId}`,
          transactionType: 'win',
          amount: prize,
          status: 'completed',
          description: `Won game ${gameId.slice(0, 8)}`,
          createdAt: new Date().toISOString(),
          userId: user?.id,
        });
        await applyBalanceDelta(prize);
      }
    }

    await enqueue({ type: 'claimBingo', payload: { gameId, cartelaId } });
    return { data: { data: null } };
  },

  markNumber: async (cartelaId: string, number: number) => {
    const result = await tryApi(() => api.post(`/games/cartelas/${cartelaId}/mark`, { number }));
    if (result.ok) return result.data;
    if (await isPrepaid()) {
      await enqueue({ type: 'markNumber', payload: { cartelaId, number } });
      return { data: { data: null } };
    }
    throw new Error('Server unavailable');
  },

  getCartelas: async (gameId: string) => {
    const result = await tryApi(() => api.get(`/games/${gameId}/cartelas`));
    if (result.ok) return result.data;
    return { data: { data: [] } };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write a single bet transaction locally (mirrors what the server creates —
 * one transaction for the total bet, not one per cartela).
 */
async function _writeBetTransactions(gameId: string, cartelaIds: string[], betPerCartela: number) {
  const user = await dbGet<any>('user', 'me');
  const totalBet = betPerCartela * cartelaIds.length;
  await dbPut('transactions', {
    id: `tx-bet-${gameId}`,
    transactionType: 'bet',
    amount: totalBet,
    status: 'completed',
    description: `Bet for game ${gameId.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    userId: user?.id,
  });
}
