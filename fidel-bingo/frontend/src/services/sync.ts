/**
 * Online/offline sync manager.
 * - flushQueue: replays queued mutations against the server when back online
 * - refreshCache: pulls fresh data from server into IndexedDB
 * - Emits a custom 'cache-refreshed' event so React Query can invalidate
 */
import { api } from './api';
import { dbGet, dbPut, dbGetAll, dbDelete, dbClear, enqueue, dequeue, getAllQueued } from './db';

async function isPrepaid(): Promise<boolean> {
  const user = await dbGet<{ paymentType?: string }>('user', 'me');
  if (!user) return false;
  return !user.paymentType || user.paymentType === 'prepaid';
}

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

    // Only update balance from server if sync queue is empty (all offline ops synced)
    const pendingQueue = await getAllQueued();
    if (pendingQueue.length > 0 && meData) {
      // Keep local balance — offline ops haven't synced yet
      const localUser = await dbGet<any>('user', 'me');
      if (localUser) meData.balance = localUser.balance;
    }
    await dbPut('user', meData, 'me');

    const toList = (d: any) => Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.data) ? d.data.data : [];

    // Cartelas — safe to replace (no offline-created cartelas)
    await dbClear('cartelas');
    for (const c of toList(cartelasRes.data)) await dbPut('cartelas', c);

    // Games — keep offline (temp) games, only replace server-side ones
    const serverGames = toList(gamesRes.data);
    const localGames = await dbGetAll<any>('games');
    const offlineGames = localGames.filter((g: any) => String(g.id).startsWith('offline-'));
    await dbClear('games');
    for (const g of serverGames) await dbPut('games', g);
    for (const g of offlineGames) await dbPut('games', g); // restore offline games

    // Transactions — keep offline ones, only replace server-side ones
    const serverTx = toList(txRes.data);
    const localTx = await dbGetAll<any>('transactions');
    const offlineTx = localTx.filter((t: any) =>
      String(t.id).startsWith('tx-bet-offline-') || String(t.id).startsWith('tx-win-offline-')
    );
    await dbClear('transactions');
    for (const t of serverTx) await dbPut('transactions', t);
    for (const t of offlineTx) await dbPut('transactions', t); // restore offline transactions

    window.dispatchEvent(new CustomEvent('cache-refreshed'));
  } catch {
    // server unreachable — skip
  }
}

// ── Flush queued mutations ────────────────────────────────────────────────────

export async function flushQueue() {
  if (!(await isPrepaid())) return;

  const items = await getAllQueued();
  if (items.length === 0) {
    await refreshCache();
    return;
  }

  for (const item of items) {
    try {
      switch (item.type) {
        case 'createGame': {
          const p = item.payload as any;
          // POST the game to server
          const res = await api.post('/games', {
            cartelaIds: p.cartelaIds,
            betAmountPerCartela: p.betAmountPerCartela,
            winPattern: p.winPattern,
          });
          const realGame = res.data.data; // single wrap: { success, data: game }

          // Replace the temp game with the real one
          if (p.tempId) {
            await dbDelete('games', p.tempId);
            // Also fix any transactions that referenced the tempId
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
          // Skip if it's still a temp (offline) game id — createGame hasn't synced yet
          if (String(p.gameId).startsWith('offline-')) break;
          await api.post(`/games/${p.gameId}/finish`);
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
      // If server returned an error (not a network error), discard the item
      if (err?.response?.status) {
        await dequeue(item.id!);
      }
      // Network error — leave in queue, stop processing
      break;
    }
  }

  // After flushing, pull fresh data from server
  await refreshCache();
}

// ── Listen for online event ───────────────────────────────────────────────────

let _flushing = false;

export async function syncWhenOnline() {
  if (_flushing || !navigator.onLine) return;
  _flushing = true;
  try {
    await flushQueue();
  } finally {
    _flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncWhenOnline());
}
