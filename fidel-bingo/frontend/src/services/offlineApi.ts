/**
 * Offline-aware API — falls back to IndexedDB when the server is unreachable.
 * Offline fallback only applies to prepaid users.
 */
import { api } from './api';
import { dbGet, dbGetAll, dbPut, enqueue, adjustBalance } from './db';
import { useAuthStore } from '../store/authStore';
import { _justFinishedIds } from './sync';

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
  // Always try the server when online — don't short-circuit on _serverDown
  // so stale IDB data never gets stuck after a brief hiccup
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

/** Fisher-Yates shuffle of numbers 1–75 */
function shuffleSequence(): number[] {
  const arr = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Safely extract an array from any response shape */
function toList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.data?.data)) return data.data.data;
  return [];
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const offlineAuthApi = {
  me: async () => {
    try {
      const result = await tryApi(() => api.get('/users/me'));
      if (result.ok) {
        await dbPut('user', result.data.data, 'me'); // result.data = { success, data: user }
        return result.data;
      }
    } catch {
      // server up but auth failed — fall through to cache
    }
    const cached = await dbGet<any>('user', 'me');
    if (cached) return { data: cached };
    throw new Error('Not authenticated');
  },
};

// ── User ─────────────────────────────────────────────────────────────────────

export const offlineUserApi = {
  updateMe: (data: object) => api.patch('/users/me', data),

  myCartelas: async (): Promise<any[]> => {
    // Return IDB cache immediately, then refresh in background
    const cached = await dbGetAll<any>('cartelas');
    const result = await tryApi(() => api.get('/cartelas/mine'));
    if (result.ok) {
      const list = toList(result.data);
      await Promise.all(list.map((c: any) => dbPut('cartelas', c)));
      return list;
    }
    return cached;
  },

  myTransactions: async (): Promise<any[]> => {
    if (navigator.onLine) {
      try {
        const res = await api.get('/users/me/transactions');
        const serverList = toList(res.data);
        await Promise.all(serverList.map((t: any) => dbPut('transactions', t)));
        // Merge offline transactions not yet synced
        const allLocal = await dbGetAll<any>('transactions');
        const offlineTx = allLocal.filter((t: any) =>
          String(t.id).startsWith('tx-bet-offline-') || String(t.id).startsWith('tx-win-offline-')
        );
        return [...serverList, ...offlineTx];
      } catch (err: any) {
        if (err?.response?.status) throw err;
      }
    }
    // Both prepaid and postpaid fall back to cache when offline
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
      const list = toList(result.data);
      await Promise.all(list.map((g: any) => dbPut('games', g)));
      // Also include offline games with matching status
      const allLocal = await dbGetAll<any>('games');
      const offlineGames = allLocal.filter((g: any) =>
        String(g.id).startsWith('offline-') &&
        (!_status || g.status === _status)
      );
      const serverIds = new Set(list.map((g: any) => g.id));
      const uniqueOffline = offlineGames.filter((g: any) => !serverIds.has(g.id));
      return [...list, ...uniqueOffline];
    }
    // Offline fallback — all users get cached data
    const all = await dbGetAll<any>('games');
    return _status ? all.filter((g: any) => g.status === _status) : all;
  },

  myGames: async (): Promise<any[]> => {
    if (navigator.onLine) {
      try {
        const res = await api.get('/games/mine');
        const serverList = toList(res.data);

        // Preserve locally-finished status in case server hasn't caught up yet
        const allLocal = await dbGetAll<any>('games');
        const localFinishedIds = new Set([
          ...allLocal.filter((g: any) => g.status === 'finished').map((g: any) => String(g.id)),
          ..._justFinishedIds,
        ]);
        const mergedList = serverList.map((g: any) => {
          const local = allLocal.find((l: any) => String(l.id) === String(g.id));
          const base = {
            ...g,
            // Preserve locally-patched cartelaIds — server doesn't return them on /games/mine
            cartelaIds: g.cartelaIds ?? local?.cartelaIds,
          };
          return localFinishedIds.has(String(g.id)) && g.status !== 'finished'
            ? { ...base, status: 'finished' }
            : base;
        });

        for (const g of mergedList) await dbPut('games', g);
        // Merge still-pending offline games, deduplicate by id
        const offlineGames = allLocal.filter((g: any) => String(g.id).startsWith('offline-'));
        const serverIds = new Set(serverList.map((g: any) => g.id));
        const uniqueOffline = offlineGames.filter((g: any) => !serverIds.has(g.id));
        return [...mergedList, ...uniqueOffline];
      } catch (err: any) {
        if (err?.response?.status) throw err;
      }
    }
    // All users fall back to IDB cache when server is unreachable
    const user = await dbGet<any>('user', 'me');
    const all = await dbGetAll<any>('games');
    const seen = new Set<string>();
    const deduped = all.filter((g: any) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    return user ? deduped.filter((g: any) => g.creatorId === user.id) : deduped;
  },

  get: async (id: string): Promise<any> => {
    const result = await tryApi(() => api.get(`/games/${id}`));
    if (result.ok) return result.data.data.data;
    // All users fall back to cache when server is unreachable
    return dbGet('games', id);
  },

  /**
   * Create a game.
   * Online  → POST to server, cache result in background, navigate immediately.
   * Offline → save locally, enqueue for sync.
   */
  create: async (data: { cartelaIds: string[]; betAmountPerCartela: number; winPattern?: string; housePercentage?: number }) => {
    const HOUSE_PCT = data.housePercentage ?? 10;
    const result = await tryApi(() => api.post('/games', data));
    if (result.ok) {
      const game = result.data.data.data;
      // Cache in background — don't block navigation
      Promise.resolve().then(async () => {
        await dbPut('games', { ...game, cartelaIds: data.cartelaIds });
        await dbPut('gameCartelas', data.cartelaIds, game.id);
        await _writeBetTransactions(game.id, data.cartelaIds, data.betAmountPerCartela, Number(game.housePercentage ?? HOUSE_PCT));
        useAuthStore.getState().refreshBalance();
      }).catch(() => {});
      return result.data;
    }

    // Server unreachable — fall back to IDB for all users
    const user = await dbGet<any>('user', 'me');
    const tempId = `offline-${Date.now()}`;
    const now = new Date().toISOString();
    const totalBet = data.betAmountPerCartela * data.cartelaIds.length;
    const houseCut = totalBet * (HOUSE_PCT / 100);
    const prizePool = totalBet - houseCut;

    const game = {
      id: tempId, status: 'active', betAmount: data.betAmountPerCartela,
      cartelaCount: data.cartelaIds.length, totalBets: totalBet, prizePool, houseCut,
      housePercentage: HOUSE_PCT, calledNumbers: [], numberSequence: shuffleSequence(),
      winnerIds: [], isWinner: false, winPattern: data.winPattern ?? 'any',
      creatorId: user?.id ?? '', createdAt: now, cartelaIds: data.cartelaIds,
    };

    await dbPut('games', game);
    await dbPut('gameCartelas', data.cartelaIds, tempId);
    await _writeBetTransactions(tempId, data.cartelaIds, data.betAmountPerCartela, HOUSE_PCT);
    await applyBalanceDelta(-houseCut);
    await enqueue({ type: 'createGame', payload: { tempId, ...data } });
    return { data: { data: game } };
  },

  reset: async (gameId: string) => {
    if (!String(gameId).startsWith('offline-')) {
      const result = await tryApi(() => api.post(`/games/${gameId}/reset`));
      if (result.ok) {
        const cached = await dbGet<any>('games', gameId);
        if (cached) { cached.calledNumbers = []; await dbPut('games', cached); }
        return result.data;
      }
    }
    const game = await dbGet<any>('games', gameId);
    if (game) { game.calledNumbers = []; await dbPut('games', game); }
    return { data: { success: true } };
  },

  callNumber: async (gameId: string) => {
    if (!String(gameId).startsWith('offline-')) {
      const result = await tryApi(() => api.post(`/games/${gameId}/call`));
      if (result.ok) {
        const num: number | undefined = result.data.data?.data?.number;
        if (num != null) {
          const cached = await dbGet<any>('games', gameId);
          if (cached) {
            cached.calledNumbers = [...(cached.calledNumbers ?? []), num];
            await dbPut('games', cached);
          }
        }
        return result.data;
      }
    }

    // Server unreachable — use IDB for all users
    const game = await dbGet<any>('games', gameId);
    if (!game) return { data: { data: { number: null, remaining: 0 } } };

    const called: number[] = game.calledNumbers ?? [];
    const nextIndex = called.length;
    if (nextIndex >= 75) return { data: { data: { number: null, remaining: 0 } } };

    // Use pre-generated sequence; generate one if missing (legacy offline game)
    if (!game.numberSequence || game.numberSequence.length !== 75) {
      game.numberSequence = shuffleSequence();
    }

    const number = game.numberSequence[nextIndex];
    game.calledNumbers = [...called, number];
    await dbPut('games', game);

    return { data: { data: { number, remaining: 75 - game.calledNumbers.length } } };
  },

  /**
   * Finish a game.
   * Online  → POST to server, update cached game status.
   * Offline → mark finished locally, enqueue for sync.
   */
  finish: async (gameId: string) => {
    // If offline game, skip server call — just mark locally and enqueue
    if (!String(gameId).startsWith('offline-')) {
      const result = await tryApi(() => api.post(`/games/${gameId}/finish`));
      if (result.ok) {
        const game = await dbGet<any>('games', gameId);
        if (game) { game.status = 'finished'; await dbPut('games', game); }
        return result.data;
      }
    }

    // Server unreachable — mark locally and enqueue for all users
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
      // { success, data: { valid, amount } }
      const amount = Number(result.data.data?.data?.amount ?? 0);
      if (amount > 0) await applyBalanceDelta(amount);
      return result.data;
    }

    // Server unreachable — handle locally for all users
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
    // Enqueue for all users when offline
    await enqueue({ type: 'markNumber', payload: { cartelaId, number } });
    return { data: { data: null } };
  },

  getCartelas: async (gameId: string) => {
    const result = await tryApi(() => api.get(`/games/${gameId}/cartelas`));
    if (result.ok) {
      const list = toList(result.data);
      const ids: string[] = [];
      for (const c of list) {
        if (c.id) { await dbPut('cartelas', c); ids.push(c.id); }
      }
      // Persist gameId → cartelaIds mapping in its own store (survives server cache overwrites)
      if (ids.length > 0) await dbPut('gameCartelas', ids, gameId);
      // Also patch the cached game record for backward compat
      const cachedGame = await dbGet<any>('games', gameId);
      if (cachedGame) {
        cachedGame.cartelaIds = ids;
        await dbPut('games', cachedGame);
      }
      return result.data;
    }
    return { data: { data: [] } };
  },

  checkCartela: async (gameId: string, cardNumber: number) => {
    // If it's an offline game, always use local check — server doesn't know about it yet
    if (!String(gameId).startsWith('offline-')) {
      const result = await tryApi(() => api.get(`/games/${gameId}/check/${cardNumber}`));
      if (result.ok) return result.data.data.data;
    }

    // ── Offline fallback ──────────────────────────────────────────────────────
    const game = await dbGet<any>('games', gameId);
    if (!game) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    // Find cartela by cardNumber in IDB
    const allCartelas = await dbGetAll<any>('cartelas');
    const cartela = allCartelas.find((c: any) => c.cardNumber === cardNumber);
    if (!cartela) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    // Check membership: use dedicated gameCartelas store first (most reliable),
    // then fall back to game.cartelaIds (set on offline games and patched on online games)
    const storedIds = await dbGet<string[]>('gameCartelas', gameId);
    const cartelaIdList: string[] = storedIds
      ?? (Array.isArray(game.cartelaIds) ? game.cartelaIds : []);

    const inGame = cartelaIdList.includes(cartela.id);
    if (!inGame) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    const called: number[] = game.calledNumbers ?? [];
    const mask: boolean[] = (cartela.numbers as number[]).map((n, i) =>
      i === 12 ? true : called.includes(n)
    );

    // Replicate WinnerDetection — a "line" is any row, column, diagonal, or four corners
    const countLines = (): number => {
      let n = 0;
      for (let r = 0; r < 5; r++) if ([0,1,2,3,4].every(c => mask[r*5+c])) n++;
      for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every(r => mask[r*5+c])) n++;
      if ([0,6,12,18,24].every(i => mask[i])) n++;
      if ([4,8,12,16,20].every(i => mask[i])) n++;
      if (mask[0] && mask[4] && mask[20] && mask[24]) n++;
      return n;
    };

    const checkWin = (pattern: string): boolean => {
      switch (pattern) {
        case 'line1': return countLines() >= 1;
        case 'line2': return countLines() >= 2;
        case 'line3': return countLines() >= 3;
        case 'fullhouse':
        case 'blackout': return mask.every(Boolean);
        case 'fourCorners': return mask[0] && mask[4] && mask[20] && mask[24];
        case 'X':    return [0,6,12,18,24].every(i => mask[i]) && [4,8,12,16,20].every(i => mask[i]);
        case 'plus': return [10,11,12,13,14].every(i => mask[i]) && [2,7,12,17,22].every(i => mask[i]);
        case 'T':    return [0,1,2,3,4].every(i => mask[i]) && [2,7,12,17,22].every(i => mask[i]);
        case 'L':    return [0,5,10,15,20].every(i => mask[i]) && [20,21,22,23,24].every(i => mask[i]);
        case 'frame': return [0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24].every(i => mask[i]);
        default: return countLines() >= 1;
      }
    };

    const getWinPattern = (): string | null => {
      if (mask.every(Boolean)) return 'fullhouse';
      if (checkWin('frame')) return 'frame';
      if (checkWin('X')) return 'X';
      if (checkWin('plus')) return 'plus';
      if (checkWin('T')) return 'T';
      if (checkWin('L')) return 'L';
      if (checkWin('fourCorners')) return 'fourCorners';
      const lines = countLines();
      if (lines === 0) return null;
      if (lines >= 3) return 'line3';
      if (lines >= 2) return 'line2';
      return 'line1';
    };

    const winPattern = getWinPattern();
    const isWinner = checkWin(game.winPattern ?? 'line1');

    return { registered: true, cardNumber, numbers: cartela.numbers, patternMask: mask, isWinner, winPattern };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _writeBetTransactions(gameId: string, cartelaIds: string[], betPerCartela: number, housePct: number) {
  const user = await dbGet<any>('user', 'me');
  const totalBet = betPerCartela * cartelaIds.length;
  const houseCut = totalBet * (housePct / 100);
  await dbPut('transactions', {
    id: `tx-bet-${gameId}`,
    transactionType: 'bet',
    amount: houseCut,
    status: 'completed',
    description: `House fee for game ${gameId.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    userId: user?.id,
  });
}
