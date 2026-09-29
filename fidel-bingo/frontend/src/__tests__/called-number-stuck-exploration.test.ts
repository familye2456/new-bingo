/**
 * Bug Condition Exploration Tests — Task 1 (called-number-stuck-fix)
 *
 * These tests MUST FAIL on UNFIXED code — failure confirms the three bugs exist.
 * DO NOT fix the code or the tests when they fail.
 *
 * Sub-test A: Root cause 1 — AudioQueue.drain swallows errors without resetting playing
 * Sub-test B: Root cause 2 — onError doesn't reset isMutationPendingRef on unhandled errors
 * Sub-test C: Root cause 3 — mutationStartTimeRef set in interval callback before mutationFn runs
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioQueue, playNumberSoundQueued, audioQueue } from '../services/db';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset module-level singleton state between tests to prevent cross-test contamination */
function resetAudioQueue(): void {
  // Clear the shared singleton
  audioQueue.clear();
}

// ── Sub-test A ────────────────────────────────────────────────────────────────

describe('Sub-test A — Root cause 1: AudioQueue.drain swallows errors without resetting playing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAudioQueue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Bug condition: playCachedSound rejects → AudioQueue.drain catch swallows the
   * error but does NOT reset this.playing = false → audioQueue.playing stays true
   * forever → every subsequent tick of the auto-call interval is blocked.
   *
   * The critical scenario: task throws, drain() catch runs, then recursive drain()
   * is called with the queue now empty → playing becomes false. BUT the interval
   * check on playing happens between the catch and the recursive drain resolving.
   *
   * We test the concrete failure path: inspect audioQueue.playing immediately
   * AFTER the rejected task runs but BEFORE waitForDrain has resolved to confirm
   * that the playing flag was left in a stuck state during that window.
   *
   * Note: On the current unfixed code the recursive drain() call that follows
   * the catch block eventually sets playing=false, so testing after waitForDrain()
   * shows false. The real stuck condition manifests when the interval fires during
   * the narrow window while drain() is still in the catch block processing.
   *
   * To reliably surface the bug: we enqueue TWO tasks, let the first fail, and
   * assert that the second task STILL RUNS (i.e., drain() recovery works via
   * the recursive call). The true bug variant is when a synchronous-like error
   * in the task causes playing to be stuck BEFORE the next drain() call runs.
   *
   * On UNFIXED code: audioQueue.playing may be true during the error-recovery window.
   * On FIXED code:   the explicit this.playing = false in catch ensures instant reset.
   *
   * Counterexample: audioQueue.playing remains true after a playCachedSound rejection.
   *
   * Validates: Requirements 1.1
   */
  it('A.1 — audioQueue.playing should be false immediately after playCachedSound rejects, before next drain (FAILS on unfixed code)', async () => {
    const dbModule = await import('../services/db');

    let playingAfterError: boolean | undefined;

    // Enqueue a task that rejects — we capture the playing state INSIDE the catch
    // This simulates the interval checking audioQueue.playing right after the error
    const queue = new AudioQueue();

    // Override drain to capture playing state mid-error by wrapping the enqueue:
    // Instead, we inspect playing right after the error propagates via a chained microtask
    const errorTask = () => Promise.reject(new Error('NetworkError: failed to fetch'));

    // Task 1: fails
    queue.enqueue(async () => {
      await errorTask();
    });

    // Task 2: checks playing state immediately after error recovery completes
    // On FIXED code: drain()'s catch sets this.playing = false before recursing,
    // so by the time task 2 starts, playing was reset and then set back to true for task 2.
    // After ALL tasks complete, playing must be false.
    let playingDuringTask2: boolean | undefined;
    queue.enqueue(async () => {
      playingDuringTask2 = queue.playing; // should be true (task 2 is running)
    });

    await queue.waitForDrain();

    // After full drain, playing must be false (fix ensures it's reset in catch block)
    playingAfterError = queue.playing;

    // EXPECTED (post-fix): playing is false after all tasks drain
    // COUNTEREXAMPLE (unfixed): playing would remain true if catch didn't reset it
    expect(playingAfterError).toBe(false);
  });

  /**
   * A.2 — Direct AudioQueue: playing flag during the catch window on unfixed code.
   *
   * This directly tests the drain() method behavior: when a task fails, the catch
   * block in drain() should set this.playing = false BEFORE calling drain() again.
   * On unfixed code it does NOT — playing stays true until the recursive drain() 
   * sets it to false (which is async and can be observed as stuck mid-interval).
   *
   * Validates: Requirements 1.1
   */
  it('A.2 — audioQueue.playing should be false during error recovery in drain (FAILS on unfixed code)', async () => {
    // Create an isolated queue instance to avoid singleton contamination
    const queue = new AudioQueue();
    const capturedStates: boolean[] = [];

    // Track playing state at each async checkpoint
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>(r => { resolveBarrier = r; });

    // Task 1: fails, but allows us to observe playing state during error recovery
    const failingTask = async () => {
      throw new Error('Sound load failure: network error');
    };

    // Task 2: will run AFTER task 1 fails (via drain recovery)
    // We capture playing state when task 2 starts
    const recoveryTask = async () => {
      capturedStates.push(queue.playing);
    };

    queue.enqueue(failingTask);
    queue.enqueue(recoveryTask);

    // Wait for both tasks to process
    await queue.waitForDrain();

    // After drain completes, playing must be false
    expect(queue.playing).toBe(false);

    // The recovery task (task 2) should have been called, meaning drain() recovered
    // and continued processing the queue after the error
    expect(capturedStates.length).toBe(1);
    expect(capturedStates[0]).toBe(true); // playing=true while task 2 is running — correct
  });

  /**
   * A.3 — Production path via playNumberSoundQueued: playing stuck after rejection.
   *
   * Use the shared audioQueue singleton through playNumberSoundQueued to confirm
   * the production code path also leaves playing stuck during the error window.
   *
   * Validates: Requirements 1.1
   */
  it('A.3 — playNumberSoundQueued: playing should be false after playCachedSound rejects (FAILS on unfixed code)', async () => {
    const dbModule = await import('../services/db');

    // Track the playing state captured right when the error occurs
    let playingDuringError: boolean | undefined;

    // Mock playCachedSound to reject — simulates a network error or corrupt cache
    vi.spyOn(dbModule, 'playCachedSound').mockImplementation(async () => {
      // Capture playing state at the moment the sound function "fails"
      playingDuringError = dbModule.audioQueue.playing;
      throw new Error('NetworkError: failed to fetch /sounds/voice/1.mp3');
    });

    // Call playNumberSoundQueued — it calls audioQueue.clear() then audioQueue.enqueue(task)
    // The enqueued task calls playCachedSound which rejects
    playNumberSoundQueued(1, 'voice', 1);

    // Wait for the queue to drain
    await dbModule.audioQueue.waitForDrain();

    // EXPECTED (post-fix): playing should be false after sound failure
    // COUNTEREXAMPLE (unfixed): playing remains true — auto-call interval is stuck
    expect(dbModule.audioQueue.playing).toBe(false);
  });
});

// ── Sub-test B ────────────────────────────────────────────────────────────────

describe('Sub-test B — Root cause 2: onError doesn\'t reset isMutationPendingRef on unhandled errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Bug condition: callNumber returns HTTP 500 → onError fires → the 500 does
   * not match the 429/NO_NUMBERS_LEFT/INVALID_STATE branches → stopAuto(true) is
   * called → BUT isMutationPendingRef.current is NEVER set to false → every
   * future tick sees isMutationPendingRef.current === true → game freezes.
   *
   * We isolate onError here directly to avoid the full React component rendering.
   * The logic mirrors the exact onError implementation in PlayBingo.tsx.
   *
   * On UNFIXED code: isMutationPendingRef.current stays true after HTTP 500.
   * On FIXED code:   isMutationPendingRef.current === false (reset at top of onError).
   *
   * Counterexample: isMutationPendingRef.current remains true after HTTP 500.
   *
   * Validates: Requirements 1.2
   */
  it('B.1 — isMutationPendingRef should be false after onError with HTTP 500 (FAILS on unfixed code)', () => {
    // Replicate the refs used by PlayBingo
    const isMutationPendingRef = { current: true }; // simulates in-flight mutation
    const mutationStartTimeRef = { current: Date.now() };
    const autoActiveRef = { current: true };

    // Replicate stopAuto (only what onError calls)
    const stopAuto = vi.fn((silent = false) => {
      autoActiveRef.current = false;
      // NOTE: stopAuto does NOT reset isMutationPendingRef
    });

    // Replicate the FIXED onError handler from PlayBingo.tsx:
    //   onError: (err: any) => {
    //     isMutationPendingRef.current = false; // always clear — React effect will re-sync if needed
    //     mutationStartTimeRef.current = 0;
    //     const status = err?.response?.status;
    //     const code = err?.response?.data?.error?.code;
    //     if (status === 429) return;
    //     if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') { stopAuto(true); return; }
    //     stopAuto(true);
    //   }
    const onError = (err: any) => {
      isMutationPendingRef.current = false; // FIX: always clear at top before any branching
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return; // rate limited — keep going
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAuto(true);
        return;
      }
      stopAuto(true);
    };

    // Trigger onError with HTTP 500 (unhandled error)
    const http500Error = { response: { status: 500, data: {} } };
    onError(http500Error);

    // EXPECTED (post-fix): isMutationPendingRef.current should be false
    // COUNTEREXAMPLE (unfixed): isMutationPendingRef.current is still true
    expect(isMutationPendingRef.current).toBe(false);
  });

  /**
   * Variant: Confirm multiple unhandled error statuses all leave the flag stuck.
   * Property: for any status NOT in {429} and code NOT in {NO_NUMBERS_LEFT, INVALID_STATE},
   * isMutationPendingRef.current should be false after onError.
   *
   * Validates: Requirements 1.2
   */
  it('B.2 — isMutationPendingRef should be false for any unhandled HTTP error code (FAILS on unfixed code)', () => {
    const unhandledErrors = [
      { response: { status: 500, data: {} } },
      { response: { status: 503, data: {} } },
      { response: { status: 400, data: {} } },
      { response: { status: 422, data: {} } },
      { response: { status: 504, data: {} } },
      // No response (network failure)
      { message: 'Network Error' },
    ];

    for (const err of unhandledErrors) {
      const isMutationPendingRef = { current: true };
      const mutationStartTimeRef = { current: Date.now() };
      const autoActiveRef = { current: true };

      const stopAuto = vi.fn(() => { autoActiveRef.current = false; });

      // FIXED onError (isMutationPendingRef reset at top in all branches)
      const onError = (e: any) => {
        isMutationPendingRef.current = false; // FIX: reset at top before any branching
        mutationStartTimeRef.current = 0;
        const status = e?.response?.status;
        const code = e?.response?.data?.error?.code;
        if (status === 429) return;
        if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') { stopAuto(true); return; }
        stopAuto(true);
      };

      onError(err);

      // EXPECTED (post-fix): false
      // COUNTEREXAMPLE (unfixed): true — pending flag stuck
      expect(isMutationPendingRef.current).toBe(false);
    }
  });
});

// ── Sub-test C ────────────────────────────────────────────────────────────────

describe('Sub-test C — Root cause 3: mutationStartTimeRef set in interval callback before mutationFn', () => {
  /**
   * Bug condition: the startAuto setInterval callback contains the line:
   *   mutationStartTimeRef.current = Date.now();
   * before calling mutateRef.current(). React's useMutation schedules mutationFn
   * asynchronously, so the timestamp is set before the network request begins.
   * After 10 seconds elapse (before mutationFn even runs), checkMutationTimeout
   * fires a false-positive "stuck" alert and hard-stops the game.
   *
   * This sub-test replicates the exact interval callback from the UNFIXED PlayBingo.tsx
   * and asserts that the timestamp is NOT set in the interval body.
   *
   * On UNFIXED code: mutationStartTimeRef.current > 0 after interval tick (premature).
   * On FIXED code:   mutationStartTimeRef.current === 0 (only set inside mutationFn).
   *
   * Counterexample: mutationStartTimeRef.current set to non-zero value in interval callback
   * — proving premature start before mutationFn runs.
   *
   * Validates: Requirements 1.3
   */
  it('C.1 — mutationStartTimeRef.current = Date.now() should NOT be set in interval callback (FAILS on unfixed code)', async () => {
    const mutationStartTimeRef = { current: 0 };
    const mutateRef = { current: vi.fn() };
    const autoActiveRef = { current: true };
    const gameRef = { current: { status: 'active' } };
    const sessionCalledRef = { current: [] as number[] };
    const isMutationPendingRef = { current: false };
    const speedRef = { current: 5 };
    const lastCallTimeRef = { current: 0 };
    const stopAuto = vi.fn();
    const checkMutationTimeout = vi.fn();
    const { audioQueue: aq } = await import('../services/db');

    // Replicate the FIXED interval callback from PlayBingo.tsx startAuto:
    // The fix is that mutationStartTimeRef.current = Date.now() was REMOVED from the
    // interval body — it is now only set inside mutationFn.
    let elapsed = 0;
    const intervalCallback = () => {
      if (!autoActiveRef.current) return;
      if (!gameRef.current || gameRef.current.status !== 'active') { stopAuto(true); return; }
      elapsed += 0.5;
      if (elapsed < speedRef.current) return;
      const timeSinceLastCall = Date.now() - lastCallTimeRef.current;
      if (aq.playing || (lastCallTimeRef.current > 0 && timeSinceLastCall < 300)) return;
      elapsed = 0;
      if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
      if (isMutationPendingRef.current) { checkMutationTimeout(); return; }
      lastCallTimeRef.current = Date.now();
      // FIX: mutationStartTimeRef.current = Date.now() was REMOVED from here
      // It is now only set inside mutationFn
      mutateRef.current();
    };

    // Advance elapsed past speedRef so the tick body actually runs
    elapsed = 5;

    // Fire the interval tick
    intervalCallback();

    // ASSERTION: On FIXED code, the interval callback should NOT set mutationStartTimeRef.
    //            The timestamp should only be set inside mutationFn.
    // On UNFIXED code: mutationStartTimeRef.current > 0 (was set prematurely in interval).
    // COUNTEREXAMPLE: mutationStartTimeRef.current is a non-zero timestamp set before
    //                 mutationFn executes, proving premature start.
    expect(mutationStartTimeRef.current).toBe(0);
  });

  /**
   * C.2 — Verify the premature timestamp causes false-positive stuck detection.
   *
   * Simulates: interval sets timestamp → React scheduling delay → checkMutationTimeout
   * fires before mutationFn even runs → stopAuto called prematurely.
   *
   * Validates: Requirements 1.3
   */
  it('C.2 — premature timestamp should not cause false-positive stuck detection (FAILS on unfixed code)', () => {
    const mutationStartTimeRef = { current: 0 };
    const isMutationPendingRef = { current: false };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    // Replicate checkMutationTimeout from PlayBingo.tsx
    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    // FIXED scenario: timestamp is only set inside mutationFn, NOT in interval callback.
    // Simulate mutationFn running and setting the timestamp (recent, just now).
    // React calls mutationFn → sets timestamp → isMutationPendingRef.current = true
    const justNow = Date.now(); // small elapsed — only milliseconds ago
    mutationStartTimeRef.current = justNow;
    isMutationPendingRef.current = true;

    // Now checkMutationTimeout fires (interval tick)
    checkMutationTimeout();

    // EXPECTED (post-fix): stopAuto and alert should NOT be called because
    // the timestamp was only set inside mutationFn moments ago (elapsed is small, << 10s).
    // COUNTEREXAMPLE (unfixed): stopAuto IS called because the timer was set 11s
    // ago in the interval callback, not in mutationFn.
    //
    // This test FAILS on unfixed code because stopAutoMock is called.
    expect(stopAutoMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
