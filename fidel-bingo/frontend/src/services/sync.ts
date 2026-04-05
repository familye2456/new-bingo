/**
 * Online/offline sync manager.
 */
import { api } from './api';
import { dbGet, dbPut, dbGetAll, dbDelete, dbClear, dequeue, getAllQueued } from './db';

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
  if (!(await isPrepaid())) return;
  try {
    const [meRes, cartelasRes, gamesRes, txRes] = await Promise.all([
      api.get('/users/me'),
      api.get('/cartelas/mine'),
      api.get('/games/mine'),
      api.get('/users/me/transactions'),
    ]);

    const meData = meRes.data?.data ?? meRes.data;

    // Only update balance from server if sync queue is empty
    const pendingQueue = await getAllQueued();
    if (pendingQueue.length > 0 && meData) {
      const localUser = await dbGet<any>('user', 'me');
      if (localUser) meData.balance = localUser.balance;
    }
    await dbPut('user', meData, 'me');

    const toList = (d: any) => Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.data) ? d.data.data : [];

    await dbClear('cartelas');
    for (const c of toList(cartelasRes.data)) await dbPut('cartelas', c);

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
    for (const g of serverGames) {
      const localGame = localGames.find((l: any) => String(l.id) === String(g.id));
      const merged = {
        ...g,
        // Preserve locally-patched cartelaIds (server game object doesn't include them)
        cartelaIds: g.cartelaIds ?? localGame?.cartelaIds,
      };
      if (localFinishedIds.has(String(g.id)) && g.status !== 'finished') {
        await dbPut('games', { ...merged, status: 'finished' });
      } else {
        await dbPut('games', merged);
      }
    }
    for (const g of offlineGames) {
      if (!serverGameIds.has(g.id)) await dbPut('games', g);
    }

    const serverTx = toList(txRes.data);
    const localTx = await dbGetAll<any>('transactions');
    const offlineTx = localTx.filter((t: any) =>
      String(t.id).startsWith('tx-bet-offline-') || String(t.id).startsWith('tx-win-offline-')
    );
    await dbClear('transactions');
    for (const t of serverTx) await dbPut('transactions', t);
    for (const t of offlineTx) await dbPut('transactions', t);

    window.dispatchEvent(new CustomEvent('cache-refreshed'));
  } catch {
    // server unreachable — skip
  }
}

// ── Core flush logic (shared) ─────────────────────────────────────────────────

// Track game IDs finished during the current flush so refreshCache won't overwrite them
export const _justFinishedIds = new Set<string>();

async function _doFlush() {
  if (!(await isPrepaid())) return;
  _justFinishedIds.clear();

  const items = await getAllQueued();
  if (items.length === 0) return;

  for (const item of items) {
    try {
      switch (item.type) {
        case 'createGame': {
          const p = item.payload as any;

          // Skip if already synced (persisted across reloads)
          if (p.tempId && isSynced(p.tempId)) {
            await dequeue(item.id!);
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
            // If network error, un-mark so we retry next time
            if (!postErr?.response?.status && p.tempId) {
              const ids = getSyncedIds(); ids.delete(p.tempId);
              localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
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
            const db = await import('./db').then(m => m.getDB());
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
          // Store the real server game
          await dbPut('games', realGame);
          await dequeue(item.id!);
          break;
        }

        case 'finishGame': {
          const p = item.payload as any;
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
          await dequeue(item.id!);
          break;
        }

        case 'claimBingo': {
          const p = item.payload as any;
          if (String(p.gameId).startsWith('offline-')) break;
          await api.post(`/games/${p.gameId}/bingo`, { cartelaId: p.cartelaId });
          await dequeue(item.id!);
          break;
        }

        case 'markNumber': {
          const p = item.payload as any;
          await api.post(`/games/cartelas/${p.cartelaId}/mark`, { number: p.number });
          await dequeue(item.id!);
          break;
        }

        default:
          await dequeue(item.id!);
      }
    } catch (err: any) {
      if (err?.response?.status) await dequeue(item.id!); // server error — discard
      else break; // network error — stop, retry later
    }
  }
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
    await refreshCache();
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
