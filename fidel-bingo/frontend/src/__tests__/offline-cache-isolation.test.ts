/**
 * Offline Cache (IndexedDB) Isolation Test — Task 5.2
 *
 * Validates: Requirement 2.2
 *
 * After the backend fix, GET /games/:gameId/cartelas returns only the
 * requesting user's own cartelas. This test verifies that when
 * offlineGameApi.getCartelas() populates the IndexedDB cache from that
 * response, only the requesting user's own cartela data is stored.
 *
 * The IndexedDB population logic lives in offlineApi.ts:
 *   getCartelas: async (gameId) => {
 *     const result = await tryApi(() => api.get(`/games/${gameId}/cartelas`));
 *     if (result.ok) {
 *       const list = toList(result.data);
 *       for (const c of list) {
 *         if (c.id) { await dbPut('cartelas', c); ids.push(c.id); }
 *       }
 *       if (ids.length > 0) await dbPut('gameCartelas', ids, gameId);
 *       ...
 *     }
 *   }
 *
 * The test mocks the API response to simulate the fixed backend (only the
 * requesting user's cartelas are returned) and then asserts that IndexedDB
 * contains only those cartelas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── In-memory IndexedDB mock ─────────────────────────────────────────────────

/** Simple in-memory store that mimics the idb dbPut / dbGet / dbGetAll API */
const memoryStores: Record<string, Map<IDBValidKey, unknown>> = {};

function resetStores() {
  for (const key of Object.keys(memoryStores)) {
    delete memoryStores[key];
  }
}

function getStore(name: string): Map<IDBValidKey, unknown> {
  if (!memoryStores[name]) memoryStores[name] = new Map();
  return memoryStores[name];
}

// ── navigator.onLine mock ────────────────────────────────────────────────────

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Offline cache (IndexedDB) isolation — Task 5.2 (Requirement 2.2)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetStores();
    setOnline(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Core isolation test.
   *
   * The fixed API returns only User A's cartela for game "g1".
   * After getCartelas() runs, the 'cartelas' store must contain only
   * User A's cartela — not any other user's data.
   *
   * Validates: Requirement 2.2
   */
  it('IndexedDB stores only the requesting user\'s own cartela data after cache population', async () => {
    const USER_A_ID = 'user-a-uuid';
    const GAME_ID = 'game-1-uuid';

    // Fixed API response: only User A's cartela is returned
    const userACartela = {
      id: 'cartela-a-uuid',
      userId: USER_A_ID,
      cardNumber: 101,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      betAmount: 50,
    };

    // Mock the db module so we can inspect what gets written to IndexedDB
    vi.doMock('../services/db', () => ({
      dbPut: vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
        const s = getStore(store);
        const k = key ?? (value as any)?.id;
        if (k !== undefined) s.set(k, value);
      }),
      dbGet: vi.fn(async (store: string, key: IDBValidKey) => {
        return getStore(store).get(key);
      }),
      dbGetAll: vi.fn(async (store: string) => {
        return Array.from(getStore(store).values());
      }),
      dbDelete: vi.fn(async () => {}),
      dbClear: vi.fn(async () => {}),
      enqueue: vi.fn(async () => {}),
      adjustBalance: vi.fn(async () => {}),
    }));

    // Mock the api module — fixed backend returns only User A's cartela
    vi.doMock('../services/api', () => ({
      api: {
        get: vi.fn(async (url: string) => {
          if (url === `/games/${GAME_ID}/cartelas`) {
            return { data: { success: true, data: [userACartela] } };
          }
          throw new Error(`Unexpected GET ${url}`);
        }),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      },
    }));

    // Also mock authStore (imported transitively by offlineApi)
    vi.doMock('../store/authStore', () => ({
      useAuthStore: {
        getState: vi.fn(() => ({
          adjustUserBalance: vi.fn(),
          refreshBalance: vi.fn(),
        })),
      },
    }));

    const { offlineGameApi } = await import('../services/offlineApi');
    const { dbGetAll, dbGet } = await import('../services/db');

    // Call getCartelas — this populates IndexedDB from the API response
    const result = await offlineGameApi.getCartelas(GAME_ID);

    // ── Assert: API response shape ──────────────────────────────────────────
    // The response data should contain only User A's cartela
    const responseData: any[] = result?.data?.data ?? [];
    expect(responseData).toHaveLength(1);
    expect(responseData[0].userId).toBe(USER_A_ID);
    expect(responseData[0].id).toBe('cartela-a-uuid');

    // ── Assert: IndexedDB 'cartelas' store ──────────────────────────────────
    // Only User A's cartela should be stored — no other user's data
    const cachedCartelas = await dbGetAll('cartelas') as any[];
    expect(cachedCartelas).toHaveLength(1);
    expect(cachedCartelas[0].id).toBe('cartela-a-uuid');
    expect(cachedCartelas[0].userId).toBe(USER_A_ID);

    // ── Assert: IndexedDB 'gameCartelas' store ──────────────────────────────
    // The gameId → cartelaIds mapping should contain only User A's cartela ID
    const cachedIds = await dbGet('gameCartelas', GAME_ID) as string[];
    expect(cachedIds).toEqual(['cartela-a-uuid']);
  });

  /**
   * Multi-user scenario: the fixed API returns only User B's cartelas when
   * User B calls the endpoint. Verifies that User A's cartela data is NOT
   * stored in the cache for User B's session.
   *
   * Validates: Requirement 2.2
   */
  it('IndexedDB does not store other users\' cartela data when the fixed API scopes the response', async () => {
    const USER_A_ID = 'user-a-uuid';
    const USER_B_ID = 'user-b-uuid';
    const GAME_ID = 'game-1-uuid';

    // Fixed API response for User B: only User B's cartela is returned
    const userBCartela = {
      id: 'cartela-b-uuid',
      userId: USER_B_ID,
      cardNumber: 202,
      numbers: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 0, 65, 70, 75, 1, 2, 3, 4, 6, 7, 8, 9, 11],
      betAmount: 100,
    };

    vi.doMock('../services/db', () => ({
      dbPut: vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
        const s = getStore(store);
        const k = key ?? (value as any)?.id;
        if (k !== undefined) s.set(k, value);
      }),
      dbGet: vi.fn(async (store: string, key: IDBValidKey) => {
        return getStore(store).get(key);
      }),
      dbGetAll: vi.fn(async (store: string) => {
        return Array.from(getStore(store).values());
      }),
      dbDelete: vi.fn(async () => {}),
      dbClear: vi.fn(async () => {}),
      enqueue: vi.fn(async () => {}),
      adjustBalance: vi.fn(async () => {}),
    }));

    vi.doMock('../services/api', () => ({
      api: {
        get: vi.fn(async (url: string) => {
          if (url === `/games/${GAME_ID}/cartelas`) {
            // Fixed backend: only User B's cartela is returned for User B's request
            return { data: { success: true, data: [userBCartela] } };
          }
          throw new Error(`Unexpected GET ${url}`);
        }),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      },
    }));

    vi.doMock('../store/authStore', () => ({
      useAuthStore: {
        getState: vi.fn(() => ({
          adjustUserBalance: vi.fn(),
          refreshBalance: vi.fn(),
        })),
      },
    }));

    const { offlineGameApi } = await import('../services/offlineApi');
    const { dbGetAll } = await import('../services/db');

    await offlineGameApi.getCartelas(GAME_ID);

    const cachedCartelas = await dbGetAll('cartelas') as any[];

    // User A's cartela must NOT be in the cache
    const userAInCache = cachedCartelas.some((c: any) => c.userId === USER_A_ID);
    expect(userAInCache).toBe(false);

    // Only User B's cartela should be present
    expect(cachedCartelas).toHaveLength(1);
    expect(cachedCartelas[0].userId).toBe(USER_B_ID);
  });

  /**
   * Empty response: when the user has no cartelas in the game, the fixed API
   * returns an empty array. The cache should remain empty for this game.
   *
   * Validates: Requirement 2.2
   */
  it('IndexedDB stores no cartela data when the fixed API returns an empty array', async () => {
    const GAME_ID = 'game-empty-uuid';

    vi.doMock('../services/db', () => ({
      dbPut: vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
        const s = getStore(store);
        const k = key ?? (value as any)?.id;
        if (k !== undefined) s.set(k, value);
      }),
      dbGet: vi.fn(async (store: string, key: IDBValidKey) => {
        return getStore(store).get(key);
      }),
      dbGetAll: vi.fn(async (store: string) => {
        return Array.from(getStore(store).values());
      }),
      dbDelete: vi.fn(async () => {}),
      dbClear: vi.fn(async () => {}),
      enqueue: vi.fn(async () => {}),
      adjustBalance: vi.fn(async () => {}),
    }));

    vi.doMock('../services/api', () => ({
      api: {
        get: vi.fn(async () => ({
          data: { success: true, data: [] },
        })),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      },
    }));

    vi.doMock('../store/authStore', () => ({
      useAuthStore: {
        getState: vi.fn(() => ({
          adjustUserBalance: vi.fn(),
          refreshBalance: vi.fn(),
        })),
      },
    }));

    const { offlineGameApi } = await import('../services/offlineApi');
    const { dbGetAll, dbGet } = await import('../services/db');

    await offlineGameApi.getCartelas(GAME_ID);

    const cachedCartelas = await dbGetAll('cartelas') as any[];
    expect(cachedCartelas).toHaveLength(0);

    // gameCartelas store should have no entry for this game (ids array was empty)
    const cachedIds = await dbGet('gameCartelas', GAME_ID);
    expect(cachedIds).toBeUndefined();
  });
});
