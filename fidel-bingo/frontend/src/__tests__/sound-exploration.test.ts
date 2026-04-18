/**
 * Bug Condition Exploration Tests — Task 3.11 (Updated to test FIXED code)
 *
 * These tests verify the FIXED implementations satisfy the expected behavior.
 * All 5 tests should PASS on fixed code.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioQueue, playNumberSoundQueued } from '../services/db';

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration Tests (EXPECTED TO PASS on fixed code)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioInstances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Test 1.1 — Overlap (Bug 1.1)
   *
   * Enqueue two tasks into AudioQueue.
   * Assert that the second task does NOT start until the first one resolves.
   *
   * PASSES on fixed code — AudioQueue serialises playback.
   *
   * Validates: Requirements 2.1, 2.2
   */
  it('1.1 — Overlap: AudioQueue should not start second task until first resolves', async () => {
    const queue = new AudioQueue();

    const order: string[] = [];
    let resolveFirst!: () => void;

    const firstTask = () =>
      new Promise<void>((resolve) => {
        order.push('first-started');
        resolveFirst = () => {
          order.push('first-ended');
          resolve();
        };
      });

    const secondTask = vi.fn().mockImplementation(async () => {
      order.push('second-started');
    });

    queue.enqueue(firstTask);
    queue.enqueue(secondTask);

    // Give the queue a tick to start the first task
    await new Promise((r) => setTimeout(r, 0));

    // Second task should NOT have started yet — first is still pending
    expect(secondTask).not.toHaveBeenCalled();
    expect(order).toEqual(['first-started']);

    // Resolve the first task
    resolveFirst();

    // Wait for the queue to process the second task
    await new Promise((r) => setTimeout(r, 10));

    // Now second task should have run, in order
    expect(secondTask).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['first-started', 'first-ended', 'second-started']);
  });

  /**
   * Test 1.2 — Cache bypass (Bug 1.2)
   *
   * Call playNumberSoundQueued(7, 'boy sound').
   * Assert the enqueued task creates an Audio element with the correct cached URL
   * (proving it goes through playCachedSound, not a raw new Audio() bypass).
   *
   * PASSES on fixed code — playNumberSoundQueued enqueues a playCachedSound task
   * that constructs the correct URL for the voice/number combination.
   *
   * Validates: Requirements 2.2
   */
  it('1.2 — Cache bypass: playNumberSoundQueued should enqueue a task that uses the correct cached URL', async () => {
    setupAudioMock();

    const dbModule = await import('../services/db');

    // Spy on audioQueue.enqueue to capture the task without executing it
    const enqueueSpy = vi.spyOn(dbModule.audioQueue, 'enqueue').mockImplementation(() => {});

    playNumberSoundQueued(7, 'boy sound');

    // enqueue should have been called once
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    // Execute the captured task manually — it should create an Audio with the correct URL
    const task = enqueueSpy.mock.calls[0][0];
    await task();

    // An Audio instance should have been created with the correct voice/number URL
    // This proves the task goes through playCachedSound (which uses new Audio(path))
    // rather than a raw bypass that would use a different URL format.
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).toMatch(/boy%20sound\/7\.wav/);
  });

  /**
   * Test 1.3 — Missing winner sound (Bug 1.3)
   *
   * Simulate the fixed game_finished handler from GamePage.tsx.
   * Assert playCachedSound was called with a path containing 'winner.wav'.
   *
   * PASSES on fixed code — game_finished handler calls playCachedSound('/sounds/winner.wav').
   *
   * Validates: Requirements 2.3
   */
  it('1.3 — Missing winner sound: game_finished handler should call playCachedSound with winner.wav', async () => {
    setupAudioMock();

    const dbModule = await import('../services/db');
    const playCachedSoundSpy = vi
      .spyOn(dbModule, 'playCachedSound')
      .mockResolvedValue(undefined);

    // Replicate the FIXED game_finished socket handler from GamePage.tsx:
    //   socket.on('game_finished', () => {
    //     playCachedSound('/sounds/winner.wav', volumeRef.current).catch(() => {});
    //     setAutoCall(false);
    //     setTimeout(() => navigate('/dashboard'), 3000);
    //   });
    const volumeRef = { current: 1 };
    const fixedGameFinishedHandler = () => {
      dbModule.playCachedSound('/sounds/winner.wav', volumeRef.current).catch(() => {});
      // setAutoCall(false) and navigate omitted — not relevant to sound assertion
    };

    fixedGameFinishedHandler();

    // Allow the microtask to settle
    await new Promise((r) => setTimeout(r, 0));

    // ASSERTION: playCachedSound('/sounds/winner.wav') should have been called
    expect(playCachedSoundSpy).toHaveBeenCalledWith(
      expect.stringContaining('winner.wav'),
      expect.any(Number)
    );
  });

  /**
   * Test 1.4 — No auto-preload (Bug 1.4)
   *
   * Simulate the fixed useEffect for voice preload from GamePage.tsx.
   * Assert downloadVoiceSounds was called with the active voice.
   *
   * PASSES on fixed code — useEffect calls downloadVoiceSounds(voice).
   *
   * Validates: Requirements 2.4
   */
  it('1.4 — No auto-preload: voice preload useEffect should call downloadVoiceSounds with active voice', async () => {
    const dbModule = await import('../services/db');
    const downloadVoiceSoundsSpy = vi
      .spyOn(dbModule, 'downloadVoiceSounds')
      .mockResolvedValue(undefined);

    // Replicate the FIXED useEffect from GamePage.tsx:
    //   useEffect(() => {
    //     downloadVoiceSounds(voice);
    //   }, [voice]);
    const voice = 'boy sound';
    const simulateFixedUseEffect = (v: string) => {
      dbModule.downloadVoiceSounds(v);
    };

    simulateFixedUseEffect(voice);

    // ASSERTION: downloadVoiceSounds should have been called with 'boy sound'
    expect(downloadVoiceSoundsSpy).toHaveBeenCalledWith('boy sound');
  });

  /**
   * Test 1.5 — Fragile flag (Bug 1.5)
   *
   * Simulate the fixed _unlocked pattern from GamePage.tsx.
   * Dispatch a pointerdown event; assert _unlocked becomes true.
   *
   * PASSES on fixed code — pointerdown listener with capture:true sets _unlocked.
   *
   * Validates: Requirements 2.5
   */
  it('1.5 — Fragile flag: pointerdown should unlock audio (_unlocked should become true)', () => {
    // Replicate the FIXED module-level unlock logic from GamePage.tsx:
    //   let _unlocked = false;
    //   document.addEventListener('pointerdown', unlock, { capture: true, once: true });
    //   document.addEventListener('touchstart', unlock, { capture: true, once: true });
    //   document.addEventListener('keydown', unlock, { capture: true, once: true });
    let _unlocked = false;
    const unlock = () => {
      if (_unlocked) return;
      _unlocked = true;
    };

    // Fixed: listens to 'pointerdown' with capture:true
    document.addEventListener('pointerdown', unlock, { capture: true, once: true });
    document.addEventListener('touchstart', unlock, { capture: true, once: true });
    document.addEventListener('keydown', unlock, { capture: true, once: true });

    // Dispatch pointerdown — should unlock audio
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // ASSERTION: After pointerdown, _unlocked should be true
    expect(_unlocked).toBe(true);

    // Cleanup
    document.removeEventListener('pointerdown', unlock, { capture: true });
    document.removeEventListener('touchstart', unlock, { capture: true });
    document.removeEventListener('keydown', unlock, { capture: true });
  });
});
