/**
 * IndexedDB wrapper using the idb library.
 * Stores: user, cartelas, games, transactions, syncQueue
 */
import { openDB, IDBPDatabase } from 'idb';


const DB_NAME = 'fidel-bingo';
const DB_VERSION = 3; // v3: added gameCartelas store for offline cartela membership check
const INLINE_KEY_PATH_STORES = new Set(['cartelas', 'games', 'transactions']);

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
  // Guard: inline-key stores require a valid id on the value — skip silently if missing
  if (INLINE_KEY_PATH_STORES.has(store) && (value as any)?.id == null) {
    console.warn('[dbPut] Skipping write to', store, '— missing id');
    return;
  }
  try { 
    console.log('[dbPut] Putting to store:', store, 'key:', key);
    
    // Add a timeout to prevent hanging indefinitely
    const db = await getDB();
    const putPromise = key === undefined || INLINE_KEY_PATH_STORES.has(store)
      ? db.put(store, value)
      : db.put(store, value, key);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('dbPut timeout after 5s')), 5000)
    );
    
    const result = await Promise.race([putPromise, timeoutPromise]);
    console.log('[dbPut] Success');
    return result;
  } catch (err) { 
    console.error('[dbPut] Error:', err);
    throw err; // Re-throw so caller knows it failed
  }
}

export async function dbPutMany(store: string, values: unknown[]) {
  // Filter out records with missing id for inline-key stores
  const filtered = INLINE_KEY_PATH_STORES.has(store)
    ? values.filter((v: any) => v?.id != null)
    : values;
  if (filtered.length === 0) return;

  try {
    const db = await getDB();
    const tx = db.transaction(store, 'readwrite');
    for (const value of filtered) tx.store.put(value);
    await tx.done;
  } catch (err) {
    console.error('[dbPutMany] Error:', err);
    throw err;
  }
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

const VOICE_CACHE = 'fidel-voice-sounds-v1';

/** Singleton cache handle — avoids reopening on every sound play */
let _voiceCache: Cache | null = null;
async function getVoiceCache(): Promise<Cache | null> {
  if (_voiceCache) return _voiceCache;
  if (!('caches' in window)) return null;
  try {
    _voiceCache = await caches.open(VOICE_CACHE);
    return _voiceCache;
  } catch {
    return null;
  }
}

// ── AudioContext unlock ──────────────────────────────────────────────────────
// Browsers suspend AudioContext (and block Audio.play()) without a user gesture.
// We create and resume the context once on first user interaction so it stays
// unlocked for the entire session — even when sounds are triggered by setInterval.
let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

/** Call this once from a click/keydown handler to unlock audio for the session. */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  // Play a silent buffer to fully unlock on iOS
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
}

/**
 * Play a sound via AudioContext (decoded from blob) so the session AudioContext
 * is used instead of a new HTMLAudioElement — avoids autoplay policy blocks
 * mid-session.
 */
async function playDecodedAudio(arrayBuffer: ArrayBuffer, volume: number): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return; // no WebAudio, skip
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    console.log('[audio] decoded duration:', audioBuffer.duration.toFixed(2) + 's');
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      src.buffer = audioBuffer;
      src.connect(gainNode);
      gainNode.connect(ctx.destination);
      src.onended = () => { console.log('[audio] ended'); resolve(); };
      src.start(0);
      setTimeout(resolve, 15000);
    });
  } catch (err) {
    console.warn('[audio] decodeAudioData failed, falling back to HTMLAudio:', err);
    // Fallback: Use a Blob URL to play the original arrayBuffer via HTMLAudioElement
    try {
      const blob = new Blob([arrayBuffer]);
      const url = URL.createObjectURL(blob);
      await playHtmlAudio(url, volume);
      URL.revokeObjectURL(url);
    } catch (fallbackErr) {
      console.error('[audio] critical failure: both WebAudio and HTMLAudio failed', fallbackErr);
    }
  }
}

async function playAudioBuffer(url: string, volume: number): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) {
    await playHtmlAudio(url, volume);
    return;
  }
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    await playDecodedAudio(arrayBuffer, volume);
  } catch (err) {
    console.warn('[audio] WebAudio failed, falling back to HTMLAudio:', url, err);
    await playHtmlAudio(url, volume);
  }
}

async function playHtmlAudio(url: string, volume: number): Promise<void> {
  const audio = new Audio(url);
  audio.volume = volume;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = (reason: string) => {
      if (!resolved) {
        resolved = true;
        console.log('[audio] htmlAudio', reason, url);
        resolve();
      }
    };
    audio.onended = () => done('ended');
    audio.onerror = () => done('error');
    setTimeout(() => done('timeout'), 15000);
    audio.play().catch((e) => { console.warn('[audio] play() rejected:', e?.message, url); done('play-rejected'); });
  });
}

/**
 * Play a sound file. Checks Cache Storage first to avoid network requests
 * during gameplay, then falls back to network if not cached.
 */
export async function playCachedSound(path: string, volume = 1, bypassCache = false): Promise<void> {
  const cache = bypassCache ? null : await getVoiceCache();
  if (cache) {
    try {
      const response = await cache.match(path);
      if (response) {
        // Decode directly from the cached ArrayBuffer — no network request needed
        const arrayBuffer = await response.arrayBuffer();
        const ctx = getAudioContext();
        if (ctx) {
          await playDecodedAudio(arrayBuffer, volume);
        } else {
          // No WebAudio — fall back to blob URL + HTMLAudioElement
          const blob = new Blob([arrayBuffer]);
          const url = URL.createObjectURL(blob);
          try { await playHtmlAudio(url, volume); } finally { URL.revokeObjectURL(url); }
        }
        return;
      }
    } catch { /* fall through to network */ }
  }

  // Network/public fallback
  await playAudioBuffer(path, volume);
}

// ── Voice sound pre-caching ──────────────────────────────────────────────────

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

/** Clear all cached sounds for a specific voice (or all voice sounds) */
export async function clearVoiceCache(voice?: string): Promise<void> {
  if (!('caches' in window)) return;
  const cache = await caches.open(VOICE_CACHE);
  if (!voice) {
    // Clear everything in the voice cache
    const keys = await cache.keys();
    await Promise.all(keys.map(k => cache.delete(k)));
  } else {
    // Clear only the urls for this specific voice
    const urls = getVoiceSoundUrls(voice);
    await Promise.all(urls.map(url => cache.delete(url)));
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
  private drainResolvers: Array<() => void> = [];

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    if (!this.playing) this.drain();
  }

  /** Discard all pending (not yet started) tasks in the queue */
  clear(): void {
    this.queue.length = 0;
  }

  /** Returns a promise that resolves when the queue is fully drained */
  waitForDrain(): Promise<void> {
    if (!this.playing && this.queue.length === 0) return Promise.resolve();
    return new Promise(resolve => this.drainResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.queue.length === 0) {
      this.playing = false;
      const resolvers = this.drainResolvers.splice(0);
      resolvers.forEach(r => r());
      return;
    }
    this.playing = true;
    const task = this.queue.shift()!;
    try { await task(); } catch { /* continue on error */ }
    this.drain();
  }
}

/** Singleton queue for all number sound playback */
export const audioQueue = new AudioQueue();

/**
 * Enqueue a number sound for sequential playback via the AudioQueue.
 * Routes through playCachedSound so local cache is always used when available.
 */
export function playNumberSoundQueued(
  number: number,
  voice: string,
  volume?: number
): void {
  const ext = getVoiceExt(voice);
  const path = `/sounds/${encodeURIComponent(voice)}/${number}${ext}`;
  audioQueue.clear();
  audioQueue.enqueue(() => playCachedSound(path, volume).then(() => {}));
}
