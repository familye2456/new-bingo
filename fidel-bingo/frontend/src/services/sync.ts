/**
 * Online/offline sync manager.
 */
import { api } from './api';
import { dbGet, dbPut, dbGetAll, dbDelete, dbClear, dequeue, getAllQueued } from './db';
import { useAuthStore, applyNegativeBalanceCheck } from '../store/authStore';

async function isPrepaid(): Promise<boolean> {
  const user = await dbGet<{ paymentType?: string }>('user', 'me');
  if (!user) return false;
  return !user.paymentType || user.paymentType === 'prepaid';
}

// ── Global flush lock — prevents concurrent flushes ───────────────────────────
let _flushing = false;

// Persist synced tempIds across page reloads to prevent duplicate POSTs
const SYNCED_KEY = 'synced_temp_ids';
function getSyncedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]')); } catch { return new Set(); }
}
function addSyncedId(id: string) {
  const ids = getSyncedIds();
  ids.add(id);
  localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
}
function isSynced(id: string): boolean { return getSyncedIds().has(id); }

// ── Cache refresh ─────────────────────────────────────────────────────────────

export async function refreshCache() {
  try {
    const requests: Promise<any>[] = [
      api.get('/users/me'),
      api.get('/cartelas/mine'),  // always fetch — never skip based on cache
      api.get('/games/mine'),
      api.get('/users/me/transactions'),
    ];

    const [meRes, cartelasRes, gamesRes, txRes] = await Promise.all(requests);

    const meData = meRes.data?.data ?? meRes.data;

    // Only update balance from server if sync queue is empty
    const pendingQueue = await getAllQueued();
    if (pendingQueue.length > 0 && meData) {
      const localUser = await dbGet<any>('user', 'me');
      if (localUser) meData.balance = localUser.balance;
    }
    await dbPut('user', meData, 'me');

    // Sync the refreshed balance into the Zustand store so the UI reflects server state
    if (meData?.id) {
      useAuthStore.getState().adjustUserBalance(
        Number(meData.balance) - (Number(useAuthStore.getState().user?.balance) || 0)
      );
    }

    const toList = (d: any) => Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.data) ? d.data.data : [];

    // Always clear and repopulate cartelas — ensures no stale data from another user
    {
      const userId = meData?.id;
      await dbClear('cartelas');
      await Promise.all(toList(cartelasRes.data).map((c: any) => dbPut('cartelas', { ...c, userId })));
    }

    const serverGames = toList(gamesRes.data);
    const localGames = await dbGetAll<any>('games');
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
      const merged = { ...g, cartelaIds: g.cartelaIds ?? localGame?.cartelaIds };
      return localFinishedIds.has(String(g.id)) && g.status !== 'finished'
        ? { ...merged, status: 'finished' }
        : merged;
    });
    await Promise.all(mergedGames.map((g: any) => dbPut('games', g)));
    await Promise.all(
      offlineGames
        .filter((g: any) => !serverGameIds.has(g.id))
        .map((g: any) => dbPut('games', g))
    );

    const serverTx = toList(txRes.data);
    const localTx = await dbGetAll<any>('transactions');
    const offlineTx = localTx.filter((t: any) =>
      String(t.id).startsWith('tx-bet-offline-') || String(t.id).startsWith('tx-win-offline-')
    );
    await dbClear('transactions');
    await Promise.all([
      ...serverTx.map((t: any) => dbPut('transactions', t)),
      ...offlineTx.map((t: any) => dbPut('transactions', t)),
    ]);

    window.dispatchEvent(new CustomEvent('cache-refreshed'));
  } catch {
    // server unreachable — skip
  }
}

// ── Core flush logic (shared) ─────────────────────────────────────────────────

// Track game IDs finished during the current flush so refreshCache won't overwrite them
export const _justFinishedIds = new Set<string>();

async function _doFlush() {
  _justFinishedIds.clear();

  const items = await getAllQueued();
  if (items.length === 0) return;

  for (const item of items) {
    // Re-read the item fresh from IDB — a previous iteration (e.g. createGame)
    // may have updated this item's payload (e.g. tempId → realId on finishGame)
    const db = await import('./db').then(m => m.getDB());
    const freshItem = await db.get('syncQueue', item.id!);
    const current = freshItem ?? item;

    try {
      switch (current.type) {
        case 'createGame': {
          const p = current.payload as any;

          // Skip if already synced (persisted across reloads)
          if (p.tempId && isSynced(p.tempId)) {
            await dequeue(current.id!);
            break;
          }

          // Mark as synced BEFORE the POST to prevent duplicate creation on retry/reload
          if (p.tempId) addSyncedId(p.tempId);

          let realGame: any;
          try {
            const res = await api.post('/games', {
              cartelaIds: p.cartelaIds,
              betAmountPerCartela: p.betAmountPerCartela,
              winPattern: p.winPattern,
              housePercentage: p.housePercentage,
            });
            realGame = res.data.data;
          } catch (postErr: any) {
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
                await db.put('syncQueue', {
                  ...qi,
                  payload: { ...qp, gameId: realGame.id },
                }, qi.id);
              }
            }
          }
          // Store the real server game (preserve finished status if already marked locally)
          const wasFinished = _justFinishedIds.has(String(realGame.id));
          await dbPut('games', wasFinished ? { ...realGame, status: 'finished' } : realGame);
          await dequeue(current.id!);
          break;
        }

        case 'finishGame': {
          const p = current.payload as any;
          // If still has offline ID, createGame hasn't synced yet — skip for now
          if (String(p.gameId).startsWith('offline-')) break;
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
          if (String(p.gameId).startsWith('offline-')) break;
          await api.post(`/games/${p.gameId}/bingo`, { cartelaId: p.cartelaId });
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
      if (err?.response?.status) await dequeue(current.id!); // server error — discard
      else break; // network error — stop, retry later
    }
  }
}

// ── Negative balance check ────────────────────────────────────────────────────

const NEG_BAL_KEY = 'neg_balance_last_positive';

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

    // Check local IDB balance — this reflects all offline deductions
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

    // Local balance is positive — also verify with server (catches edge cases)
    if (navigator.onLine) {
      try {
        const res = await api.get('/users/me');
        const fresh = res.data?.data;
        if (fresh) {
          const serverBalance = Number(fresh.balance ?? 0);
          // Sync server balance into IDB and store
          await dbPut('user', { ...user, balance: serverBalance }, 'me');
          useAuthStore.getState().adjustUserBalance(serverBalance - (Number(useAuthStore.getState().user?.balance) || 0));
          localStorage.setItem(NEG_BAL_KEY, String(Math.max(serverBalance, 0)));
        }
      } catch {}
    }

    // Balance is positive — clear any previous lock
    if (isNegativeBalanceLocked()) {
      localStorage.removeItem('neg_balance_locked');
      useAuthStore.setState({ negativeBalance: false });
    }
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
        useAuthStore.getState().adjustUserBalance(balance - (Number(useAuthStore.getState().user?.balance) || 0));
        applyNegativeBalanceCheck(balance, fresh.paymentType, fresh.role, useAuthStore.getState, (p) => useAuthStore.setState(p as any));
        // Full cache refresh now that the account is healthy
        await refreshCache();
        window.dispatchEvent(new CustomEvent('balance-restored'));
      }
    } catch {}
  }, 15_000);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Flush queue only — no cache refresh. Used before individual fetches. */
export async function flushQueueOnly() {
  if (_flushing) return; // already running
  _flushing = true;
  try { await _doFlush(); }
  finally { _flushing = false; }
}

/** Flush queue then refresh full cache. Used on online event. */
export async function flushQueue() {
  if (_flushing) return;
  _flushing = true;
  try {
    await _doFlush();
    const balanceOk = await checkNegativeBalanceAfterSync();
    if (balanceOk) {
      await refreshCache();
    } else {
      // Account blocked — start polling for recovery
      startRecoveryPolling();
    }
  } finally {
    _flushing = false;
  }
}

export async function syncWhenOnline() {
  if (!navigator.onLine) return;
  await flushQueue();
}

// Debounce — don't sync more than once per 10 seconds
let _lastSync = 0;
function debouncedSync() {
  const now = Date.now();
  if (now - _lastSync < 10_000) return;
  _lastSync = now;
  syncWhenOnline();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', debouncedSync);
}
