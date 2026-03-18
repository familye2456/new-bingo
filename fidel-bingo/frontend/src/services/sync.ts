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

    // Store fresh user (balance included)
    await dbPut('user', meRes.data.data.data, 'me');

    // Replace cartelas, games, transactions with fresh server data
    await dbClear('cartelas');
    for (const c of (cartelasRes.data.data.data ?? [])) await dbPut('cartelas', c);

    await dbClear('games');
    for (const g of (gamesRes.data.data.data ?? [])) await dbPut('games', g);

    await dbClear('transactions');
    for (const t of (txRes.data.data.data ?? [])) await dbPut('transactions', t);

    // Signal React Query to invalidate its cache
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
          const realGame = res.data.data.data;

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

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushQueue());
}
