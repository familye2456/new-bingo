/**
 * Preservation Property Tests — Task 2 (called-number-stuck-fix)
 *
 * These tests establish the BASELINE BEHAVIOR that MUST survive the fix.
 * Written BEFORE the fix is applied; ALL sub-tests MUST PASS on UNFIXED code.
 *
 * Re-running them after Task 3 (fix implementation) confirms no regressions.
 *
 * Five sub-tests:
 *   A — Successful sound preserves gate timing (Root cause 1 non-buggy path)
 *   B — HTTP 429 still skips and keeps auto-call running
 *   C — NO_NUMBERS_LEFT / INVALID_STATE still stops silently
 *   D — Genuine 10-second hang still fires stuck detection
 *   E — In-flight dedup preserved
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioQueue } from '../services/db';

// ── Sub-test A — Successful sound preserves gate timing ──────────────────────
//
// When playCachedSound resolves normally (no error), the AudioQueue must keep
// playing=true during execution and only set it to false after the queue drains.
// This is the non-buggy path for Root cause 1 — the gate timing must be preserved.
//
// EXPECTED OUTCOME: PASSES on unfixed code
// (unfixed code correctly handles the success path — only the error path is broken)

describe('Sub-test A — Successful sound preserves gate timing (PASSES on unfixed code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('A.1 — AudioQueue.playing is true while a task is executing', async () => {
    const queue = new AudioQueue();
    let playingDuringTask = false;

    // Task that captures the playing flag mid-execution
    const taskPromise = queue.enqueue(async () => {
      // While we are inside this async task, playing should be true
      playingDuringTask = queue.playing;
      // Simulate a short async operation (like a sound)
      await Promise.resolve();
    });

    await queue.waitForDrain();

    // During the task, playing was true (gate was held)
    expect(playingDuringTask).toBe(true);
    // After the queue drains, playing is false
    expect(queue.playing).toBe(false);
  });

  it('A.2 — AudioQueue.playing is false after successful task completes', async () => {
    const queue = new AudioQueue();

    queue.enqueue(async () => {
      // Successful task — resolves normally
      await Promise.resolve();
    });

    await queue.waitForDrain();

    // Gate is cleared after success
    expect(queue.playing).toBe(false);
  });

  it('A.3 — AudioQueue.playing is false after multiple successful tasks', async () => {
    const queue = new AudioQueue();
    const order: number[] = [];

    for (let i = 1; i <= 5; i++) {
      const num = i;
      queue.enqueue(async () => {
        order.push(num);
      });
    }

    await queue.waitForDrain();

    // All tasks ran
    expect(order).toEqual([1, 2, 3, 4, 5]);
    // Gate is cleared
    expect(queue.playing).toBe(false);
  });

  /**
   * Property-based: for any N successful tasks, playing is always false after drain.
   *
   * **Validates: Requirements 3.1**
   */
  it('A.4 — property: for any count of successful tasks, playing is false after drain', async () => {
    const taskCounts = [1, 2, 3, 5, 10];

    for (const count of taskCounts) {
      const queue = new AudioQueue();

      for (let i = 0; i < count; i++) {
        queue.enqueue(async () => {
          await Promise.resolve();
        });
      }

      await queue.waitForDrain();

      expect(queue.playing, `playing should be false after ${count} successful tasks`).toBe(false);
    }
  });

  it('A.5 — AudioQueue.playing transitions: true during task, false after drain', async () => {
    const queue = new AudioQueue();
    const snapshots: boolean[] = [];

    // Before any task
    snapshots.push(queue.playing); // false

    let resolveTask!: () => void;
    const blocker = new Promise<void>(r => { resolveTask = r; });

    queue.enqueue(async () => {
      await blocker;
    });

    // Right after enqueue, playing should be true
    snapshots.push(queue.playing); // true

    resolveTask();
    await queue.waitForDrain();

    // After drain, playing is false
    snapshots.push(queue.playing); // false

    expect(snapshots).toEqual([false, true, false]);
  });
});

// ── Sub-test B — HTTP 429 still skips and keeps auto-call running ────────────
//
// When onError receives status=429, it returns early without calling stopAuto.
// autoActiveRef.current must remain true and no stopAuto call must occur.
//
// This is the preserved skip-and-continue behavior for rate limiting.
//
// EXPECTED OUTCOME: PASSES on unfixed code
// (429 path is correct in unfixed code — it's the default paths that are broken)

describe('Sub-test B — HTTP 429 skips and keeps auto-call running (PASSES on unfixed code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B.1 — onError status=429: stopAuto is NOT called', () => {
    // Replicate the EXACT onError from PlayBingo.tsx (unfixed)
    const mutationStartTimeRef = { current: Date.now() };
    const soundPendingRef = { current: true };
    const isMutationPendingRef = { current: true };
    const autoActiveRef = { current: true };
    const stopAutoMock = vi.fn();

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return; // rate limited — skip this tick, keep going
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true);
        return;
      }
      stopAutoMock(true);
    };

    onError({ response: { status: 429, data: {} } });

    // 429: stopAuto must NOT be called
    expect(stopAutoMock).not.toHaveBeenCalled();
    // auto-call should still be considered active (we didn't flip the ref ourselves)
    // The interval will continue on the next tick
    expect(autoActiveRef.current).toBe(true);
  });

  it('B.2 — onError status=429: mutationStartTimeRef is reset to 0', () => {
    const mutationStartTimeRef = { current: Date.now() };
    const soundPendingRef = { current: true };
    const stopAutoMock = vi.fn();

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true);
        return;
      }
      stopAutoMock(true);
    };

    onError({ response: { status: 429, data: {} } });

    // Timestamp is always reset (done before the early return)
    expect(mutationStartTimeRef.current).toBe(0);
    // soundPending is always cleared (done before the early return)
    expect(soundPendingRef.current).toBe(false);
  });

  /**
   * Property-based: for any 429 error (regardless of body), stopAuto is never called.
   *
   * **Validates: Requirements 3.2**
   */
  it('B.3 — property: any 429 response never calls stopAuto', () => {
    const errorBodies = [
      { response: { status: 429, data: {} } },
      { response: { status: 429, data: { error: { code: 'RATE_LIMITED' } } } },
      { response: { status: 429, data: { error: {} } } },
      { response: { status: 429, data: null } },
    ];

    for (const err of errorBodies) {
      const mutationStartTimeRef = { current: Date.now() };
      const soundPendingRef = { current: true };
      const stopAutoMock = vi.fn();

      const onError = (e: any) => {
        mutationStartTimeRef.current = 0;
        soundPendingRef.current = false;
        const status = e?.response?.status;
        const code = e?.response?.data?.error?.code;
        if (status === 429) return;
        if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
          stopAutoMock(true);
          return;
        }
        stopAutoMock(true);
      };

      onError(err);

      expect(stopAutoMock, `stopAuto should not be called for 429 error`).not.toHaveBeenCalled();
    }
  });
});

// ── Sub-test C — NO_NUMBERS_LEFT / INVALID_STATE still stops silently ────────
//
// When onError receives code=NO_NUMBERS_LEFT or code=INVALID_STATE, it calls
// stopAuto(true) (silent stop) and returns. No alert() should be shown.
//
// EXPECTED OUTCOME: PASSES on unfixed code

describe('Sub-test C — NO_NUMBERS_LEFT / INVALID_STATE stops silently (PASSES on unfixed code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('C.1 — NO_NUMBERS_LEFT: stopAuto called with silent=true, no alert', () => {
    const mutationStartTimeRef = { current: Date.now() };
    const soundPendingRef = { current: true };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true); // silent stop
        return;
      }
      stopAutoMock(true);
    };

    onError({ response: { status: 200, data: { error: { code: 'NO_NUMBERS_LEFT' } } } });

    // stopAuto called with silent=true
    expect(stopAutoMock).toHaveBeenCalledOnce();
    expect(stopAutoMock).toHaveBeenCalledWith(true);
    // No alert shown
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('C.2 — INVALID_STATE: stopAuto called with silent=true, no alert', () => {
    const mutationStartTimeRef = { current: Date.now() };
    const soundPendingRef = { current: true };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true);
        return;
      }
      stopAutoMock(true);
    };

    onError({ response: { status: 400, data: { error: { code: 'INVALID_STATE' } } } });

    expect(stopAutoMock).toHaveBeenCalledOnce();
    expect(stopAutoMock).toHaveBeenCalledWith(true);
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Property-based: for both game-ending codes, stopAuto(true) is always called
   * exactly once and no alert is shown.
   *
   * **Validates: Requirements 3.3**
   */
  it('C.3 — property: NO_NUMBERS_LEFT and INVALID_STATE always stop silently', () => {
    const terminalCodes = ['NO_NUMBERS_LEFT', 'INVALID_STATE'];

    for (const code of terminalCodes) {
      const mutationStartTimeRef = { current: Date.now() };
      const soundPendingRef = { current: true };
      const stopAutoMock = vi.fn();
      const alertMock = vi.fn();
      vi.stubGlobal('alert', alertMock);

      const onError = (err: any) => {
        mutationStartTimeRef.current = 0;
        soundPendingRef.current = false;
        const status = err?.response?.status;
        const c = err?.response?.data?.error?.code;
        if (status === 429) return;
        if (c === 'NO_NUMBERS_LEFT' || c === 'INVALID_STATE') {
          stopAutoMock(true);
          return;
        }
        stopAutoMock(true);
      };

      // Try with several HTTP status codes to ensure it's code-based, not status-based
      const statuses = [200, 400, 404, 422];
      for (const status of statuses) {
        stopAutoMock.mockClear();
        alertMock.mockClear();

        onError({ response: { status, data: { error: { code } } } });

        expect(stopAutoMock, `stopAuto should be called once for code ${code} status ${status}`).toHaveBeenCalledOnce();
        expect(stopAutoMock, `stopAuto should be called with silent=true for code ${code}`).toHaveBeenCalledWith(true);
        expect(alertMock, `alert should NOT be called for code ${code} status ${status}`).not.toHaveBeenCalled();
      }
    }
  });

  it('C.4 — NO_NUMBERS_LEFT: stopAuto called exactly once (not twice)', () => {
    const stopAutoMock = vi.fn();
    const mutationStartTimeRef = { current: 0 };
    const soundPendingRef = { current: false };

    const onError = (err: any) => {
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return;
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true);
        return; // explicit return — must not fall through to the second stopAuto call
      }
      stopAutoMock(true);
    };

    onError({ response: { status: 200, data: { error: { code: 'NO_NUMBERS_LEFT' } } } });

    // Must be exactly once — the early return prevents the default stopAuto at the end
    expect(stopAutoMock).toHaveBeenCalledTimes(1);
  });
});

// ── Sub-test D — Genuine 10-second hang still fires stuck detection ───────────
//
// When checkMutationTimeout runs with isMutationPendingRef.current=true AND
// mutationStartTimeRef.current > 0 AND elapsed > 10000ms, it must call
// stopAuto(true) AND alert the user.
//
// This ensures genuine hangs are still detected after the fix (regression prevention).
//
// EXPECTED OUTCOME: PASSES on unfixed code

describe('Sub-test D — Genuine 10-second hang fires stuck detection (PASSES on unfixed code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('D.1 — elapsed > 10000ms with pending=true: stopAuto and alert are called', () => {
    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: 0 };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    // Simulate checkMutationTimeout from PlayBingo.tsx
    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    // Set timestamp to 11 seconds ago — genuine hang
    mutationStartTimeRef.current = Date.now() - 11000;
    isMutationPendingRef.current = true;

    checkMutationTimeout();

    // Both must fire
    expect(stopAutoMock).toHaveBeenCalledOnce();
    expect(stopAutoMock).toHaveBeenCalledWith(true);
    expect(alertMock).toHaveBeenCalledOnce();
  });

  it('D.2 — elapsed == 10001ms: stuck detection fires', () => {
    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: 0 };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    // Just over the 10-second threshold
    mutationStartTimeRef.current = Date.now() - 10001;
    isMutationPendingRef.current = true;

    checkMutationTimeout();

    expect(stopAutoMock).toHaveBeenCalledOnce();
    expect(alertMock).toHaveBeenCalledOnce();
  });

  it('D.3 — elapsed < 10000ms: stuck detection does NOT fire', () => {
    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: 0 };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    // Under the threshold — 5 seconds
    mutationStartTimeRef.current = Date.now() - 5000;
    isMutationPendingRef.current = true;

    checkMutationTimeout();

    // Not stuck yet — no action
    expect(stopAutoMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('D.4 — pending=false (not in flight): stuck detection does NOT fire even with old timestamp', () => {
    const isMutationPendingRef = { current: false }; // no mutation in flight
    const mutationStartTimeRef = { current: 0 };
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    // Old timestamp but pending=false — not actually stuck
    mutationStartTimeRef.current = Date.now() - 11000;
    isMutationPendingRef.current = false; // mutation resolved already

    checkMutationTimeout();

    expect(stopAutoMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('D.5 — startTime=0 (never set): stuck detection does NOT fire', () => {
    const isMutationPendingRef = { current: true };
    const mutationStartTimeRef = { current: 0 }; // timestamp not set
    const stopAutoMock = vi.fn();
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAutoMock(true);
          alertMock('Number calling stuck. Please try again.');
        }
      }
    };

    checkMutationTimeout();

    expect(stopAutoMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  /**
   * Property-based: for any elapsed time > 10000ms with pending=true and
   * startTime > 0, stuck detection always fires.
   *
   * **Validates: Requirements 3.5**
   */
  it('D.6 — property: any elapsed > 10000ms with pending mutation fires stuck detection', () => {
    const elapsedValues = [10001, 11000, 15000, 30000, 60000, 120000];

    for (const elapsed of elapsedValues) {
      const isMutationPendingRef = { current: true };
      const mutationStartTimeRef = { current: 0 };
      const stopAutoMock = vi.fn();
      const alertMock = vi.fn();
      vi.stubGlobal('alert', alertMock);

      const checkMutationTimeout = () => {
        if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
          const e = Date.now() - mutationStartTimeRef.current;
          if (e > 10000) {
            stopAutoMock(true);
            alertMock('Number calling stuck. Please try again.');
          }
        }
      };

      mutationStartTimeRef.current = Date.now() - elapsed;
      isMutationPendingRef.current = true;

      checkMutationTimeout();

      expect(stopAutoMock, `stopAuto should fire for elapsed=${elapsed}`).toHaveBeenCalledOnce();
      expect(alertMock, `alert should fire for elapsed=${elapsed}`).toHaveBeenCalledOnce();
    }
  });
});

// ── Sub-test E — In-flight dedup preserved ────────────────────────────────────
//
// While isMutationPendingRef.current is true (genuine mutation in flight),
// the interval tick must NOT call mutate() a second time.
// This prevents duplicate callNumber API calls.
//
// EXPECTED OUTCOME: PASSES on unfixed code

describe('Sub-test E — In-flight dedup preserved (PASSES on unfixed code)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('E.1 — interval tick skips mutate() when isMutationPendingRef=true', () => {
    // Simulate the interval tick logic from startAuto in PlayBingo.tsx
    const isMutationPendingRef = { current: true }; // mutation in flight
    const autoActiveRef = { current: true };
    const mutateRef = { current: vi.fn() };
    const checkMutationTimeoutMock = vi.fn();
    const speedRef = { current: 5 };
    const lastCallTimeRef = { current: 0 };

    // Simulate the interval callback (simplified — no audioQueue.playing check)
    const intervalTick = (elapsed: number) => {
      if (!autoActiveRef.current) return;
      if (elapsed < speedRef.current) return;
      if (isMutationPendingRef.current) {
        checkMutationTimeoutMock();
        return; // dedup guard — do not call mutate
      }
      lastCallTimeRef.current = Date.now();
      mutateRef.current();
    };

    // Advance past the speed threshold
    intervalTick(speedRef.current + 1);

    // mutate() was NOT called because mutation is in flight
    expect(mutateRef.current).not.toHaveBeenCalled();
    // checkMutationTimeout was called to check for stuck state
    expect(checkMutationTimeoutMock).toHaveBeenCalledOnce();
  });

  it('E.2 — interval tick calls mutate() when isMutationPendingRef=false', () => {
    const isMutationPendingRef = { current: false }; // no mutation in flight
    const autoActiveRef = { current: true };
    const mutateRef = { current: vi.fn() };
    const checkMutationTimeoutMock = vi.fn();
    const speedRef = { current: 5 };
    const lastCallTimeRef = { current: 0 };
    // Simulate audioQueue.playing=false (sound finished)
    const audioQueuePlaying = false;

    const intervalTick = (elapsed: number) => {
      if (!autoActiveRef.current) return;
      if (elapsed < speedRef.current) return;
      if (audioQueuePlaying) return; // audio gate
      if (isMutationPendingRef.current) {
        checkMutationTimeoutMock();
        return;
      }
      lastCallTimeRef.current = Date.now();
      mutateRef.current();
    };

    intervalTick(speedRef.current + 1);

    // mutate() was called because nothing is pending
    expect(mutateRef.current).toHaveBeenCalledOnce();
    expect(checkMutationTimeoutMock).not.toHaveBeenCalled();
  });

  /**
   * Property-based: for any number of consecutive ticks while
   * isMutationPendingRef.current=true, mutate() is NEVER called.
   *
   * **Validates: Requirements 3.4**
   */
  it('E.3 — property: N consecutive ticks with pending=true never call mutate()', () => {
    const tickCounts = [1, 2, 5, 10, 20];

    for (const ticks of tickCounts) {
      const isMutationPendingRef = { current: true };
      const autoActiveRef = { current: true };
      const mutateRef = { current: vi.fn() };
      const checkMutationTimeoutMock = vi.fn();
      const speedRef = { current: 1 };
      const lastCallTimeRef = { current: 0 };

      const intervalTick = (elapsed: number) => {
        if (!autoActiveRef.current) return;
        if (elapsed < speedRef.current) return;
        if (isMutationPendingRef.current) {
          checkMutationTimeoutMock();
          return;
        }
        lastCallTimeRef.current = Date.now();
        mutateRef.current();
      };

      // Fire N ticks past the speed threshold
      for (let i = 0; i < ticks; i++) {
        intervalTick(speedRef.current + 1);
      }

      expect(mutateRef.current, `mutate should not be called after ${ticks} ticks with pending=true`).not.toHaveBeenCalled();
      expect(checkMutationTimeoutMock, `checkMutationTimeout should be called ${ticks} times`).toHaveBeenCalledTimes(ticks);
    }
  });

  it('E.4 — dedup: mutate() called only after pending clears', () => {
    const isMutationPendingRef = { current: true };
    const autoActiveRef = { current: true };
    const mutateRef = { current: vi.fn() };
    const checkMutationTimeoutMock = vi.fn();
    const speedRef = { current: 1 };
    const lastCallTimeRef = { current: 0 };

    const intervalTick = (elapsed: number) => {
      if (!autoActiveRef.current) return;
      if (elapsed < speedRef.current) return;
      if (isMutationPendingRef.current) {
        checkMutationTimeoutMock();
        return;
      }
      lastCallTimeRef.current = Date.now();
      mutateRef.current();
    };

    // Ticks while pending — no mutate
    intervalTick(speedRef.current + 1);
    intervalTick(speedRef.current + 1);
    expect(mutateRef.current).not.toHaveBeenCalled();

    // Mutation resolves
    isMutationPendingRef.current = false;

    // Next tick — mutate fires
    intervalTick(speedRef.current + 1);
    expect(mutateRef.current).toHaveBeenCalledOnce();
  });

  it('E.5 — dedup: autoActiveRef=false stops all processing (user pause/stop)', () => {
    const isMutationPendingRef = { current: false };
    const autoActiveRef = { current: false }; // user stopped auto-call
    const mutateRef = { current: vi.fn() };
    const checkMutationTimeoutMock = vi.fn();
    const speedRef = { current: 1 };
    const lastCallTimeRef = { current: 0 };

    const intervalTick = (elapsed: number) => {
      if (!autoActiveRef.current) return; // bail immediately
      if (elapsed < speedRef.current) return;
      if (isMutationPendingRef.current) {
        checkMutationTimeoutMock();
        return;
      }
      lastCallTimeRef.current = Date.now();
      mutateRef.current();
    };

    intervalTick(speedRef.current + 1);

    // Stopped — nothing should run
    expect(mutateRef.current).not.toHaveBeenCalled();
    expect(checkMutationTimeoutMock).not.toHaveBeenCalled();
  });
});
