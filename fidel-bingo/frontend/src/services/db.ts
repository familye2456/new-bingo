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
    const logKey = INLINE_KEY_PATH_STORES.has(store) ? (value as any)?.id : key;
    console.log('[dbPut] Putting to store:', store, 'key:', logKey);
    
    const db = await getDB();
    const result = key === undefined || INLINE_KEY_PATH_STORES.has(store)
      ? await db.put(store, value)
      : await db.put(store, value, key);
    console.log('[dbPut] Success');
    return result;
  } catch (err) { 
    console.error('[dbPut] Error:', err);
    throw err;
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
/** Track the currently playing WebAudio source so we can stop it on the next call */
let _activeSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext | null {
  // Never create the AudioContext here — it must only be created after a
  // user gesture (in unlockAudioContext). Browsers will block and warn if
  // we instantiate it before interaction.
  return _audioCtx;
}

/** Stop and discard the active WebAudio source node, if any */
function stopActiveSource(): void {
  if (_activeSource) {
    try { _activeSource.stop(); } catch { /* already stopped */ }
    _activeSource = null;
  }
}

/** Call this once from a click/keydown handler to unlock audio for the session. */
export function unlockAudioContext(): void {
  if (typeof AudioContext === 'undefined') return;
  // Create the context on first user gesture if it doesn't exist yet
  if (!_audioCtx) {
    _audioCtx = new AudioContext();
  }
  const ctx = _audioCtx;
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
 * Immediately stop all playing audio and clear the queue.
 * Suspends the AudioContext so any in-flight sound cuts off instantly,
 * then resumes it so future sounds can play normally.
 */
export function stopAllAudio(): void {
  // Reset the playing flag and clear pending tasks immediately so callers
  // (e.g. the auto-call interval) see playing=false right away on pause.
  audioQueue.clear();
  stopActiveSource();
  const ctx = getAudioContext();
  if (!ctx) return;
  // Suspend cuts off all currently playing AudioBufferSourceNodes immediately,
  // then resume so the context is ready for the next sound.
  ctx.suspend().then(() => ctx.resume().catch(() => {})).catch(() => {});
}

/**
 * Play a sound via AudioContext (decoded from blob) so the session AudioContext
 * is used instead of a new HTMLAudioElement — avoids autoplay policy blocks
 * mid-session.
 */
async function playDecodedAudio(arrayBuffer: ArrayBuffer, volume: number, mime = 'audio/mpeg'): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return; // no WebAudio, skip
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    console.log('[audio] decoded duration:', audioBuffer.duration.toFixed(0) + 's');
    await new Promise<void>((resolve) => {
      // Stop any previously playing source before starting a new one
      stopActiveSource();
      const src = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      src.buffer = audioBuffer;
      src.connect(gainNode);
      gainNode.connect(ctx.destination);
      _activeSource = src;
      src.onended = () => {
        console.log('[audio] ended');
        if (_activeSource === src) _activeSource = null;
        resolve();
      };
      src.start(0);
      setTimeout(resolve, 4000);
    });
  } catch (err) {
    console.warn('[audio] decodeAudioData failed, falling back to HTMLAudio:', err);
    // Fallback: Use a Blob URL to play the original arrayBuffer via HTMLAudioElement.
    // Derive the correct MIME type — WAV files must not be tagged as audio/mpeg
    // or the browser will reject them with ERR_REQUEST_RANGE_NOT_SATISFIABLE.
    try {
      const blob = new Blob([arrayBuffer], { type: mime });
      const url = URL.createObjectURL(blob);
      await playHtmlAudio(url, volume);
      URL.revokeObjectURL(url);
    } catch (fallbackErr) {
      console.error('[audio] critical failure: both WebAudio and HTMLAudio failed', fallbackErr);
    }
  }
}

async function playAudioBuffer(url: string, volume: number): Promise<void> {
  // WAV and M4A: skip WebAudio entirely, use HTMLAudio directly
  if (url.endsWith('.wav') || url.endsWith('.m4a')) {
    await playHtmlAudio(url, volume);
    return;
  }
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
    const mime = 'audio/mpeg';
    await playDecodedAudio(arrayBuffer, volume, mime);
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
    setTimeout(() => done('timeout'), 4000);
    audio.play().catch((e) => { console.warn('[audio] play() rejected:', e?.message, url); done('play-rejected'); });
  });
}

/**
 * Play a sound file. Checks Cache Storage first to avoid network requests
 * during gameplay, then falls back to network if not cached.
 */
export async function playCachedSound(path: string, volume = 1, bypassCache = false): Promise<void> {
  // WAV and M4A files: use HTMLAudio directly — decodeAudioData is unreliable
  // for these formats in Chrome/Chromium and causes EncodingError.
  const useHtmlAudio = path.endsWith('.wav') || path.endsWith('.m4a');

  const cache = bypassCache ? null : await getVoiceCache();
  if (cache) {
    try {
      const response = await cache.match(path);
      if (response) {
        const arrayBuffer = await response.clone().arrayBuffer();
        if (arrayBuffer.byteLength > 100) {
          const mime = path.endsWith('.wav') ? 'audio/wav' : path.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg';
          if (useHtmlAudio) {
            // Play WAV/M4A via blob URL + HTMLAudioElement — reliable across browsers
            const blob = new Blob([arrayBuffer], { type: mime });
            const url = URL.createObjectURL(blob);
            try { await playHtmlAudio(url, volume); } finally { URL.revokeObjectURL(url); }
            return;
          }
          const ctx = getAudioContext();
          if (ctx) {
            try {
              await playDecodedAudio(arrayBuffer, volume, mime);
              return;
            } catch {
              // decodeAudioData failed — cache entry is likely corrupt, evict it
              console.warn('[audio] corrupt cache entry, evicting:', path);
              cache.delete(path).catch(() => {});
              // fall through to network
            }
          } else {
            const blob = new Blob([arrayBuffer], { type: mime });
            const url = URL.createObjectURL(blob);
            try { await playHtmlAudio(url, volume); return; } finally { URL.revokeObjectURL(url); }
          }
        } else {
          console.warn('[audio] empty cache entry, evicting:', path);
          cache.delete(path).catch(() => {});
        }
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
  // Token incremented on every clear() — in-flight tasks check this to bail early
  private _generation = 0;

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    if (!this.playing) {
      this.playing = true;
      this.drain();
    }
  }

  /** Discard all pending tasks and reset the playing flag immediately */
  clear(): void {
    this._generation++;          // invalidates any in-flight task
    this.queue.length = 0;
    this.playing = false;
    const resolvers = this.drainResolvers.splice(0);
    resolvers.forEach(r => r());
  }

  /** Returns a promise that resolves when the queue is fully drained */
  waitForDrain(): Promise<void> {
    if (!this.playing && this.queue.length === 0) return Promise.resolve();
    return new Promise(resolve => this.drainResolvers.push(resolve));
  }

  /** Wrap a task so it resolves immediately if the queue was cleared mid-flight */
  private wrap(task: () => Promise<void>, gen: number): () => Promise<void> {
    return () => {
      if (this._generation !== gen) return Promise.resolve();
      return task();
    };
  }

  private async drain(): Promise<void> {
    if (this.queue.length === 0) {
      this.playing = false;
      const resolvers = this.drainResolvers.splice(0);
      resolvers.forEach(r => r());
      return;
    }
    this.playing = true;
    const gen = this._generation;
    const task = this.queue.shift()!;
    try { await this.wrap(task, gen)(); } catch { /* continue on error */ }
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
  // Stop any currently playing sound and clear pending tasks before enqueuing
  // the new one — prevents sounds from stacking at the WebAudio layer.
  stopActiveSource();
  audioQueue.clear();
  audioQueue.enqueue(() => playCachedSound(path, volume).then(() => {}));
}
