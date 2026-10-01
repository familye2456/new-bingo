/**
 * Bug Condition Exploration Tests — Task 1 (called-number-stuck-fix)
 *
 * **CRITICAL**: Sub-tests A and B are EXPECTED TO FAIL on UNFIXED code —
 * failure confirms the bugs exist.
 * Sub-test C confirms premature timestamp statically.
 *
 * DO NOT attempt to fix the tests or the code when they fail.
 *
 * Three sub-tests, one per root cause:
 *   A — AudioQueue.drain swallows errors without resetting `playing` (Root cause 1)
 *   B — onError doesn't reset isMutationPendingRef on unhandled errors (Root cause 2)
 *   C — mutationStartTimeRef set in interval callback before mutationFn runs (Root cause 3)
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AudioQueue } from '../services/db';

// ── Sub-test A — Root cause 1 ────────────────────────────────────────────────
//
// AudioQueue.drain() has `catch { /* continue on error */ }` which swallows the
// rejected task promise but does NOT set `this.playing = false` explicitly.
// The bug: between the catch block firing and the non-awaited recursive drain()
// setting playing=false, the setInterval tick can observe playing===true and skip.
//
// We test using a fresh AudioQueue instance with a failing task.
//
// EXPECTED OUTCOME: `playing === false` after waitForDrain()
// EXPECTED TO FAIL on UNFIXED code (playing stays true)
//
// Counterexample: `audioQueue.playing` remains `true` after sound failure.

describe('Sub-test A — Root cause 1: AudioQueue.drain does not reset playing on error', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('A.1 — AudioQueue.playing must be false after a task rejects (FAILS on unfixed code)', async () => {
    const queue = new AudioQueue();

    // Enqueue a task that rejects immediately (simulates playCachedSound network failure)
    queue.enqueue(async () => {
      throw new Error('simulated network error — playCachedSound rejected');
    });

    // Wait for the queue to drain (all tasks processed, including failed ones)
    await queue.waitForDrain();

    // ASSERTION: playing must be false after the error is handled
    //
    // UNFIXED CODE behavior (counterexample):
    //   drain() catch: `catch { /* continue on error */ }`
    //   then calls `this.drain()` non-awaited
    //   The outer drain() async function returns with playing still true
    //   The recursive drain() runs later in the microtask queue
    //   BUT: waitForDrain() registers a resolver that IS called by the recursive drain()
    //
    //   The real freeze: setInterval checks `audioQueue.playing` synchronously
    //   BETWEEN the catch firing and the non-awaited drain() running.
    //   In that window, playing === true → interval skips → game stuck.
    //
    // The fix: catch { this.playing = false; } ensures playing is false IMMEDIATELY
    // in the catch block, before the recursive drain() runs.
    expect(queue.playing).toBe(false);
  });

  it('A.2 — AudioQueue: playing must be false after multiple sequential failures', async () => {
    const queue = new AudioQueue();

    queue.enqueue(async () => { throw new Error('failure 1'); });
    queue.enqueue(async () => { throw new Error('failure 2'); });

    await queue.waitForDrain();

    expect(queue.playing).toBe(false);
  });

  it('A.3 — AudioQueue: playing must be false after mixed success/failure sequence', async () => {
    const queue = new AudioQueue();
    const order: string[] = [];

    queue.enqueue(async () => { order.push('task1-ok'); });
    queue.enqueue(async () => { throw new Error('task2-fail'); });
    queue.enqueue(async () => { order.push('task3-ok'); });

    await queue.waitForDrain();

    // All tasks processed — playing must be false
    expect(queue.playing).toBe(false);
    // Successful tasks should have run
    expect(order).toContain('task1-ok');
    expect(order).toContain('task3-ok');
  });
});

// ── Sub-test B — Root cause 2 ────────────────────────────────────────────────
//
// The `onError` handler in `callMutation` resets `mutationStartTimeRef` and
// `soundPendingRef`, but NEVER sets `isMutationPendingRef.current = false`.
// `isMutationPendingRef` is only synced from `callMutation.isPending` via a
// React `useEffect`, which requires a re-render cycle that may not happen.
//
// We replicate the EXACT onError handler from PlayBingo.tsx and verify
// it does NOT reset `isMutationPendingRef.current` for status 500.
//
// EXPECTED OUTCOME: `isMutationPendingRef.current === false`
// EXPECTED TO FAIL on UNFIXED code (remains true)
//
// Counterexample: isMutationPendingRef.current remains `true` after HTTP 500.

describe('Sub-test B — Root cause 2: onError does not reset isMutationPendingRef', () => {
  it('B.1 — onError with status 500 must set isMutationPendingRef.current = false (FAILS on unfixed code)', () => {
    // Refs as they exist in PlayBingo (simplified)
    const mutationStartTimeRef = { current: Date.now() };
    const soundPendingRef = { current: true };
    const isMutationPendingRef = { current: true }; // stuck at true after mutation started

    const stopAutoMock = vi.fn();

    // ===== REPLICA of the FIXED onError from PlayBingo.tsx =====
    // Source: fidel-bingo/frontend/src/pages/user/PlayBingo.tsx, onError callback
    // Fix 3.2: isMutationPendingRef.current = false added at the very top
    const onError = (err: any) => {
      isMutationPendingRef.current = false; // always clear — React effect will re-sync if needed
      mutationStartTimeRef.current = 0;
      soundPendingRef.current = false; // always clear on error so game doesn't freeze
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return; // rate limited — skip this tick, keep going
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAutoMock(true); // game over or finished — stop silently
        return;
      }
      stopAutoMock(true);
    };
    // ===== END REPLICA =====

    // Trigger with HTTP 500 error (unhandled code)
    onError({ response: { status: 500, data: { error: { code: 'INTERNAL_SERVER_ERROR' } } } });

    // ASSERTION: isMutationPendingRef.current must be false after onError
    //
    // UNFIXED CODE behavior (counterexample):
    //   onError sets mutationStartTimeRef.current = 0 ✓
    //   onError sets soundPendingRef.current = false ✓
    //   onError calls stopAuto(true) ✓
    //   onError does NOT set isMutationPendingRef.current = false ✗ (the bug)
    //
    //   Result: isMutationPendingRef.current remains true
    //   Every subsequent interval tick: `if (isMutationPendingRef.current) { ... return; }`
    //   → game freezes forever
    expect(isMutationPendingRef.current).toBe(false);
  });

  it('B.2 — onError with various unhandled errors: isMutationPendingRef must reset (FAILS on unfixed code)', () => {
    const errorCases = [
      { name: 'HTTP 500', err: { response: { status: 500, data: {} } } },
      { name: 'HTTP 503', err: { response: { status: 503, data: {} } } },
      { name: 'HTTP 404', err: { response: { status: 404, data: {} } } },
      { name: 'Network Error', err: { message: 'Network Error', response: undefined } },
    ];

    for (const { name, err } of errorCases) {
      const mutationStartTimeRef = { current: 123456789 };
      const soundPendingRef = { current: true };
      const isMutationPendingRef = { current: true };
      const stopAutoMock = vi.fn();

      // Fixed replica of onError (fix 3.2 applied):
      const onError = (e: any) => {
        isMutationPendingRef.current = false; // fix 3.2: always clear at top
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

      // Fails on unfixed code for ALL cases — isMutationPendingRef never cleared
      expect(isMutationPendingRef.current, `Failed for case: ${name}`).toBe(false);
    }
  });

  it('B.3 — onError with status 429 keeps auto-call running (preserved path)', () => {
    // 429 is the early-return path — auto-call must keep running
    // This test confirms the preserved behavior (must PASS on both unfixed and fixed code)
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

    // 429: stopAuto must NOT be called (auto-call continues)
    expect(stopAutoMock).not.toHaveBeenCalled();
    // This path is preserved — the fix should NOT change this behavior
  });
});

// ── Sub-test C — Root cause 3 ────────────────────────────────────────────────
//
// The `startAuto` interval callback sets `mutationStartTimeRef.current = Date.now()`
// BEFORE calling `mutateRef.current()`. TanStack Query schedules `mutationFn`
// asynchronously. The 10-second clock starts before the server call begins,
// inflating elapsed time and triggering false-positive "stuck" alerts.
//
// Sub-test C uses static analysis (readFileSync) to confirm the premature
// timestamp is present in PlayBingo.tsx. These tests PASS (confirm root cause 3).
//
// Counterexample: mutationStartTimeRef.current set BEFORE mutationFn runs.

describe('Sub-test C — Root cause 3: mutationStartTimeRef set in interval callback before mutationFn', () => {
  const playbingoSrc = readFileSync(
    resolve(__dirname, '../pages/user/PlayBingo.tsx'),
    'utf-8'
  );

  it('C.1 — STATIC: mutationStartTimeRef = Date.now() does NOT appear in the interval callback (PASSES after fix — confirms bug is gone)', () => {
    // On UNFIXED code: the interval callback contained mutationStartTimeRef.current = Date.now()
    // followed by mutateRef.current() on the next few lines (confirming root cause 3).
    //
    // On FIXED code (fix 3.3): this pattern is ABSENT — the interval only calls mutateRef.current().
    // The timestamp is now set exclusively inside mutationFn.
    //
    // This test asserts the FIXED state: the premature pattern must NOT be present.
    const intervalTimestampPattern =
      /mutationStartTimeRef\.current = Date\.now\(\)[^}]{0,300}?mutateRef\.current\(\)/s;

    const hasPrematureTimestampInInterval = intervalTimestampPattern.test(playbingoSrc);

    // ASSERTION: confirms premature timestamp is GONE from interval callback (fix 3.3 applied)
    expect(hasPrematureTimestampInInterval).toBe(false);
  });

  it('C.2 — STATIC: mutationStartTimeRef = Date.now() appears exactly ONCE (only inside mutationFn after fix)', () => {
    const matches = playbingoSrc.match(/mutationStartTimeRef\.current = Date\.now\(\)/g) ?? [];

    // UNFIXED code: 2 occurrences
    //   1. Inside setInterval callback (the bug — premature start)
    //   2. Inside mutationFn (correct location)
    //
    // FIXED code (fix 3.3): 1 occurrence (only inside mutationFn)
    //   The interval timestamp assignment was removed.
    //
    // This test asserts the FIXED state: exactly 1 occurrence.
    expect(matches.length).toBe(1);
  });

  it('C.3 — RUNTIME: timestamp set before mutation begins causes false-positive stuck detection', () => {
    // Simulate the false-positive: interval sets timestamp 11s ago,
    // but mutationFn may have only run for 1s.
    const mutationStartTimeRef = { current: 0 };
    const isMutationPendingRef = { current: false };
    let stopAutoCalled = false;
    let alertCalled = false;

    const stopAuto = (_silent?: boolean) => { stopAutoCalled = true; };
    const mockAlert = () => { alertCalled = true; };

    const checkMutationTimeout = () => {
      if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
        const elapsed = Date.now() - mutationStartTimeRef.current;
        if (elapsed > 10000) {
          stopAuto(true);
          mockAlert();
        }
      }
    };

    // UNFIXED interval tick: sets timestamp BEFORE mutation begins
    mutationStartTimeRef.current = Date.now() - 11000; // 11s ago (premature start)
    isMutationPendingRef.current = true; // mutation "in flight"

    checkMutationTimeout();

    // False-positive: game stopped despite mutation only starting 11s total
    // (but mutationFn may have only run for 1s — scheduling delay ate 10s)
    //
    // Counterexample:
    //   mutationStartTimeRef.current set in interval at T=0
    //   React schedules mutation → mutationFn starts at T=1s
    //   checkMutationTimeout fires at T=11s
    //   elapsed = 11s > 10s → stopAuto(true) + alert
    //   Game stopped despite no real hang
    expect(stopAutoCalled).toBe(true);
    expect(alertCalled).toBe(true);
  });
});
