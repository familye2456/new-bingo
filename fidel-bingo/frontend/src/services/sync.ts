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
const _syncedTempIds = new Set<string>(); // track already-synced offline games this session

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
    const serverGameIds = new Set(serverGames.map((g: any) => g.id));
    await dbClear('games');
    for (const g of serverGames) await dbPut('games', g);
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

async function _doFlush() {
  if (!(await isPrepaid())) return;

  const items = await getAllQueued();
  if (items.length === 0) return;

  for (const item of items) {
    try {
      switch (item.type) {
        case 'createGame': {
          const p = item.payload as any;

          // Skip if already synced this session (prevents duplicate POSTs)
          if (p.tempId && _syncedTempIds.has(p.tempId)) {
            await dequeue(item.id!);
            break;
          }

          const res = await api.post('/games', {
            cartelaIds: p.cartelaIds,
            betAmountPerCartela: p.betAmountPerCartela,
            winPattern: p.winPattern,
            housePercentage: p.housePercentage,
          });
          const realGame = res.data.data;

          if (p.tempId) {
            _syncedTempIds.add(p.tempId);
            await dbDelete('games', p.tempId);
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
          }
          await dbPut('games', realGame);
          await dequeue(item.id!);
          break;
        }

        case 'finishGame': {
          const p = item.payload as any;
          if (String(p.gameId).startsWith('offline-')) { await dequeue(item.id!); break; }
          await api.post(`/games/${p.gameId}/finish`);
          await dequeue(item.id!);
          break;
        }

        case 'claimBingo': {
          const p = item.payload as any;
          if (String(p.gameId).startsWith('offline-')) { await dequeue(item.id!); break; }
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

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncWhenOnline());
}
