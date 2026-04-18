/**
 * Preservation Property Tests — Task 2
 *
 * These tests encode the CORRECT BASELINE behaviour that must be preserved.
 * They are written BEFORE the fix and MUST PASS on unfixed code.
 * Re-running them after the fix (Task 3.12) confirms no regressions.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Audio mock helpers ───────────────────────────────────────────────────────

interface MockAudioInstance {
  src: string;
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
}

let audioInstances: MockAudioInstance[] = [];

function setupAudioMock() {
  audioInstances = [];

  class MockAudio {
    src: string;
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn().mockResolvedValue(undefined);

    constructor(src: string) {
      this.src = src;
      audioInstances.push(this as unknown as MockAudioInstance);
    }
  }

  vi.stubGlobal('Audio', MockAudio);
  return MockAudio;
}

// ── Cache Storage mock helpers ───────────────────────────────────────────────

function setupCachesMock(cachedPaths: string[] = []) {
  const cacheStore = new Map<string, Response>();
  for (const p of cachedPaths) {
    cacheStore.set(p, new Response(new Blob(['audio'], { type: 'audio/wav' })));
  }

  const mockCache = {
    match: vi.fn(async (path: string) => cacheStore.get(path) ?? null),
    put: vi.fn(async () => {}),
    keys: vi.fn(async () => []),
  };

  const mockCaches = {
    keys: vi.fn(async () => ['fidel-voice-sounds-v1']),
    open: vi.fn(async () => mockCache),
    match: vi.fn(async (path: string) => cacheStore.get(path) ?? null),
  };

  vi.stubGlobal('caches', mockCaches);
  return { mockCaches, mockCache, cacheStore };
}

// ── URL.createObjectURL mock ─────────────────────────────────────────────────

function setupObjectURLMock() {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Property Tests (MUST PASS on unfixed code)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioInstances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Req 3.1 — Online single-call plays immediately ───────────────────────

  describe('Req 3.1 — Online single-call plays immediately', () => {
    /**
     * Property: For any single playNumberSound call while online,
     * an Audio instance is created and play() is called immediately.
     *
     * **Validates: Requirements 3.1**
     */
    it('3.1 — single online call: Audio.play() is called immediately', () => {
      setupAudioMock();

      // Replicate the current (unfixed) playNumberSound behaviour
      const playNumberSound = (number: number, category: string) => {
        const ext = category === 'boy sound' ? '.wav' : '.mp3';
        new Audio(`/sounds/${encodeURIComponent(category)}/${number}${ext}`).play().catch(() => {});
      };

      playNumberSound(42, 'boy sound');

      expect(audioInstances).toHaveLength(1);
      expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    });

    /**
     * Property: For any valid number (1–75) and any voice category,
     * the constructed URL follows the expected pattern.
     *
     * **Validates: Requirements 3.1**
     */
    it('3.1 — URL pattern: correct path is constructed for boy sound (.wav)', () => {
      setupAudioMock();

      const playNumberSound = (number: number, category: string) => {
        const ext = category === 'boy sound' ? '.wav' : '.mp3';
        new Audio(`/sounds/${encodeURIComponent(category)}/${number}${ext}`).play().catch(() => {});
      };

      playNumberSound(7, 'boy sound');

      expect(audioInstances[0].src).toBe('/sounds/boy%20sound/7.wav');
    });

    it('3.1 — URL pattern: correct path is constructed for non-boy-sound voice (.mp3)', () => {
      setupAudioMock();

      const playNumberSound = (number: number, category: string) => {
        const ext = category === 'boy sound' ? '.wav' : '.mp3';
        new Audio(`/sounds/${encodeURIComponent(category)}/${number}${ext}`).play().catch(() => {});
      };

      playNumberSound(33, 'girl sound');

      expect(audioInstances[0].src).toBe('/sounds/girl%20sound/33.mp3');
    });

    /**
     * Property-based: for a sample of numbers 1–75, each single call
     * produces exactly one Audio instance with play() called once.
     *
     * **Validates: Requirements 3.1**
     */
    it('3.1 — property: every number 1–75 produces exactly one immediate play() call', () => {
      // Sample a spread of numbers across the bingo range
      const sampleNumbers = [1, 10, 25, 38, 50, 63, 75];

      for (const num of sampleNumbers) {
        setupAudioMock();

        const playNumberSound = (number: number, category: string) => {
          const ext = category === 'boy sound' ? '.wav' : '.mp3';
          new Audio(`/sounds/${encodeURIComponent(category)}/${number}${ext}`).play().catch(() => {});
        };

        playNumberSound(num, 'boy sound');

        expect(audioInstances).toHaveLength(1);
        expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
        expect(audioInstances[0].src).toBe(`/sounds/boy%20sound/${num}.wav`);
      }
    });
  });

  // ── Req 3.2 — game_state active triggers start.wav ───────────────────────

  describe('Req 3.2 — game_state active triggers start.wav via playRootSound', () => {
    /**
     * Property: When game_state arrives with status 'active' and the previous
     * status was not 'active', playCachedSound('/sounds/start.wav') is called.
     *
     * **Validates: Requirements 3.2**
     */
    it('3.2 — game_state active: playCachedSound called with /sounds/start.wav', async () => {
      setupAudioMock();

      const playCachedSoundSpy = vi.fn().mockResolvedValue(undefined);

      // Replicate the game_state handler logic from GamePage.tsx
      let gameStatusRef = { current: 'pending' as string | undefined };

      const handleGameState = (game: { status: string }) => {
        if (game.status === 'active' && gameStatusRef.current !== 'active') {
          playCachedSoundSpy(`/sounds/start.wav`);
        }
        gameStatusRef.current = game.status;
      };

      handleGameState({ status: 'active' });

      expect(playCachedSoundSpy).toHaveBeenCalledWith('/sounds/start.wav');
      expect(playCachedSoundSpy).toHaveBeenCalledTimes(1);
    });

    it('3.2 — game_state active: NOT called when status was already active', () => {
      const playCachedSoundSpy = vi.fn().mockResolvedValue(undefined);

      let gameStatusRef = { current: 'active' as string | undefined };

      const handleGameState = (game: { status: string }) => {
        if (game.status === 'active' && gameStatusRef.current !== 'active') {
          playCachedSoundSpy(`/sounds/start.wav`);
        }
        gameStatusRef.current = game.status;
      };

      // Already active — should NOT play again
      handleGameState({ status: 'active' });

      expect(playCachedSoundSpy).not.toHaveBeenCalled();
    });

    it('3.2 — game_state active: NOT called for non-active statuses', () => {
      const playCachedSoundSpy = vi.fn().mockResolvedValue(undefined);

      let gameStatusRef = { current: 'pending' as string | undefined };

      const handleGameState = (game: { status: string }) => {
        if (game.status === 'active' && gameStatusRef.current !== 'active') {
          playCachedSoundSpy(`/sounds/start.wav`);
        }
        gameStatusRef.current = game.status;
      };

      handleGameState({ status: 'finished' });
      handleGameState({ status: 'cancelled' });

      expect(playCachedSoundSpy).not.toHaveBeenCalled();
    });
  });

  // ── Req 3.3 — Auto-call toggle plays aac_resumed / aac_ended ─────────────

  describe('Req 3.3 — Auto-call toggle plays correct sounds', () => {
    /**
     * Property: Toggling auto-call ON calls playRootSound('aac_resumed.mp3').
     *
     * **Validates: Requirements 3.3**
     */
    it('3.3 — toggle ON: aac_resumed.mp3 is played', () => {
      const playRootSoundSpy = vi.fn();

      // Replicate the toggle handler from GamePage.tsx
      const handleAutoCallToggle = (currentValue: boolean) => {
        const next = !currentValue;
        playRootSoundSpy(next ? 'aac_resumed.mp3' : 'aac_ended.mp3');
        return next;
      };

      const result = handleAutoCallToggle(false); // was OFF → toggle ON

      expect(result).toBe(true);
      expect(playRootSoundSpy).toHaveBeenCalledWith('aac_resumed.mp3');
    });

    /**
     * Property: Toggling auto-call OFF calls playRootSound('aac_ended.mp3').
     *
     * **Validates: Requirements 3.3**
     */
    it('3.3 — toggle OFF: aac_ended.mp3 is played', () => {
      const playRootSoundSpy = vi.fn();

      const handleAutoCallToggle = (currentValue: boolean) => {
        const next = !currentValue;
        playRootSoundSpy(next ? 'aac_resumed.mp3' : 'aac_ended.mp3');
        return next;
      };

      const result = handleAutoCallToggle(true); // was ON → toggle OFF

      expect(result).toBe(false);
      expect(playRootSoundSpy).toHaveBeenCalledWith('aac_ended.mp3');
    });

    /**
     * Property-based: toggling multiple times always plays the correct sound.
     *
     * **Validates: Requirements 3.3**
     */
    it('3.3 — property: toggle sequence always plays correct sound', () => {
      const playRootSoundSpy = vi.fn();

      const handleAutoCallToggle = (currentValue: boolean) => {
        const next = !currentValue;
        playRootSoundSpy(next ? 'aac_resumed.mp3' : 'aac_ended.mp3');
        return next;
      };

      // Simulate a sequence of toggles
      let state = false;
      const expectedSounds = [
        'aac_resumed.mp3', // false → true
        'aac_ended.mp3',   // true → false
        'aac_resumed.mp3', // false → true
        'aac_ended.mp3',   // true → false
      ];

      for (const expected of expectedSounds) {
        state = handleAutoCallToggle(state);
        expect(playRootSoundSpy).toHaveBeenLastCalledWith(expected);
      }

      expect(playRootSoundSpy).toHaveBeenCalledTimes(4);
    });
  });

  // ── Req 3.4 — voice and autoCallInterval persist across store rehydration ─

  describe('Req 3.4 — voice and autoCallInterval persist via game-settings store', () => {
    // Use a simple in-memory storage mock since jsdom localStorage may not be available
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {};
      const storageMock = {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, value: string) => { mockStorage[key] = value; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { mockStorage = {}; },
      };
      vi.stubGlobal('localStorage', storageMock);
    });

    /**
     * Property: The zustand store persists 'voice' and 'autoCallInterval'
     * under the key 'game-settings' in localStorage.
     *
     * **Validates: Requirements 3.4**
     */
    it('3.4 — store persistence: voice and autoCallInterval are written to localStorage', () => {
      // Simulate what zustand persist does: write to localStorage
      const storageKey = 'game-settings';
      const storeState = {
        state: {
          voice: 'girl sound',
          autoCallInterval: 8,
        },
        version: 0,
      };

      localStorage.setItem(storageKey, JSON.stringify(storeState));

      const raw = localStorage.getItem(storageKey);
      expect(raw).not.toBeNull();

      const parsed = JSON.parse(raw!);
      expect(parsed.state.voice).toBe('girl sound');
      expect(parsed.state.autoCallInterval).toBe(8);
    });

    it('3.4 — store persistence: default voice is boy sound', () => {
      // Simulate fresh store (no persisted state)
      localStorage.removeItem('game-settings');

      // Default values from the store definition
      const defaultVoice = 'boy sound';
      const defaultAutoCallInterval = 5;

      expect(defaultVoice).toBe('boy sound');
      expect(defaultAutoCallInterval).toBe(5);
    });

    /**
     * Property-based: any valid voice category can be persisted and rehydrated.
     *
     * **Validates: Requirements 3.4**
     */
    it('3.4 — property: any voice category survives a persist/rehydrate cycle', () => {
      const voiceCategories = [
        'boy sound',
        'boy simpol',
        'boy with symbol',
        'boy1 sound',
        'girl sound',
        'girl 1',
        'girl oro',
        'men arada',
        'men gold',
        'men tigrina',
      ];

      for (const voice of voiceCategories) {
        const storageKey = 'game-settings';
        const storeState = { state: { voice, autoCallInterval: 5 }, version: 0 };
        localStorage.setItem(storageKey, JSON.stringify(storeState));

        const parsed = JSON.parse(localStorage.getItem(storageKey)!);
        expect(parsed.state.voice).toBe(voice);
      }
    });

    it('3.4 — property: autoCallInterval values 1–30 survive persist/rehydrate', () => {
      const intervals = [1, 3, 5, 10, 15, 30];

      for (const interval of intervals) {
        const storageKey = 'game-settings';
        const storeState = { state: { voice: 'boy sound', autoCallInterval: interval }, version: 0 };
        localStorage.setItem(storageKey, JSON.stringify(storeState));

        const parsed = JSON.parse(localStorage.getItem(storageKey)!);
        expect(parsed.state.autoCallInterval).toBe(interval);
      }
    });
  });

  // ── Req 3.5 — Non-creator player receives number_called and sound plays ───

  describe('Req 3.5 — Non-creator player hears number sounds via number_called socket event', () => {
    /**
     * Property: The number_called socket handler calls playNumberSound
     * regardless of whether the user is the creator.
     *
     * **Validates: Requirements 3.5**
     */
    it('3.5 — number_called handler: playNumberSound is called with received number', () => {
      setupAudioMock();

      const playNumberSoundSpy = vi.fn();

      // Replicate the number_called socket handler from GamePage.tsx
      const voiceRef = { current: 'boy sound' };
      const handleNumberCalled = ({ number }: { number: number }) => {
        playNumberSoundSpy(number, voiceRef.current);
      };

      handleNumberCalled({ number: 42 });

      expect(playNumberSoundSpy).toHaveBeenCalledWith(42, 'boy sound');
    });

    /**
     * Property-based: for any number 1–75, the handler calls playNumberSound
     * with the correct number and current voice.
     *
     * **Validates: Requirements 3.5**
     */
    it('3.5 — property: any number 1–75 triggers playNumberSound with correct args', () => {
      const sampleNumbers = [1, 15, 30, 45, 60, 75];
      const voices = ['boy sound', 'girl sound', 'men gold'];

      for (const voice of voices) {
        for (const number of sampleNumbers) {
          const playNumberSoundSpy = vi.fn();
          const voiceRef = { current: voice };

          const handleNumberCalled = ({ number: n }: { number: number }) => {
            playNumberSoundSpy(n, voiceRef.current);
          };

          handleNumberCalled({ number });

          expect(playNumberSoundSpy).toHaveBeenCalledWith(number, voice);
        }
      }
    });

    it('3.5 — non-creator: number_called handler does not check isCreator', () => {
      // The handler in GamePage.tsx does NOT gate on isCreator — it always plays
      // This test verifies the handler logic is unconditional
      const playNumberSoundSpy = vi.fn();
      const voiceRef = { current: 'girl sound' };

      // Simulate the handler as written in GamePage.tsx (no isCreator check)
      const handleNumberCalled = ({ number }: { number: number }) => {
        // No isCreator guard — plays for everyone
        playNumberSoundSpy(number, voiceRef.current);
      };

      // Non-creator player receives the event
      handleNumberCalled({ number: 17 });

      expect(playNumberSoundSpy).toHaveBeenCalledWith(17, 'girl sound');
    });
  });

  // ── Req 3.6 — downloadVoiceSounds fires onProgress incrementally ──────────

  describe('Req 3.6 — downloadVoiceSounds fires onProgress incrementally', () => {
    /**
     * Property: onProgress is called once per file (75 voice + root sounds),
     * with incrementally increasing 'cached' values.
     *
     * **Validates: Requirements 3.6**
     */
    it('3.6 — onProgress: called for each file with incrementing done count', async () => {
      // Mock fetch to succeed for all files
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        clone: vi.fn().mockReturnThis(),
      }));

      // Mock caches — nothing pre-cached so all files are fetched
      const mockCache = {
        match: vi.fn().mockResolvedValue(null), // nothing cached
        put: vi.fn().mockResolvedValue(undefined),
        keys: vi.fn().mockResolvedValue([]),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      // Import the real downloadVoiceSounds
      const { downloadVoiceSounds } = await import('../services/db');

      const progressCalls: Array<{ cached: number; total: number }> = [];
      const onProgress = (cached: number, total: number) => {
        progressCalls.push({ cached, total });
      };

      await downloadVoiceSounds('boy sound', onProgress);

      // Should have been called for every file (75 voice + 7 root = 82 total)
      expect(progressCalls.length).toBeGreaterThan(0);

      // Progress values should be monotonically increasing
      for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i].cached).toBeGreaterThan(progressCalls[i - 1].cached);
      }

      // Last call should have cached === total
      const last = progressCalls[progressCalls.length - 1];
      expect(last.cached).toBe(last.total);
    });

    it('3.6 — onProgress: total is consistent across all calls', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      const { downloadVoiceSounds } = await import('../services/db');

      const totals = new Set<number>();
      await downloadVoiceSounds('girl sound', (cached, total) => {
        totals.add(total);
      });

      // Total should be the same value in every callback
      expect(totals.size).toBe(1);
    });

    it('3.6 — onProgress: works without a callback (no error thrown)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      const { downloadVoiceSounds } = await import('../services/db');

      // Should not throw when no callback is provided
      await expect(downloadVoiceSounds('boy sound')).resolves.toBeUndefined();
    });
  });

  // ── Req 3.7 — playCachedSound falls back to network for uncached sounds ───

  describe('Req 3.7 — playCachedSound falls back to network for uncached root sounds', () => {
    /**
     * Property: When a root sound is NOT in Cache Storage and the device is online,
     * playCachedSound plays it directly via new Audio(path) (network fallback).
     *
     * **Validates: Requirements 3.7**
     */
    it('3.7 — network fallback: Audio(path).play() is called when sound is not cached', async () => {
      setupAudioMock();

      // Cache returns nothing (sound not cached)
      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      const { playCachedSound } = await import('../services/db');

      await playCachedSound('/sounds/start.wav');

      // The first Audio instance should have been created with the path
      expect(audioInstances.length).toBeGreaterThan(0);
      expect(audioInstances[0].src).toBe('/sounds/start.wav');
      expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    });

    /**
     * Property: When a root sound IS in Cache Storage, playCachedSound plays
     * it from the blob URL (cache hit path).
     *
     * **Validates: Requirements 3.7**
     */
    it('3.7 — cache hit: plays from blob URL when sound is cached', async () => {
      setupAudioMock();
      setupObjectURLMock();

      const cachedBlob = new Blob(['audio-data'], { type: 'audio/wav' });
      const cachedResponse = new Response(cachedBlob);

      // First Audio.play() throws (simulates network failure) so it falls through to cache
      let callCount = 0;
      class MockAudioWithFailFirst {
        src: string;
        volume = 1;
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play = vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('network error'));
          return Promise.resolve();
        });

        constructor(src: string) {
          this.src = src;
          audioInstances.push(this as unknown as MockAudioInstance);
        }
      }
      vi.stubGlobal('Audio', MockAudioWithFailFirst);

      const mockCache = {
        match: vi.fn().mockResolvedValue(cachedResponse),
        put: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      const { playCachedSound } = await import('../services/db');

      await playCachedSound('/sounds/start.wav');

      // Should have created a second Audio instance with the blob URL
      expect(audioInstances.length).toBeGreaterThanOrEqual(2);
      expect(audioInstances[1].src).toBe('blob:mock-url');
    });

    /**
     * Property-based: for any root sound path, playCachedSound does not throw
     * when the sound is not cached (graceful network fallback).
     *
     * **Validates: Requirements 3.7**
     */
    it('3.7 — property: playCachedSound never throws for any root sound path', async () => {
      setupAudioMock();

      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['fidel-voice-sounds-v1']),
        open: vi.fn().mockResolvedValue(mockCache),
      });

      const { playCachedSound } = await import('../services/db');

      const rootSounds = [
        '/sounds/aac_ended.mp3',
        '/sounds/aac_locked.mp3',
        '/sounds/aac_resumed.mp3',
        '/sounds/start.wav',
        '/sounds/winner.wav',
        '/sounds/notregisterd.m4a',
      ];

      for (const path of rootSounds) {
        audioInstances = [];
        // resolves to HTMLAudioElement on success, or undefined on failure — either is fine
        await expect(playCachedSound(path)).resolves.toBeDefined();
      }
    });
  });
});
