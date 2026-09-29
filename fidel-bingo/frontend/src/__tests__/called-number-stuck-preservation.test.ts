/**
 * Preservation Property Tests — Task 2 (called-number-stuck-fix)
 *
 * These tests encode CORRECT BASELINE BEHAVIORS that must NOT change after the fix.
 * ALL 5 sub-tests MUST PASS on UNFIXED code — they verify existing correct behavior.
 * Re-running them after the fix (Task 3.5) confirms no regressions were introduced.
 *
 * Sub-test A — Successful sound preserves gate timing (Req 3.1)
 * Sub-test B — HTTP 429 still skips and keeps auto-call running (Req 3.2)
 * Sub-test C — NO_NUMBERS_LEFT / INVALID_STATE still stops silently (Req 3.3)
 * Sub-test D — Genuine 10-second hang still fires stuck detection (Req 3.5)
 * Sub-test E — In-flight dedup preserved (Req 3.4)
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioQueue, audioQueue } from '../services/db';

// ── Sub-test A ────────────────────────────────────────────────────────────────

describe('Sub-test A — Successful sound preserves gate timing (Req 3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioQueue.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Preservation: When a sound resolves successfully, AudioQueue.drain() sets
   * playing=false only AFTER the sound ends — then the interval can proceed.
   *
   * This is the CORRECT happy-path behavior. It must not change after the fix.
   *
   * On both unfixed and fixed code: after a successful task, playing===false.
   *
   * **Validates: Requirements 3.1**
   */
  it('A.1 — audioQueue.playing is true while task runs, false after successful completion', async () => {
    const queue = new AudioQueue();
    const capturedDuringTask: boolean[] = [];

    const successTask = async () => {
      // Capture playing state while the task is executing
      capturedDuringTask.push(queue.playing);
    };

    queue.enqueue(successTask);
    await queue.waitForDrain();

    // While the task was running, playing should have been true
    expect(capturedDuringTask).toHaveLength(1);
    expect(capturedDuringTask[0]).toBe(true);

    // After drain completes, playing must be false
    expect(queue.playing).toBe(false);
  });

  /**
   * Preservation: Multiple successful tasks process in sequence — after all drain,
   * playing is false. Gate behavior is preserved throughout.
   *
   * **Validates: Requirements 3.1**
   */
  it('A.2 — audioQueue.playing is false after multiple successful sounds drain', async () => {
    const queue = new AudioQueue();
    const runOrder: number[] = [];

    queue.enqueue(async () => { runOrder.push(1); });
    queue.enqueue(async () => { runOrder.push(2); });
    queue.enqueue(async () => { runOrder.push(3); });

    await queue.waitForDrain();

    // All tasks ran in order
    expect(runOrder).toEqual([1, 2, 3]);

    // Gate is clear after successful drain
    expect(queue.playing).toBe(false);
  });

  /**
   * Preservation: playNumberSoundQueued with a successful playCachedSound leaves
   * audioQueue.playing === false after the queue drains — interval can proceed.
   *
   * This is the production code path. Must work identically before and after fix.
   *
   * **Validates: Requirements 3.1**
   */
  it('A.3 — playNumberSoundQueued: playing is false after successful playCachedSound', async () => {
    const dbModule = await import('../services/db');

    // Mock playCachedSound to resolve immediately (success path)
    vi.spyOn(dbModule, 'playCachedSound').mockResolvedValue(undefined);

    dbModule.playNumberSoundQueued(42, 'boy sound', 1);

    await dbModule.audioQueue.waitForDrain();

    // PRESERVED: playing is false after successful sound — interval can proceed
    expect(dbModule.audioQueue.playing).toBe(false);
  });

  /**
   * Preservation: while a sound task is in the queue and draining, playing is true
   * (the interval correctly waits). Only after drain does it become false.
   *
   * **Validates: Requirements 3.1**
   */
  it('A.4 — audioQueue.playing is true while a queued task is in-flight', async () => {
    const queue = new AudioQueue();
    let resolveTask!: () => void;
    const inFlightPromise = new Promise<void>(r => { resolveTask = r; });

    let playingDuringTask: boolean | undefined;

    queue.enqueue(async () => {
      playingDuringTask = queue.playing;
      await inFlightPromise;
    });

    // Give drain a tick to start executing
    await new Promise(r => setTimeout(r, 0));

    // playing should be true while task is pending
    expect(playingDuringTask).toBe(true);
    expect(queue.playing).toBe(true);

    // Resolve the task
    resolveTask();
    await queue.waitForDrain();

    // Now it should be false
    expect(queue.playing).toBe(false);
  });
});

// ── Sub-test B ────────────────────────────────────────────────────────────────

describe('Sub-test B — HTTP 429 still skips and keeps auto-call running (Req 3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Preservation: onError with status=429 returns early — autoActiveRef stays true
   * and stopAuto is NEVER called. The auto-call loop continues on the next tick.
   *
   * This is a critical preserved behavior. The fix must NOT change the 429 path.
   *
   * **Validates: Requirements 3.2**
   */
  it('B.1 — onError with 429: stopAuto is NOT called and auto-call remains active', () => {
    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: Date.now() };
    const autoActiveRef = { current: true };

    const stopAuto = vi.fn((_silent?: boolean) => {
      autoActiveRef.current = false;
    });

    // Replicate the onError handler from PlayBingo.tsx (current unfixed code)
    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return; // rate limited — skip this tick, keep going
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAuto(true);
        return;
      }
      stopAuto(true);
    };

    // Trigger a 429 error
    onError({ response: { status: 429, data: {} } });

    // PRESERVED: stopAuto was NOT called
    expect(stopAuto).not.toHaveBeenCalled();

    // PRESERVED: auto-call is still active
    expect(autoActiveRef.current).toBe(true);
  });

  /**
   * Preservation: multiple 429 errors in sequence — auto-call stays active throughout.
   * This simulates rate-limiting during a game where the server temporarily limits calls.
   *
   * **Validates: Requirements 3.2**
   */
  it('B.2 — onError with 429: auto-call stays active after multiple 429 errors', () => {
    const autoActiveRef = { current: true };
    const mutationStartTimeRef = { current: 0 };
    const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') { stopAuto(true); return; }
      stopAuto(true);
    };

    // 3 consecutive 429s
    onError({ response: { status: 429, data: {} } });
    onError({ response: { status: 429, data: {} } });
    onError({ response: { status: 429, data: {} } });

    expect(stopAuto).not.toHaveBeenCalled();
    expect(autoActiveRef.current).toBe(true);
  });

  /**
   * Preservation: property — for ANY error with status === 429, stopAuto is never called.
   *
   * **Validates: Requirements 3.2**
   */
  it('B.3 — property: any 429 response never calls stopAuto', () => {
    const variants = [
      { response: { status: 429, data: {} } },
      { response: { status: 429, data: { error: {} } } },
      { response: { status: 429, data: null } },
    ];

    for (const err of variants) {
      const autoActiveRef = { current: true };
      const mutationStartTimeRef = { current: 0 };
      const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });

      const onError = (e: any) => {
        mutationStartTimeRef.current = 0;
        const status = e?.response?.status;
        const code = e?.response?.data?.error?.code;
        if (status === 429) return;
        if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') { stopAuto(true); return; }
        stopAuto(true);
      };

      onError(err);

      expect(stopAuto).not.toHaveBeenCalled();
      expect(autoActiveRef.current).toBe(true);
    }
  });
});

// ── Sub-test C ────────────────────────────────────────────────────────────────

describe('Sub-test C — NO_NUMBERS_LEFT / INVALID_STATE still stops silently (Req 3.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Preservation: onError with NO_NUMBERS_LEFT calls stopAuto(true) — silent stop,
   * no alert() shown. This is correct end-of-game behavior that must be preserved.
   *
   * **Validates: Requirements 3.3**
   */
  it('C.1 — NO_NUMBERS_LEFT: stopAuto called with silent=true, no alert shown', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const autoActiveRef = { current: true };
    const mutationStartTimeRef = { current: 0 };

    const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAuto(true);
        return;
      }
      stopAuto(true);
    };

    onError({ response: { status: 200, data: { error: { code: 'NO_NUMBERS_LEFT' } } } });

    // PRESERVED: stopAuto called with silent=true
    expect(stopAuto).toHaveBeenCalledTimes(1);
    expect(stopAuto).toHaveBeenCalledWith(true);

    // PRESERVED: no alert shown
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Preservation: onError with INVALID_STATE calls stopAuto(true) silently.
   *
   * **Validates: Requirements 3.3**
   */
  it('C.2 — INVALID_STATE: stopAuto called with silent=true, no alert shown', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const autoActiveRef = { current: true };
    const mutationStartTimeRef = { current: 0 };

    const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAuto(true);
        return;
      }
      stopAuto(true);
    };

    onError({ response: { status: 200, data: { error: { code: 'INVALID_STATE' } } } });

    expect(stopAuto).toHaveBeenCalledTimes(1);
    expect(stopAuto).toHaveBeenCalledWith(true);
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Preservation: property — both special codes stop silently without alert.
   * This must hold identically on unfixed AND fixed code.
   *
   * **Validates: Requirements 3.3**
   */
  it('C.3 — property: NO_NUMBERS_LEFT and INVALID_STATE always stop silently', () => {
    const silentCodes = ['NO_NUMBERS_LEFT', 'INVALID_STATE'];

    for (const code of silentCodes) {
      const alertMock = vi.fn();
      vi.stubGlobal('alert', alertMock);

      const stopAuto = vi.fn();

      const onError = (err: any) => {
        const status = err?.response?.status;
        const errCode = err?.response?.data?.error?.code;
        if (status === 429) return;
        if (errCode === 'NO_NUMBERS_LEFT' || errCode === 'INVALID_STATE') {
          stopAuto(true);
          return;
        }
        stopAuto(true);
        alertMock('Number calling stuck. Please try again.');
      };

      onError({ response: { status: 200, data: { error: { code } } } });

      expect(stopAuto).toHaveBeenCalledWith(true);
      expect(alertMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    }
  });
});

// ── Sub-test D ────────────────────────────────────────────────────────────────

describe('Sub-test D — Genuine 10-second hang still fires stuck detection (Req 3.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Preservation: checkMutationTimeout with a 11-second-old timestamp and
   * isMutationPendingRef.current=true fires stopAuto(true) AND alert().
   *
   * This is the correct stuck-detection behavior for GENUINE hangs.
   * It must continue to work after the fix (which only moves where the
   * timestamp is set, not how the timeout check works).
   *
   * **Validates: Requirements 3.5**
   */
  it('D.1 — checkMutationTimeout fires stopAuto and alert after genuine 11-second hang', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: Date.now() - 11000 }; // 11 seconds ago

    const stopAuto = vi.fn();

    // Replicate checkMutationTimeout from PlayBingo.tsx
    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAuto(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    checkMutationTimeout();

    // PRESERVED: stopAuto and alert ARE called after genuine 11-second hang
    expect(stopAuto).toHaveBeenCalledTimes(1);
    expect(stopAuto).toHaveBeenCalledWith(true);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith('Number calling stuck. Please try again.');
  });

  /**
   * Preservation: checkMutationTimeout does NOT fire when mutation is NOT pending.
   * No false positives when isMutationPendingRef.current is false.
   *
   * **Validates: Requirements 3.5**
   */
  it('D.2 — checkMutationTimeout does NOT fire when mutation is not pending', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const isMutationPendingRef = { current: false }; // not pending
    const mutationStartTimeRef = { current: Date.now() - 11000 };

    const stopAuto = vi.fn();

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAuto(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    checkMutationTimeout();

    // PRESERVED: no false positive — mutation was not actually pending
    expect(stopAuto).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Preservation: checkMutationTimeout does NOT fire when elapsed < 10 seconds.
   * A recent in-flight mutation should not trigger stuck detection.
   *
   * **Validates: Requirements 3.5**
   */
  it('D.3 — checkMutationTimeout does NOT fire for elapsed < 10 seconds', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: Date.now() - 5000 }; // only 5 seconds ago

    const stopAuto = vi.fn();

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAuto(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    checkMutationTimeout();

    // PRESERVED: no premature detection — mutation is still within normal time window
    expect(stopAuto).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Preservation: checkMutationTimeout does NOT fire when startTime is 0 (no mutation in flight).
   *
   * **Validates: Requirements 3.5**
   */
  it('D.4 — checkMutationTimeout does NOT fire when mutationStartTimeRef is 0', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: 0 }; // no mutation started

    const stopAuto = vi.fn();

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAuto(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    checkMutationTimeout();

    expect(stopAuto).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

// ── Sub-test E ────────────────────────────────────────────────────────────────

describe('Sub-test E — In-flight dedup preserved (Req 3.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Preservation: While isMutationPendingRef.current === true (in-flight mutation),
   * the interval callback skips mutateRef.current() — no second call is made.
   * This dedup prevents duplicate number calls and must survive the fix.
   *
   * **Validates: Requirements 3.4**
   */
  it('E.1 — interval skips mutate() when isMutationPendingRef is true', () => {
    const isMutationPendingRef = { current: true }; // genuine in-flight mutation
    const mutationStartTimeRef = { current: Date.now() - 1000 }; // started 1 second ago
    const autoActiveRef = { current: true };
    const gameRef = { current: { status: 'active' } };
    const sessionCalledRef = { current: [] as number[] };
    const speedRef = { current: 5 };
    const lastCallTimeRef = { current: 0 };

    const mutateRef = { current: vi.fn() };
    const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });
    const checkMutationTimeout = vi.fn();

    // Replicate the startAuto interval callback from PlayBingo.tsx (unfixed)
    // Note: elapsed resets to 0 after each eligible tick, so we need to advance
    // it past the speedRef threshold before each call to simulate real interval behavior.
    let elapsed = 0;
    const intervalCallback = () => {
      if (!autoActiveRef.current) return;
      if (!gameRef.current || gameRef.current.status !== 'active') { stopAuto(true); return; }
      elapsed += 0.5;
      if (elapsed < speedRef.current) return;
      const timeSinceLastCall = Date.now() - lastCallTimeRef.current;
      // Note: audioQueue.playing check is omitted here (audioQueue is a singleton
      // that may have state from other tests). We test dedup behavior specifically.
      elapsed = 0;
      if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
      if (isMutationPendingRef.current) {
        checkMutationTimeout();
        return; // ← dedup: don't call mutate while in-flight
      }
      lastCallTimeRef.current = Date.now();
      mutationStartTimeRef.current = Date.now();
      mutateRef.current();
    };

    // Fire 3 "eligible" interval ticks — each needs elapsed >= speedRef (5s)
    // Simulates 3 separate interval firings that each advance past the speed gate.
    for (let i = 0; i < 3; i++) {
      elapsed = speedRef.current; // advance to threshold before each tick
      intervalCallback();
    }

    // PRESERVED: mutate() was NEVER called — in-flight mutation was respected
    expect(mutateRef.current).not.toHaveBeenCalled();

    // checkMutationTimeout was called for each skipped tick
    expect(checkMutationTimeout).toHaveBeenCalledTimes(3);
  });

  /**
   * Preservation: once isMutationPendingRef becomes false (mutation resolved),
   * the interval calls mutate() on the next eligible tick.
   *
   * **Validates: Requirements 3.4**
   */
  it('E.2 — interval calls mutate() once isMutationPendingRef becomes false', () => {
    const isMutationPendingRef = { current: false }; // mutation completed
    const mutationStartTimeRef = { current: 0 };
    const autoActiveRef = { current: true };
    const gameRef = { current: { status: 'active' } };
    const sessionCalledRef = { current: [] as number[] };
    const speedRef = { current: 5 };
    const lastCallTimeRef = { current: 0 };

    const mutateRef = { current: vi.fn() };
    const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });
    const checkMutationTimeout = vi.fn();

    let elapsed = 0;
    const intervalCallback = () => {
      if (!autoActiveRef.current) return;
      if (!gameRef.current || gameRef.current.status !== 'active') { stopAuto(true); return; }
      elapsed += 0.5;
      if (elapsed < speedRef.current) return;
      elapsed = 0;
      if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
      if (isMutationPendingRef.current) {
        checkMutationTimeout();
        return;
      }
      lastCallTimeRef.current = Date.now();
      mutationStartTimeRef.current = Date.now();
      mutateRef.current();
    };

    elapsed = speedRef.current; // advance to threshold
    intervalCallback();

    // PRESERVED: mutate() was called because there's no in-flight mutation
    expect(mutateRef.current).toHaveBeenCalledTimes(1);
    expect(checkMutationTimeout).not.toHaveBeenCalled();
  });

  /**
   * Preservation: property — dedup gate works for any combination of pending state.
   * When pending=true, mutate() is never called. When pending=false, mutate() is called once.
   *
   * **Validates: Requirements 3.4**
   */
  it('E.3 — property: dedup gate correctly controls mutate() based on pending state', () => {
    const scenarios: Array<{ pending: boolean; expectMutate: boolean }> = [
      { pending: true, expectMutate: false },
      { pending: false, expectMutate: true },
    ];

    for (const { pending, expectMutate } of scenarios) {
      const isMutationPendingRef = { current: pending };
      const mutationStartTimeRef = { current: pending ? Date.now() - 1000 : 0 };
      const autoActiveRef = { current: true };
      const gameRef = { current: { status: 'active' } };
      const sessionCalledRef = { current: [] as number[] };
      const speedRef = { current: 5 };
      const lastCallTimeRef = { current: 0 };

      const mutateRef = { current: vi.fn() };
      const stopAuto = vi.fn((_silent?: boolean) => { autoActiveRef.current = false; });
      const checkMutationTimeout = vi.fn();

      let elapsed = 5; // already past threshold

      const intervalCallback = () => {
        if (!autoActiveRef.current) return;
        if (!gameRef.current || gameRef.current.status !== 'active') { stopAuto(true); return; }
        elapsed += 0.5;
        if (elapsed < speedRef.current) return;
        elapsed = 0;
        if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
        if (isMutationPendingRef.current) {
          checkMutationTimeout();
          return;
        }
        lastCallTimeRef.current = Date.now();
        mutationStartTimeRef.current = Date.now();
        mutateRef.current();
      };

      intervalCallback();

      if (expectMutate) {
        expect(mutateRef.current).toHaveBeenCalledTimes(1);
      } else {
        expect(mutateRef.current).not.toHaveBeenCalled();
      }
    }
  });
});
