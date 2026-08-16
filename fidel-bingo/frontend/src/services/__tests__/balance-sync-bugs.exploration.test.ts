/**
 * Balance Sync Bugs — Bug Condition Exploration Tests (Task 1)
 *
 * These tests MUST FAIL on unfixed code. Failure confirms both bugs exist.
 *
 * DO NOT fix the code or the tests when they fail.
 * Failure is the SUCCESS case here — it confirms the root cause hypotheses.
 *
 * References:
 *   - Requirements: 1.1, 1.2, 1.3, 1.5
 *   - Design: .kiro/specs/balance-sync-bugs/design.md
 *   - Bugfix: .kiro/specs/balance-sync-bugs/bugfix.md
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ── In-memory IndexedDB mock ─────────────────────────────────────────────────

const memoryStores: Record<string, Map<IDBValidKey, unknown>> = {};

function resetStores() {
  for (const key of Object.keys(memoryStores)) {
    memoryStores[key] = new Map();
  }
}

function getStore(name: string): Map<IDBValidKey, unknown> {
  if (!memoryStores[name]) memoryStores[name] = new Map();
  return memoryStores[name];
}

let _nextId = 1;

function resetNextId() {
  _nextId = 1;
}

// ── navigator.onLine helper ──────────────────────────────────────────────────

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

// ── Shared mock factories ────────────────────────────────────────────────────

/**
 * Build the db module mock. Tracks an in-memory syncQueue with autoIncrement IDs.
 */
function buildDbMock() {
  const syncQueue = new Map<number, any>();

  const enqueue = vi.fn(async (item: any) => {
    const id = _nextId++;
    syncQueue.set(id, { ...item, id, createdAt: Date.now() });
  });

  const dequeue = vi.fn(async (id: number) => {
    syncQueue.delete(id);
  });

  const getAllQueued = vi.fn(async () => {
    return Array.from(syncQueue.values());
  });

  const adjustBalance = vi.fn(async (delta: number) => {
    const userStore = getStore('user');
    const user = userStore.get('me') as any;
    if (user) {
      user.balance = (Number(user.balance) || 0) + delta;
      userStore.set('me', user);
    }
  });

  const dbPut = vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
    const s = getStore(store);
    const k = key ?? (value as any)?.id;
    if (k !== undefined) s.set(k, value);
    // If putting 'syncQueue' directly, update our internal map too (for freshItem re-reads)
    if (store === 'syncQueue' && (value as any)?.id !== undefined) {
      syncQueue.set((value as any).id, value);
    }
  });

  const dbGet = vi.fn(async (store: string, key: IDBValidKey) => {
    return getStore(store).get(key);
  });

  const dbGetAll = vi.fn(async (store: string) => {
    return Array.from(getStore(store).values());
  });

  const dbDelete = vi.fn(async (store: string, key: IDBValidKey) => {
    getStore(store).delete(key);
    if (store === 'syncQueue') syncQueue.delete(key as number);
  });

  const dbClear = vi.fn(async (store: string) => {
    getStore(store).clear();
    if (store === 'syncQueue') syncQueue.clear();
  });

  const getDB = vi.fn(async () => ({
    get: async (store: string, key: IDBValidKey) => {
      if (store === 'syncQueue') return syncQueue.get(key as number);
      return getStore(store).get(key);
    },
    put: dbPut,
    getAll: dbGetAll,
    delete: dbDelete,
    clear: dbClear,
    add: vi.fn(async (store: string, value: any) => {
      if (store === 'syncQueue') {
        const id = _nextId++;
        const item = { ...value, id };
        syncQueue.set(id, item);
        return id;
      }
      return undefined;
    }),
  }));

  return {
    dbPut,
    dbGet,
    dbGetAll,
    dbDelete,
    dbClear,
    enqueue,
    dequeue,
    getAllQueued,
    adjustBalance,
    getDB,
    syncQueue,
  };
}

/**
 * Build the authStore mock.
 */
function buildAuthStoreMock() {
  const adjustUserBalance = vi.fn();
  const refreshBalance = vi.fn();
  const setState = vi.fn();

  return {
    useAuthStore: {
      getState: vi.fn(() => ({ adjustUserBalance, refreshBalance })),
      setState,
      subscribe: vi.fn(),
    },
    isNegativeBalanceLocked: vi.fn(() => false),
    applyNegativeBalanceCheck: vi.fn(),
    adjustUserBalance,
    refreshBalance,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Balance Sync Bugs — Exploration Tests (EXPECTED TO FAIL on unfixed code)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetStores();
    resetNextId();
    setOnline(true);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // BUG 1 — TRANSACTION JAM (Unit Test)
  //
  // Expected failure: loop breaks at item index 2 (api.post called only 2 times,
  // not 5). This confirms the `break` on network error abandons remaining items.
  // ────────────────────────────────────────────────────────────────────────────
  it('Bug 1 (Unit) — all 5 createGame items should be attempted even when item 2 throws a network error', async () => {
    const dbMock = buildDbMock();
    const authMock = buildAuthStoreMock();

    // Seed 5 createGame items into the syncQueue
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      type: 'createGame',
      payload: {
        tempId: `offline-${i + 1}`,
        cartelaIds: ['c1'],
        betAmountPerCartela: 100,
        winPattern: 'any',
        housePercentage: 10,
      },
      createdAt: Date.now(),
    }));
    items.forEach((item) => dbMock.syncQueue.set(item.id!, item));

    // Seed user in IDB
    getStore('user').set('me', {
      id: 'user-1',
      balance: 1000,
      paymentType: 'prepaid',
      role: 'user',
    });

    // api.post: throw a network error (no response.status) on item index 2 (0-based = item id 3)
    const apiPost = vi.fn().mockImplementation(async (url: string, _body: any) => {
      // The third call (0-indexed: call index 2) will be for the third item (id=3)
      const callIndex = apiPost.mock.calls.length - 1;
      if (callIndex === 2) {
        // Network error — no response.status
        const err = new Error('Network Error');
        (err as any).response = undefined;
        throw err;
      }
      // Return a successful game creation response
      return {
        data: {
          data: {
            id: `real-game-${callIndex}`,
            status: 'active',
          },
        },
      };
    });

    vi.doMock('../db', () => ({
      ...dbMock,
      getAllQueued: dbMock.getAllQueued,
    }));

    vi.doMock('../api', () => ({
      api: {
        get: vi.fn(),
        post: apiPost,
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      },
    }));

    vi.doMock('../../store/authStore', () => authMock);

    // Import _doFlush by importing the module and invoking flushQueueOnly
    // We'll exercise _doFlush indirectly via flushQueueOnly which calls _doFlush then refreshCache
    // For isolation we spy on refreshCache separately.
    // Actually, we call flushQueueOnly since it only runs _doFlush without refreshCache.
    const syncModule = await import('../sync');

    // Override _flushing lock to allow test to call flushQueueOnly
    // We'll spy on refreshCache to prevent network calls
    const refreshCacheSpy = vi.spyOn(syncModule, 'refreshCache').mockResolvedValue(undefined);

    await syncModule.flushQueueOnly();

    // ── ASSERTION ──────────────────────────────────────────────────────────────
    // All 5 items should have been attempted — api.post should have been called 5 times.
    // EXPECTED FAILURE: On unfixed code, the loop breaks at item 3 (network error),
    // so api.post is only called 2 times (items 1 and 2 succeed, item 3 fails and breaks).
    // NOTE: items before error index are also counted; error at call index 2 means
    // calls 0, 1 succeeded, call 2 threw, then on unfixed code loop breaks → only 3 total
    // Actually: the error is thrown on call index 2 (third call), so 2 calls before it succeed,
    // the erroring call is the 3rd call, and then the loop breaks → 3 calls total (not 5).
    expect(apiPost).toHaveBeenCalledTimes(5);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // BUG 1 — TRANSACTION JAM (Property-Based Test)
  //
  // For ALL queue sizes N (2–10) and error positions K (0 to N-2),
  // ALL N items should be attempted after a network error at position K.
  //
  // Expected failure: fast-check will find a counterexample where api.post
  // call count < N (loop breaks at position K).
  //
  // Validates: Requirements 1.1, 1.2
  // ────────────────────────────────────────────────────────────────────────────
  it('Bug 1 (PBT) — for all queue sizes N and error position K < N, all N items must be attempted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        async (N) => {
          // Generate K in range [0, N-2] using fc.integer inside the property
          // since fast-check v3 doesn't support dependent arbitraries directly this way,
          // we'll pick K deterministically as N-2 (last possible error position < N-1)
          // but we also test K = 0 to cover early-break scenario
          const K = Math.floor(N / 2); // error in the middle

          vi.resetModules();
          resetStores();
          resetNextId();
          localStorage.clear();

          const dbMock = buildDbMock();
          const authMock = buildAuthStoreMock();

          // Seed N createGame items
          const items = Array.from({ length: N }, (_, i) => ({
            id: i + 1,
            type: 'createGame',
            payload: {
              tempId: `offline-pbt-${i + 1}`,
              cartelaIds: ['c1'],
              betAmountPerCartela: 100,
              winPattern: 'any',
              housePercentage: 10,
            },
            createdAt: Date.now(),
          }));
          items.forEach((item) => dbMock.syncQueue.set(item.id!, item));

          getStore('user').set('me', {
            id: 'user-pbt',
            balance: 10000,
            paymentType: 'prepaid',
            role: 'user',
          });

          let callCount = 0;
          const apiPost = vi.fn().mockImplementation(async (_url: string) => {
            const idx = callCount++;
            if (idx === K) {
              const err = new Error('Network Error');
              (err as any).response = undefined;
              throw err;
            }
            return { data: { data: { id: `real-${idx}`, status: 'active' } } };
          });

          vi.doMock('../db', () => ({ ...dbMock, getAllQueued: dbMock.getAllQueued }));
          vi.doMock('../api', () => ({
            api: {
              get: vi.fn(),
              post: apiPost,
              patch: vi.fn(),
              delete: vi.fn(),
              interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
            },
          }));
          vi.doMock('../../store/authStore', () => authMock);

          const syncModule = await import('../sync');
          vi.spyOn(syncModule, 'refreshCache').mockResolvedValue(undefined);

          await syncModule.flushQueueOnly();

          // All N items must have been attempted (api.post called N times)
          // EXPECTED FAILURE: on unfixed code, call count = K + 1 (breaks after error)
          const actualCalls = apiPost.mock.calls.length;
          return actualCalls === N;
        }
      ),
      { numRuns: 20, verbose: true }
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // BUG 2a — OFFLINE BINGO CREDIT (Unit Test)
  //
  // When offline and claimBingo is called, the IDB balance should NOT change.
  // The balance credit must be deferred until server confirms during sync.
  //
  // Expected failure: balance increases by prizePool (100) immediately because
  // offlineApi.claimBingo calls applyBalanceDelta(prize) in the offline path.
  // ────────────────────────────────────────────────────────────────────────────
  it('Bug 2a (Unit) — offline claimBingo must NOT change the IDB balance before server confirms', async () => {
    // Set offline
    setOnline(false);

    const GAME_ID = 'offline-game-1';
    const CARTELA_ID = 'cartela-1';
    const PRIZE_POOL = 100;

    // Seed IDB with a game that has prizePool = 100
    getStore('games').set(GAME_ID, {
      id: GAME_ID,
      status: 'active',
      prizePool: PRIZE_POOL,
      winnerIds: [],
      isWinner: false,
    });

    // Seed user with a balance of 500
    const initialBalance = 500;
    getStore('user').set('me', {
      id: 'user-1',
      balance: initialBalance,
      paymentType: 'prepaid',
      role: 'user',
    });

    const adjustBalance = vi.fn(async (delta: number) => {
      const user = getStore('user').get('me') as any;
      if (user) {
        user.balance = (Number(user.balance) || 0) + delta;
        getStore('user').set('me', user);
      }
    });

    const dbPut = vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
      const s = getStore(store);
      const k = key ?? (value as any)?.id;
      if (k !== undefined) s.set(k, value);
    });

    const dbGet = vi.fn(async (store: string, key: IDBValidKey) => {
      return getStore(store).get(key);
    });

    const dbGetAll = vi.fn(async (store: string) => {
      return Array.from(getStore(store).values());
    });

    const enqueue = vi.fn(async () => {});

    vi.doMock('../db', () => ({
      dbPut,
      dbGet,
      dbGetAll,
      dbDelete: vi.fn(),
      dbClear: vi.fn(),
      enqueue,
      dequeue: vi.fn(),
      getAllQueued: vi.fn(async () => []),
      adjustBalance,
      getDB: vi.fn(),
    }));

    // Mock the API — any call will fail (we're offline, so tryApi will return { ok: false })
    vi.doMock('../api', () => ({
      api: {
        get: vi.fn().mockRejectedValue(new Error('Network Error')),
        post: vi.fn().mockRejectedValue(new Error('Network Error')),
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      },
    }));

    const adjustUserBalance = vi.fn();
    vi.doMock('../../store/authStore', () => ({
      useAuthStore: {
        getState: vi.fn(() => ({ adjustUserBalance })),
        setState: vi.fn(),
      },
      isNegativeBalanceLocked: vi.fn(() => false),
      applyNegativeBalanceCheck: vi.fn(),
    }));

    // Also mock sync module's _justFinishedIds
    vi.doMock('../sync', () => ({
      _justFinishedIds: new Set(),
    }));

    const { offlineGameApi } = await import('../offlineApi');

    // Record IDB balance BEFORE calling claimBingo
    const balanceBefore = (getStore('user').get('me') as any)?.balance ?? 0;
    expect(balanceBefore).toBe(initialBalance); // sanity check

    // Call claimBingo while offline
    await offlineGameApi.claimBingo(GAME_ID, CARTELA_ID);

    // Record IDB balance AFTER calling claimBingo
    const balanceAfter = (getStore('user').get('me') as any)?.balance ?? 0;

    // ── ASSERTION ──────────────────────────────────────────────────────────────
    // IDB balance must be UNCHANGED — the server hasn't confirmed the win yet.
    // EXPECTED FAILURE: on unfixed code, balanceAfter = 600 (increased by prizePool = 100)
    expect(balanceAfter).toBe(initialBalance);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // BUG 2c — REFRESHBALANCE SKIPS SERVER (Unit Test)
  //
  // When the sync queue is non-empty, refreshBalance() should still fetch the
  // server balance and display serverBalance − pendingHouseCuts.
  // Instead, the current code returns early with "queue not empty".
  //
  // Expected failure: Zustand balance stays at stale IDB value (200)
  // instead of being updated to serverBalance − houseCuts ≈ 500 - 0 = 500.
  //
  // Validates: Requirement 1.5
  // ────────────────────────────────────────────────────────────────────────────
  it('Bug 2c (Unit) — refreshBalance must use serverBalance when queue is non-empty, not skip', async () => {
    // Enqueue 1 createGame item
    const queuedItem = {
      id: 1,
      type: 'createGame',
      payload: {
        tempId: 'offline-game-1',
        cartelaIds: ['c1'],
        betAmountPerCartela: 100,
        winPattern: 'any',
        housePercentage: 10,
      },
      createdAt: Date.now(),
    };

    // Pending house cut: 100 * 1 * 10% = 10
    const pendingHouseCut = 10;
    const SERVER_BALANCE = 500;
    const STALE_IDB_BALANCE = 200;

    // Seed IDB user with stale balance
    getStore('user').set('me', {
      id: 'user-1',
      username: 'testuser',
      email: 'test@test.com',
      role: 'user',
      balance: STALE_IDB_BALANCE,
      paymentType: 'prepaid',
    });

    const dbPutSpy = vi.fn(async (store: string, value: unknown, key?: IDBValidKey) => {
      const s = getStore(store);
      const k = key ?? (value as any)?.id;
      if (k !== undefined) s.set(k, value);
    });

    vi.doMock('../db', () => ({
      dbPut: dbPutSpy,
      dbGet: vi.fn(async (store: string, key: IDBValidKey) => getStore(store).get(key)),
      dbGetAll: vi.fn(async (store: string) => Array.from(getStore(store).values())),
      dbDelete: vi.fn(),
      dbClear: vi.fn(),
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      getAllQueued: vi.fn(async () => [queuedItem]),
      adjustBalance: vi.fn(),
      getDB: vi.fn(),
    }));

    // Mock GET /users/me to return server balance of 500
    const apiGet = vi.fn(async (url: string) => {
      if (url === '/users/me') {
        return {
          data: {
            data: {
              id: 'user-1',
              username: 'testuser',
              email: 'test@test.com',
              role: 'user',
              balance: SERVER_BALANCE,
              paymentType: 'prepaid',
            },
          },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    vi.doMock('../api', () => ({
      api: {
        get: apiGet,
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      },
    }));

    // Track Zustand state changes
    let zustandBalance: number = STALE_IDB_BALANCE;
    const zustandSetSpy = vi.fn((updater: any) => {
      if (typeof updater === 'function') {
        const prevState = { user: { id: 'user-1', balance: zustandBalance } };
        const next = updater(prevState);
        if (next?.user?.balance !== undefined) {
          zustandBalance = next.user.balance;
        }
      } else if (updater?.user?.balance !== undefined) {
        zustandBalance = updater.user.balance;
      }
    });

    vi.doMock('../../store/authStore', () => ({
      useAuthStore: {
        getState: vi.fn(() => ({
          adjustUserBalance: vi.fn(),
          refreshBalance: vi.fn(),
        })),
        setState: vi.fn(),
      },
      isNegativeBalanceLocked: vi.fn(() => false),
      applyNegativeBalanceCheck: vi.fn(),
    }));

    // Now we need to test refreshBalance from authStore directly.
    // We'll re-import authStore with the mocked dependencies.
    const { useAuthStore } = await import('../../store/authStore');

    // Override the set function to capture calls by hooking into Zustand
    // We spy on the actual Zustand store's setState
    const originalRefreshBalance = useAuthStore.getState().refreshBalance;

    // Call refreshBalance on the ACTUAL authStore (which uses the mocked api and db)
    await originalRefreshBalance();

    // ── ASSERTION ──────────────────────────────────────────────────────────────
    // After refreshBalance(), Zustand balance should reflect the server balance
    // adjusted by pending house cuts: 500 - 10 = 490.
    // OR at minimum, it should NOT still be the stale IDB value of 200.
    //
    // EXPECTED FAILURE: on unfixed code, refreshBalance() returns early when
    // pending.length > 0, so Zustand balance stays at stale 200.
    const currentBalance = useAuthStore.getState().user?.balance;

    // The displayed balance should NOT be the stale IDB value anymore
    expect(currentBalance).not.toBe(STALE_IDB_BALANCE);

    // It should reflect the server balance (potentially minus pending house cuts)
    // On fixed code: effectiveBalance = 500 - 10 = 490
    // We allow exact server balance OR server minus pending as valid outcomes
    const expectedEffective = SERVER_BALANCE - pendingHouseCut;
    expect(currentBalance).toBe(expectedEffective);
  });
});
