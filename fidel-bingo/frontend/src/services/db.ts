/**
 * IndexedDB wrapper using the idb library.
 * Stores: user, cartelas, games, transactions, syncQueue
 */
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'fidel-bingo';
const DB_VERSION = 3; // v3: added gameCartelas store for offline cartela membership check

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
      if (oldVersion < 3) {
        // Maps gameId → string[] of cartelaIds — never cleared by server refreshes
        if (!db.objectStoreNames.contains('gameCartelas')) {
          db.createObjectStore('gameCartelas');
        }
      }
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

// ── Cached audio playback ────────────────────────────────────────────────────

/**
 * Play a sound file. Tries the network first; if offline or fetch fails,
 * falls back to the service worker cache (works for both prepaid and postpaid).
 */
export async function playCachedSound(path: string, volume = 1): Promise<HTMLAudioElement | undefined> {
  // Try direct Audio element first (works when online or SW has it cached)
  try {
    const audio = new Audio(path);
    audio.volume = volume;
    await audio.play();
    return audio;
  } catch {
    // Might be a network error — try Cache Storage fallback
  }

  if (!('caches' in window)) return undefined;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const response = await cache.match(path);
      if (response) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = volume;
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return audio;
      }
    }
  } catch {
    // Cache Storage not available or sound not cached — silently ignore
  }
  return undefined;
}

// ── Voice sound pre-caching ──────────────────────────────────────────────────

const VOICE_CACHE = 'fidel-voice-sounds-v1';
const SOUND_FILES = [
  ...Array.from({ length: 75 }, (_, i) => `${i + 1}`),
];

// Root-level event sounds (not category-specific)
const ROOT_SOUND_FILES = [
  '/sounds/aac_ended.mp3',
  '/sounds/aac_locked.mp3',
  '/sounds/aac_resumed.mp3',
  '/sounds/shuffle-audio-TfqyAnvz.mp3',
  '/sounds/start.wav',
  '/sounds/winner.wav',
  '/sounds/notregisterd.mp3',
  '/sounds/notregisterd.m4a',
];

export function getVoiceExt(voice: string): string {
  return voice === 'boy sound' ? '.wav' : '.mp3';
}

export function getVoiceSoundUrls(voice: string): string[] {
  const ext = getVoiceExt(voice);
  return SOUND_FILES.map((f) => `/sounds/${encodeURIComponent(voice)}/${f}${ext}`);
}

/** Check how many of the voice sounds are already cached */
export async function getVoiceCacheStatus(voice: string): Promise<{ cached: number; total: number }> {
  const urls = getVoiceSoundUrls(voice);
  if (!('caches' in window)) return { cached: 0, total: urls.length };
  try {
    const cache = await caches.open(VOICE_CACHE);
    let cached = 0;
    for (const url of urls) {
      const match = await cache.match(url);
      if (match) cached++;
    }
    return { cached, total: urls.length };
  } catch {
    return { cached: 0, total: urls.length };
  }
}

/** Download all sounds for the given voice category into Cache Storage */
export async function downloadVoiceSounds(
  voice: string,
  onProgress?: (cached: number, total: number) => void
): Promise<void> {
  if (!('caches' in window)) return;
  const urls = [...getVoiceSoundUrls(voice), ...ROOT_SOUND_FILES];
  const cache = await caches.open(VOICE_CACHE);
  let done = 0;
  for (const url of urls) {
    const existing = await cache.match(url);
    if (!existing) {
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch { /* skip failed files */ }
    }
    done++;
    onProgress?.(done, urls.length);
  }
}

/** Check if all sounds for the given voice are fully cached */
export async function isVoiceFullyCached(voice: string): Promise<boolean> {
  const { cached, total } = await getVoiceCacheStatus(voice);
  return cached >= total;
}

// ── Audio queue ──────────────────────────────────────────────────────────────

/**
 * Serialises sound playback so no two sounds overlap.
 * Tasks are played one at a time in FIFO order.
 */
export class AudioQueue {
  private queue: Array<() => Promise<void>> = [];
  playing = false;

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    if (!this.playing) {
      this.drain();
    }
  }

  private async drain(): Promise<void> {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const task = this.queue.shift()!;
    try {
      await task();
    } catch {
      // Error in task — continue to next
    }
    this.drain();
  }
}

/** Singleton queue for all number sound playback */
export const audioQueue = new AudioQueue();

/**
 * Enqueue a number sound for sequential playback via the AudioQueue.
 * Routes through playCachedSound so offline cache is used when available.
 */
export function playNumberSoundQueued(number: number, voice: string, volume?: number): void {
  const ext = getVoiceExt(voice);
  const path = `/sounds/${encodeURIComponent(voice)}/${number}${ext}`;
  audioQueue.enqueue(() => playCachedSound(path, volume));
}
