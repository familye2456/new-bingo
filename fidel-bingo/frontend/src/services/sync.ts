/**
 * Online/offline sync manager.
 */
import { api } from './api';
import { dbGet, dbPut, dbPutMany, dbGetAll, dbDelete, dbClear, dequeue, getAllQueued } from './db';
import { useAuthStore, applyNegativeBalanceCheck, isNegativeBalanceLocked } from '../store/authStore';

async function isPrepaid(): Promise<boolean> {
  const user = await dbGet<{ paymentType?: string }>('user', 'me');
  if (!user) return false;
  // FIX: Only return true if paymentType is explicitly 'prepaid'.
  return user.paymentType === 'prepaid';
}

// ── Global flush lock — prevents concurrent flushes ───────────────────────────
let _flushing = false;
let _refreshCacheRetryAt = 0;
const REFRESH_CACHE_RETRY_COOLDOWN_MS = 60_000;

// Persist synced tempIds across page reloads to prevent duplicate POSTs
const SYNCED_KEY = 'synced_temp_ids';

// Negative balance localStorage keys — declared here so refreshCache can access them
const NEG_BAL_KEY = 'neg_balance_last_positive';
function getSyncedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]')); } catch { return new Set(); }
}
function addSyncedId(id: string) {
  const ids = getSyncedIds();
  ids.add(id);
  localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
}
function isSynced(id: string): boolean { return getSyncedIds().has(id); }

// ── Active game session flag ──────────────────────────────────────────────────
// Set to true while auto-call is running to prevent refreshCache from flooding
// IDB with bulk cartela writes that compete with game-critical dbPut calls.
let _gameSessionActive = false;
export function setGameSessionActive(active: boolean) { _gameSessionActive = active; }
export function isGameSessionActive() { return _gameSessionActive; }

// ── Cache refresh ─────────────────────────────────────────────────────────────

export async function refreshCache() {
  if (Date.now() < _refreshCacheRetryAt) return;

  try {
    const requests: Promise<any>[] = [
      api.get('/users/me'),
      api.get('/cartelas/mine'),  // always fetch — never skip based on cache
      api.get('/games/mine'),
      api.get('/users/me/transactions'),
    ];

    const [meRes, cartelasRes, gamesRes, txRes] = await Promise.all(requests);

    const meData = meRes.data?.data ?? meRes.data;

    // ⭐ Balance sync: after queue flush all games are on the server — use server balance directly.
    // For prepaid players, push local IDB balance ONLY if there are no queued games left
    // (i.e. this is a periodic refresh, not a post-flush refresh).
    // Post-flush: server already has the authoritative balance from processing every game.
    if (meData) {
      const localUser = await dbGet<any>('user', 'me');
      const isLocked = localStorage.getItem('neg_balance_locked') === '1';

      if (isLocked && localUser) {
        // Account locked due to negative balance — preserve local negative so player stays blocked
        console.log(`[balance] refreshCache: locked, preserving local balance=${localUser.balance}`);
        meData.balance = localUser.balance;
      } else {
        // Server balance is always authoritative after sync.
        // Do NOT subtract pending queue items here — local balance was already reduced
        // by offlineApi at the time each offline game was created. Subtracting again
        // causes double-deduction and shows the wrong (too low) balance.
        const serverBalance = Number(meData.balance ?? 0);
        console.log(`[balance] refreshCache: using server balance=${serverBalance}`);
        meData.balance = serverBalance;
        if (serverBalance > 0) localStorage.setItem(NEG_BAL_KEY, String(serverBalance));
      }
    }
    await dbPut('user', meData, 'me');

    // Set balance in Zustand directly from the value we just wrote to IDB
    if (meData?.id) {
      const newBalance = Number(meData.balance);
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, balance: newBalance } : state.user,
      }));
    }

    const toList = (d: any) => Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.data) ? d.data.data : [];

    // Always clear and repopulate cartelas — ensures no stale data from another user
    // Skip during active game sessions to avoid flooding IDB and causing timeouts
    if (!_gameSessionActive) {
      const userId = meData?.id;
      await dbClear('cartelas');
      await dbPutMany('cartelas', toList(cartelasRes.data).map((c: any) => ({ ...c, userId })).filter((c: any) => c.id));
    }

    const serverGames = toList(gamesRes.data);
    const localGames = await dbGetAll<any>('games');
    const cachedUser = await dbGet<any>('user', 'me');
    const preserveLocalGameState = !cachedUser || cachedUser.paymentType !== 'postpaid';
    const offlineGames = localGames.filter((g: any) => String(g.id).startsWith('offline-'));
    // Preserve finished status: locally marked finished OR just finished in this flush cycle
    const localFinishedIds = new Set([
      ...localGames.filter((g: any) => g.status === 'finished').map((g: any) => String(g.id)),
      ..._justFinishedIds,
    ]);
    const serverGameIds = new Set(serverGames.map((g: any) => g.id));
    await dbClear('games');
    const mergedGames = serverGames.map((g: any) => {
      const localGame = localGames.find((l: any) => String(l.id) === String(g.id));
      const merged = {
        ...g,
        cartelaIds: g.cartelaIds ?? localGame?.cartelaIds,
        ...(preserveLocalGameState && localGame?.numberSequence
          ? { numberSequence: localGame.numberSequence }
          : {}),
        ...(preserveLocalGameState && localGame?.calledNumbers
          ? { calledNumbers: localGame.calledNumbers }
          : {}),
      };
      return localFinishedIds.has(String(g.id)) && g.status !== 'finished'
        ? { ...merged, status: 'finished' }
        : merged;
    });
    const preservedOfflineGames = offlineGames.filter((g: any) => !serverGameIds.has(g.id));
    await dbPutMany('games', [...mergedGames, ...preservedOfflineGames]);

    const serverTx = toList(txRes.data);
    const localTx = await dbGetAll<any>('transactions');
    const offlineTx = localTx.filter((t: any) =>
      String(t.id).startsWith('tx-bet-offline-') || String(t.id).startsWith('tx-win-offline-')
    );
    await dbClear('transactions');
    await dbPutMany('transactions', [...serverTx, ...offlineTx]);

    window.dispatchEvent(new CustomEvent('cache-refreshed'));
  } catch {
    // Back off briefly when Render is unavailable or rate-limiting requests.
    _refreshCacheRetryAt = Date.now() + REFRESH_CACHE_RETRY_COOLDOWN_MS;
  }
}

// ── Core flush logic (shared) ─────────────────────────────────────────────────

// Track game IDs finished during the current flush so refreshCache won't overwrite them
export const _justFinishedIds = new Set<string>();

async function _doFlush() {
  _justFinishedIds.clear();

  const items = await getAllQueued();
  if (items.length === 0) return;

  console.log(`[sync] flushing ${items.length} queued items`);

  for (const item of items) {
    // Re-read the item fresh from IDB — a previous iteration (e.g. createGame)
    // may have updated this item's payload (e.g. tempId → realId on finishGame)
    const db = await import('./db').then(m => m.getDB());
    const freshItem = await db.get('syncQueue', item.id!);
    const current = freshItem ?? item;

    try {
      console.log(`[sync] processing item id=${current.id} type=${current.type} payload=${JSON.stringify(current.payload)?.slice(0,120)}`);
      switch (current.type) {
        case 'createGame': {
          const p = current.payload as any;

          // Skip if already synced (persisted across reloads)
          if (p.tempId && isSynced(p.tempId)) {
            console.log(`[sync] skipping already-synced createGame tempId=${p.tempId}`);
            // Clean up the offline game even if already synced (may have been left behind)
            if (p.tempId) {
              await dbDelete('games', p.tempId);
              await dbDelete('gameCartelas', p.tempId);
            }
            await dequeue(current.id!);
            break;
          }

          // Mark as synced BEFORE the POST to prevent duplicate creation on retry/reload
          if (p.tempId) addSyncedId(p.tempId);

          let realGame: any;
          try {
            console.log(`[sync] posting createGame tempId=${p.tempId} createdAt=${p.createdAt}`);
            const res = await api.post('/games', {
              cartelaIds: p.cartelaIds,
              betAmountPerCartela: p.betAmountPerCartela,
              winPattern: p.winPattern,
              housePercentage: p.housePercentage,
              createdAt: p.createdAt, // Send original offline timestamp to preserve correct day
            });
            realGame = res.data.data;
            console.log(`[sync] createGame success realId=${realGame?.id}`);
          } catch (postErr: any) {
            console.log(`[sync] createGame failed tempId=${p.tempId} status=${postErr?.response?.status} msg=${postErr?.response?.data?.error?.message ?? postErr?.message}`);
            // Network error — un-mark so we retry next time
            if (!postErr?.response?.status && p.tempId) {
              const ids = getSyncedIds(); ids.delete(p.tempId);
              localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
            }

            // HTTP error (e.g. INSUFFICIENT_BALANCE, FORBIDDEN) — server rejected it permanently.
            // Clean up all orphaned IDB data so nothing is left dangling.
            if (postErr?.response?.status && p.tempId) {
              await dbDelete('games', p.tempId);
              await dbDelete('gameCartelas', p.tempId);

              // Remove offline transactions tied to this game
              const allTx = await dbGetAll<any>('transactions');
              for (const tx of allTx) {
                if (tx.id?.includes(p.tempId)) await dbDelete('transactions', tx.id);
              }

              // Remove any dependent finishGame / claimBingo queue items
              const allQueued = await getAllQueued();
              for (const qi of allQueued) {
                const qp = qi.payload as any;
                if (qp?.gameId === p.tempId) await dequeue(qi.id!);
              }

              // Restore the house-cut that was deducted locally — server never charged it
              const houseCut = (p.betAmountPerCartela ?? 0) * (p.cartelaIds?.length ?? 0)
                * ((p.housePercentage ?? 10) / 100);
              if (houseCut > 0) {
                const { adjustBalance } = await import('./db');
                await adjustBalance(houseCut);
                useAuthStore.getState().adjustUserBalance(houseCut);
              }
            }

            throw postErr;
          }

          if (p.tempId) {
            // Preserve the local numberSequence for prepaid users before deleting
            const { dbGet: getFromDb } = await import('./db');
            const user = await getFromDb<any>('user', 'me');
            const isPrepaidUser = !user || user.paymentType !== 'postpaid';
            let localNumberSequence: number[] | undefined;
            let localCalledNumbers: number[] | undefined;
            
            if (isPrepaidUser) {
              const offlineGame = await getFromDb<any>('games', p.tempId);
              localNumberSequence = offlineGame?.numberSequence;
              localCalledNumbers = offlineGame?.calledNumbers;
            }
            
            // Remove offline game from IDB
            await dbDelete('games', p.tempId);

            // Migrate gameCartelas mapping from tempId to real ID
            const tempCartelaIds = await dbGet<string[]>('gameCartelas', p.tempId);
            if (tempCartelaIds) {
              await dbPut('gameCartelas', tempCartelaIds, realGame.id);
              await dbDelete('gameCartelas', p.tempId);
            }

            // Update transactions referencing tempId
            const allTx = await dbGetAll<any>('transactions');
            for (const tx of allTx) {
              if (tx.id?.includes(p.tempId)) {
                await dbDelete('transactions', tx.id);
                await dbPut('transactions', {
                  ...tx,
                  id: tx.id.replace(p.tempId, realGame.id),
                  description: tx.description?.replace(p.tempId.slice(0, 12), realGame.id.slice(0, 8)),
                });
              }
            }

            // Update any pending finishGame/claimBingo queue items that reference the tempId
            const allQueued = await getAllQueued();
            for (const qi of allQueued) {
              const qp = qi.payload as any;
              if (qp?.gameId === p.tempId) {
                // syncQueue uses keyPath 'id' (in-line keys) — must not pass key separately
                const updated = { ...qi, payload: { ...qp, gameId: realGame.id } };
                await db.put('syncQueue', updated);
              }
            }
            
            // Store local numberSequence back into realGame for prepaid users
            if (isPrepaidUser && localNumberSequence) {
              realGame.numberSequence = localNumberSequence;
            }
            if (isPrepaidUser && localCalledNumbers) {
              realGame.calledNumbers = localCalledNumbers;
            }
          }
          // Store the real server game (preserve finished status if already marked locally)
          const wasFinished = _justFinishedIds.has(String(realGame.id));
          await dbPut('games', wasFinished ? { ...realGame, status: 'finished' } : realGame);
          await dequeue(current.id!);

          // Notify any open game page that its offline gameId has a real server ID now
          if (p.tempId) {
            window.dispatchEvent(new CustomEvent('game-synced', {
              detail: { tempId: p.tempId, realId: realGame.id }
            }));
          }
          break;
        }

        case 'finishGame': {
          const p = current.payload as any;
          // If still has offline ID, createGame hasn't synced yet — dequeue and skip
          // (these are orphaned finish events for games that never made it to the server)
          if (String(p.gameId).startsWith('offline-')) {
            console.log(`[sync] dequeuing orphaned finishGame with offline gameId=${p.gameId}`);
            await dequeue(current.id!);
            break;
          }
          try {
            await api.post(`/games/${p.gameId}/finish`);
          } catch (finishErr: any) {
            // 400 "already ended" means server already has it finished — treat as success
            if (finishErr?.response?.status !== 400) throw finishErr;
          }
          // Track this ID so refreshCache won't overwrite it with 'active'
          _justFinishedIds.add(String(p.gameId));
          // Update local copy
          const localGame = await dbGet<any>('games', p.gameId);
          if (localGame) { localGame.status = 'finished'; await dbPut('games', localGame); }
          await dequeue(current.id!);
          break;
        }

        case 'claimBingo': {
          const p = current.payload as any;
          if (String(p.gameId).startsWith('offline-')) {
            await dequeue(current.id!);
            break;
          }
          await api.post(`/games/${p.gameId}/bingo`, { cartelaId: p.cartelaId });
          // Balance updated by refreshCache reading server balance — no local delta needed
          await dequeue(current.id!);
          break;
        }

        case 'markNumber': {
          const p = current.payload as any;
          await api.post(`/games/cartelas/${p.cartelaId}/mark`, { number: p.number });
          await dequeue(current.id!);
          break;
        }

        default:
          await dequeue(current.id!);
      }
    } catch (err: any) {
      console.log(`[sync] error on item id=${current.id} type=${current.type} status=${err?.response?.status} msg=${err?.message}`);
      if (err?.response?.status) await dequeue(current.id!); // server error — discard
      else continue; // network error — skip item, attempt remaining
    }
  }
}

// ── Negative balance check ────────────────────────────────────────────────────

/**
 * After coming online and syncing:
 * - Fetch real server balance
 * - If positive → continue with refreshCache normally, clear any previous block
 * - If negative → skip refreshCache, block the UI, save last positive balance,
 *   alert the backend, and start polling until admin resolves it
 *
 * Returns true if balance is OK to proceed with cache refresh.
 */
export async function checkNegativeBalanceAfterSync(): Promise<boolean> {
  try {
    const user = await dbGet<any>('user', 'me');
    if (!user || user.paymentType === 'postpaid' || user.role === 'admin' || user.role === 'agent') return true;

    // If already locked (set before flush or by offlineApi), keep it locked.
    // Only recovery polling (after admin top-up) clears this.
    if (isNegativeBalanceLocked()) {
      const stored = parseFloat(localStorage.getItem(NEG_BAL_KEY) ?? '');
      useAuthStore.setState({
        negativeBalance: true,
        lastPositiveBalance: isNaN(stored) ? 0 : stored,
      });
      try { await api.post('/users/me/alert-negative-balance'); } catch {}
      return false;
    }

    // Not locked — check current local IDB balance (already updated by _doFlush refunds)
    const localBalance = Number(user.balance ?? 0);
    if (localBalance < 0) {
      localStorage.setItem('neg_balance_locked', '1');
      const stored = parseFloat(localStorage.getItem(NEG_BAL_KEY) ?? '');
      useAuthStore.setState({
        negativeBalance: true,
        lastPositiveBalance: isNaN(stored) ? 0 : stored,
      });
      try { await api.post('/users/me/alert-negative-balance'); } catch {}
      return false;
    }

    // Balance looks positive — let refreshCache() do the authoritative server balance write.
    // Do NOT make an extra GET /users/me here; that causes the delta-based double-update bug.
    return true;
  } catch {
    return true;
  }
}

/**
 * Poll the server every 15s while the account is blocked.
 * When the balance comes back positive (admin topped up), unblock and do a full refresh.
 */
let _recoveryInterval: ReturnType<typeof setInterval> | null = null;

function startRecoveryPolling() {
  if (_recoveryInterval) return; // already polling
  _recoveryInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await api.get('/users/me');
      const fresh = res.data?.data;
      if (!fresh) return;
      const balance = Number(fresh.balance ?? 0);
      if (balance >= 0) {
        // Admin resolved it — unblock and do a full sync
        clearInterval(_recoveryInterval!);
        _recoveryInterval = null;
        const user = await dbGet<any>('user', 'me');
        if (user) await dbPut('user', { ...user, balance }, 'me');
        // Update Zustand directly with server balance — no delta math
        useAuthStore.setState((state) => ({
          user: state.user ? { ...state.user, balance } : state.user,
        }));
        applyNegativeBalanceCheck(balance, fresh.paymentType, fresh.role, useAuthStore.getState, (p) => useAuthStore.setState(p as any));
        // Full cache refresh now that the account is healthy
        await refreshCache();
        window.dispatchEvent(new CustomEvent('balance-restored'));
      }
    } catch {}
  }, 15_000);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns true while a flush is in progress — used by UI to show sync indicator */
export function isSyncing() { return _flushing; }

/**
 * Returns true while a queue flush is in progress.
 * Used by offlineApi to skip mid-sync refreshBalance() calls that would
 * temporarily restore the old server balance before all games are billed.
 */
export function isFlushInProgress() { return _flushing; }

/** Flush queue only — no cache refresh. Used before individual fetches. */
export async function flushQueueOnly() {
  if (_flushing) return;
  _flushing = true;
  window.dispatchEvent(new CustomEvent('sync-start'));
  try { await _doFlush(); }
  finally {
    _flushing = false;
    window.dispatchEvent(new CustomEvent('sync-end'));
  }
}

/** Flush queue then refresh full cache. Used on online event. */
export async function flushQueue() {
  if (_flushing) return;
  _flushing = true;
  window.dispatchEvent(new CustomEvent('sync-start'));
  try {
    const preFlushUser = await dbGet<any>('user', 'me');
    const localBalance = Number(preFlushUser?.balance ?? 0);
    const isPrepaidPlayer = preFlushUser &&
      preFlushUser.paymentType !== 'postpaid' &&
      preFlushUser.role !== 'admin' &&
      preFlushUser.role !== 'agent';

    // ── Step 1: push the local balance to the server BEFORE syncing games ──
    // The local IDB balance already reflects all offline deductions (e.g. 5000 → 1300).
    // Writing it to the server first means game sync never causes a balance fluctuation —
    // the server balance is correct from the start of the flush.
    if (isPrepaidPlayer) {
      try {
        console.log(`[sync] pushing local balance=${localBalance} to server before game flush`);
        await api.post('/users/me/sync-balance', { balance: localBalance });
        console.log(`[sync] balance pushed successfully`);
      } catch (err) {
        console.log(`[sync] balance push failed, continuing anyway`, err);
      }
    }

    // ── Step 2: lock immediately if local balance is negative ──────────────
    if (isPrepaidPlayer && localBalance < 0) {
      localStorage.setItem('neg_balance_locked', '1');
      const stored = parseFloat(localStorage.getItem(NEG_BAL_KEY) ?? '');
      useAuthStore.setState({
        negativeBalance: true,
        lastPositiveBalance: isNaN(stored) ? 0 : stored,
      });
      try { await api.post('/users/me/alert-negative-balance'); } catch {}
      startRecoveryPolling();
      return;
    }

    // ── Step 3: sync game records (game data only — balance already correct) ─
    await _doFlush();

    // ── Step 4: pull server state back into local cache ─────────────────────
    const balanceOk = await checkNegativeBalanceAfterSync();
    console.log(`[sync] balanceOk=${balanceOk}`);
    if (balanceOk) {
      await refreshCache();
    } else {
      startRecoveryPolling();
    }
  } finally {
    _flushing = false;
    window.dispatchEvent(new CustomEvent('sync-end'));
  }
}

export async function syncWhenOnline() {
  if (!navigator.onLine) return;
  await flushQueue();
}

// ── Debounce sync to avoid thrashing ─────────────────────────────────────────
/**
 * Debounce — don't sync more than once per 10 seconds
 * UNLESS we just came online (timer is reset on offline)
 */
let _lastSync = 0;
function debouncedSync() {
  const now = Date.now();
  if (now - _lastSync < 10_000) {
    console.log('[sync] Debounced (< 10s since last sync)');
    return;
  }
  _lastSync = now;
  console.log('[sync] Running debouncedSync');
  syncWhenOnline();
}

// ── Periodic sync even when already online ────────────────────────────────────
/**
 * Sync every 30 seconds to catch admin balance updates,
 * even for users who never go offline/online.
 * This fixes the issue where admin updates aren't visible until next refresh.
 */
const PERIODIC_SYNC_INTERVAL = 30_000;  // 30 seconds
let _periodicSyncInterval: ReturnType<typeof setInterval> | null = null;

function isOfflineGameSession() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('gameId')?.startsWith('offline-');
}

export function startPeriodicSync() {
  if (_periodicSyncInterval) {
    console.log('[sync] Periodic sync already running');
    return;
  }
  
  console.log('[sync] Starting periodic sync (every 30s)');
  _periodicSyncInterval = setInterval(async () => {
    if (!navigator.onLine) {
      console.log('[sync] Skipping periodic sync (offline)');
      return;
    }

    // Skip if a flush is already in progress — it will call refreshCache itself
    if (_flushing) {
      console.log('[sync] Skipping periodic sync (flush in progress)');
      return;
    }

    // Skip if there are queued offline games — refreshCache would overwrite the locally-
    // deducted IDB balance with the server's pre-billing balance, giving the user fake money.
    try {
      const pending = await getAllQueued();
      if (pending.some((item: any) => item.type === 'createGame')) {
        console.log('[sync] Skipping periodic sync (pending offline games in queue)');
        return;
      }
    } catch { /* proceed if queue read fails */ }

    try {
      console.log('[sync] Running periodic refresh cache');
      await refreshCache();
    } catch (err) {
      console.error('[sync] Periodic sync failed:', err);
    }
  }, PERIODIC_SYNC_INTERVAL);
}

export function stopPeriodicSync() {
  if (_periodicSyncInterval) {
    console.log('[sync] Stopping periodic sync');
    clearInterval(_periodicSyncInterval);
    _periodicSyncInterval = null;
  }
}

if (typeof window !== 'undefined' && !isOfflineGameSession()) {
  // Start periodic sync on page load
  startPeriodicSync();
  
  // Reset debounce timer on offline (so we sync immediately on reconnect)
  window.addEventListener('offline', () => {
    console.log('[sync] Going offline, resetting debounce timer');
    _lastSync = 0;  // Reset so next online event syncs immediately
    stopPeriodicSync();
  });
  
  // Sync when coming back online + restart periodic sync
  window.addEventListener('online', () => {
    console.log('[sync] Back online, restarting periodic sync + immediate sync');
    startPeriodicSync();
    debouncedSync();
  });
}
