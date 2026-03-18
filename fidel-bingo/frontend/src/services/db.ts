/**
 * IndexedDB wrapper using the idb library.
 * Stores: user, cartelas, games, transactions, syncQueue
 */
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'fidel-bingo';
const DB_VERSION = 2; // bumped — added pendingBalance field to user store

export interface SyncItem {
  id?: number;
  /** 'createGame' | 'finishGame' | 'claimBingo' | 'markNumber' */
  type: string;
  payload: unknown;
  createdAt: number;
}

let _db: IDBPDatabase | null = null;

export async function getDB() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('user');
        db.createObjectStore('cartelas', { keyPath: 'id' });
        db.createObjectStore('games', { keyPath: 'id' });
        db.createObjectStore('transactions', { keyPath: 'id' });
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
      // v2: no schema change needed, just version bump to clear stale data
    },
  });
  return _db;
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  try { return (await getDB()).get(store, key); } catch { return undefined; }
}

export async function dbPut(store: string, value: unknown, key?: IDBValidKey) {
  try { return (await getDB()).put(store, value, key); } catch { /* ignore */ }
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  try { return (await getDB()).getAll(store); } catch { return []; }
}

export async function dbDelete(store: string, key: IDBValidKey) {
  try { return (await getDB()).delete(store, key); } catch { /* ignore */ }
}

export async function dbClear(store: string) {
  try { return (await getDB()).clear(store); } catch { /* ignore */ }
}

// ── Balance helpers ──────────────────────────────────────────────────────────

/** Adjust the cached user balance by delta (negative = deduct, positive = add) */
export async function adjustBalance(delta: number) {
  const user = await dbGet<any>('user', 'me');
  if (!user) return;
  user.balance = (Number(user.balance) || 0) + delta;
  await dbPut('user', user, 'me');
}

// ── Sync queue ───────────────────────────────────────────────────────────────

export async function enqueue(item: Omit<SyncItem, 'id' | 'createdAt'>) {
  const db = await getDB();
  await db.add('syncQueue', { ...item, createdAt: Date.now() });
}

export async function dequeue(id: number) {
  await dbDelete('syncQueue', id);
}

export async function getAllQueued(): Promise<SyncItem[]> {
  return dbGetAll<SyncItem>('syncQueue');
}
