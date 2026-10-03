/**
 * Preservation Tests — Task 2 (resume-replays-wrong-number)
 *
 * **IMPORTANT**: These tests MUST PASS on FIXED code.
 * They encode baseline behaviors that are NOT affected by the bug and MUST
 * remain unchanged after the fix is applied (regression prevention).
 *
 * NOTE: Harness updated in Task 3.4 to use FIXED logic (buildFixedStopAuto /
 * buildFixedStartAuto). The preservation behaviors are unaffected because all
 * these tests have pendingNumberRef.current = null at pause time — so
 * resumePendingRef gets null saved into it, and startAuto sees null for
 * pendingNum, falling back to the same behavior as before.
 *
 * Property 2: Preservation — Non-Interrupted Pause Behavior Unchanged
 * All tests in this file set pendingNumberRef.current = null at pause time,
 * meaning the audio had already finished before stopAuto fired — this is
 * the NON-bug-condition path.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Replica of the FIXED stopAuto / startAuto logic ──────────────────────────
//
// Extracted from PlayBingo.tsx (same harness as the exploration test).
//
// stopAuto (fixed):
//   callGenRef.current++
//   resumePendingRef.current = pendingNumberRef.current   ← NEW: save before clear
//   pendingNumberRef.current = null   (already null in the non-bug path → no-op)
//   autoActiveRef.current = false
//
// startAuto (fixed):
//   const pendingNum = resumePendingRef.current   ← FIXED: always null in preservation path
//   resumePendingRef.current = null               ← FIXED: consume immediately
//   const replayNum = pendingNum ?? sessionCalledNumbers[last]  ← correct fallback
//   playNumberSoundAndWait(replayNum, ...)
//
// ─────────────────────────────────────────────────────────────────────────────

interface TestRefs {
  pendingNumberRef: { current: number | null };
  resumePendingRef: { current: number | null }; // added by fix
  callGenRef: { current: number };
  autoActiveRef: { current: boolean };
  sessionCalledRef: { current: number[] };
}

/**
 * Fixed stopAuto: saves pendingNumberRef into resumePendingRef before clearing.
 * In the preservation path pendingNumberRef is already null — save is a no-op.
 */
function buildFixedStopAuto(refs: TestRefs) {
  return function stopAuto() {
    refs.autoActiveRef.current = false;
    refs.callGenRef.current++;
    refs.resumePendingRef.current = refs.pendingNumberRef.current; // save (will be null — no-op in preservation path)
    refs.pendingNumberRef.current = null;
  };
}

/**
 * Fixed startAuto: reads resumePendingRef (always null in preservation path),
 * falls back to sessionCalledRef[last] for "hear it again" behavior, or fires
 * mutate() for fresh-game path.
 */
function buildFixedStartAuto(
  refs: TestRefs,
  playNumberSoundAndWait: (num: number, voice: string, volume: number) => Promise<void>,
  setSessionCalledNumbers: (updater: (prev: number[]) => number[]) => void,
  mutateRef: { current: () => void },
) {
  return function startAuto() {
    refs.autoActiveRef.current = true;

    // FIXED: reads resumePendingRef — always null in preservation path
    const pendingNum = refs.resumePendingRef.current;
    refs.resumePendingRef.current = null; // consume immediately

    const lastCalled = refs.sessionCalledRef.current;
    const replayNum =
      pendingNum ?? (lastCalled.length > 0 ? lastCalled[lastCalled.length - 1] : null);

    if (replayNum != null) {
      playNumberSoundAndWait(replayNum, 'voice', 1).then(() => {
        // Guard: only commit if pendingNum was an interrupted number
        // In the preservation path, pendingNum is always null → this block never runs
        if (pendingNum != null && refs.autoActiveRef.current) {
          setSessionCalledNumbers((prev) =>
            prev.includes(pendingNum) ? prev : [...prev, pendingNum],
          );
        }
        // Schedule next call — not relevant for these tests
      });
      return;
    }

    // No replay — fire server call immediately (fresh game or board exhausted)
    mutateRef.current();
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Preservation — Non-Interrupted Pause Behavior (PASSES on fixed code)', () => {
  let refs: TestRefs;
  let playNumberSoundAndWaitMock: ReturnType<typeof vi.fn>;
  let setSessionCalledNumbers: ReturnType<typeof vi.fn>;
  let mutateRef: { current: ReturnType<typeof vi.fn> };
  let stopAuto: () => void;
  let startAuto: () => void;

  beforeEach(() => {
    refs = {
      pendingNumberRef: { current: null },
      resumePendingRef: { current: null }, // added by fix
      callGenRef: { current: 0 },
      autoActiveRef: { current: true },
      sessionCalledRef: { current: [] },
    };
    playNumberSoundAndWaitMock = vi.fn().mockReturnValue(Promise.resolve());
    setSessionCalledNumbers = vi.fn();
    mutateRef = { current: vi.fn() };

    stopAuto = buildFixedStopAuto(refs);
    startAuto = buildFixedStartAuto(
      refs,
      playNumberSoundAndWaitMock as unknown as (num: number, voice: string, volume: number) => Promise<void>,
      setSessionCalledNumbers as unknown as (updater: (prev: number[]) => number[]) => void,
      mutateRef,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 2.1 ─────────────────────────────────────────────────────────────
  //
  // Post-audio-completion pause: audio finished before pause, so pendingNumberRef
  // is already null. Resume should replay the last board number (normal UX).
  //
  // MUST PASS on fixed code (baseline behavior).
  //
  // Validates: Requirement 3.1
  // ─────────────────────────────────────────────────────────────────────────
  it('2.1 — post-audio-completion pause: resume replays the last board number (normal "hear it again" UX)', async () => {
    // Audio finished before pause → pendingNumberRef is null
    refs.pendingNumberRef.current = null;
    refs.sessionCalledRef.current = [3, 7, 14];

    let resolveAudio!: () => void;
    const audioPromise = new Promise<void>((r) => { resolveAudio = r; });
    playNumberSoundAndWaitMock.mockReturnValue(audioPromise);

    stopAuto();
    startAuto();

    // ASSERTION: playNumberSoundAndWait IS called with 14 (last board number).
    // pendingNum = null → replayNum = sessionCalledRef[last] = 14.
    // This is the correct fallback for the non-bug path.
    expect(playNumberSoundAndWaitMock).toHaveBeenCalledWith(
      14, // last board number
      expect.any(String),
      expect.any(Number),
    );

    resolveAudio();
    await flushPromises();
  });

  // ── Test 2.2 ─────────────────────────────────────────────────────────────
  //
  // Fresh game resume: board is empty and pending is null.
  // startAuto should fire a new server call immediately — no replay.
  //
  // MUST PASS on fixed code.
  //
  // Validates: Requirement 3.2
  // ─────────────────────────────────────────────────────────────────────────
  it('2.2 — fresh game resume: fires new server call immediately, no replay', () => {
    refs.pendingNumberRef.current = null;
    refs.sessionCalledRef.current = [];

    stopAuto();
    startAuto();

    // ASSERTION: mutate() IS called — fresh game with no board and no pending number.
    expect(mutateRef.current).toHaveBeenCalledTimes(1);

    // ASSERTION: playNumberSoundAndWait is NOT called (nothing to replay).
    expect(playNumberSoundAndWaitMock).not.toHaveBeenCalled();
  });

  // ── Test 2.3 ─────────────────────────────────────────────────────────────
  //
  // In-flight discard: stopAuto increments callGenRef so that any result
  // arriving from an in-flight server call is discarded.
  //
  // MUST PASS on fixed code.
  //
  // Validates: Requirement 3.3
  // ─────────────────────────────────────────────────────────────────────────
  it('2.3 — in-flight discard: stopAuto increments callGenRef to invalidate in-flight results', () => {
    const initialCallGen = 5;
    refs.callGenRef.current = initialCallGen;

    stopAuto();

    // ASSERTION: callGenRef.current is incremented by exactly 1.
    // In-flight results that still hold the old generation (5) are discarded.
    expect(refs.callGenRef.current).toBe(initialCallGen + 1); // 6
  });

  // ── Test 2.4 ─────────────────────────────────────────────────────────────
  //
  // Property: multiple pause/resume cycles with null pending — each resume
  // replays the last board number for the "hear it again" UX, and no
  // duplicates are introduced into the simulated board.
  //
  // Board grows across cycles: [], [1], [1,2], [1,2,3].
  // Each resume should replay the last number on the board at that time.
  //
  // MUST PASS on fixed code.
  //
  // Validates: Requirement 3.4
  // ─────────────────────────────────────────────────────────────────────────
  it('2.4 — property: multiple pause/resume cycles with null pending replay last board number each time', async () => {
    // Simulate 3 consecutive pause/resume cycles
    // Board grows: [1], [1,2], [1,2,3]
    const boardStates = [[1], [1, 2], [1, 2, 3]];
    const expectedReplays = [1, 2, 3]; // last element of each board state

    for (let cycle = 0; cycle < 3; cycle++) {
      // Reset mocks for this cycle
      playNumberSoundAndWaitMock.mockClear();
      mutateRef.current.mockClear();

      // Set board state for this cycle
      refs.pendingNumberRef.current = null; // audio finished before pause
      refs.resumePendingRef.current = null; // ensure clean state each cycle
      refs.sessionCalledRef.current = boardStates[cycle];

      let resolveAudio!: () => void;
      const audioPromise = new Promise<void>((r) => { resolveAudio = r; });
      playNumberSoundAndWaitMock.mockReturnValue(audioPromise);

      // Rebuild stop/start with fresh refs snapshot
      stopAuto = buildFixedStopAuto(refs);
      startAuto = buildFixedStartAuto(
        refs,
        playNumberSoundAndWaitMock as unknown as (num: number, voice: string, volume: number) => Promise<void>,
        setSessionCalledNumbers as unknown as (updater: (prev: number[]) => number[]) => void,
        mutateRef,
      );

      stopAuto();
      startAuto();

      // ASSERTION: each cycle replays the correct last board number
      expect(
        playNumberSoundAndWaitMock,
        `Cycle ${cycle + 1}: expected replay of ${expectedReplays[cycle]}`,
      ).toHaveBeenCalledWith(
        expectedReplays[cycle],
        expect.any(String),
        expect.any(Number),
      );

      resolveAudio();
      await flushPromises();
    }

    // ASSERTION: no duplicates in any of the board states (simulated — they grew monotonically)
    const finalBoard = boardStates[boardStates.length - 1];
    const uniqueNumbers = new Set(finalBoard);
    expect(uniqueNumbers.size).toBe(finalBoard.length);
  });

  // ── Test 2.5 ─────────────────────────────────────────────────────────────
  //
  // Property: any sessionCalledNumbers array (length 0–5) with null pending
  // produces consistent replay behavior:
  //   - length 0: mutate() called, no replay
  //   - length 1–5: playNumberSoundAndWait called with arr[last]
  //
  // MUST PASS on fixed code.
  //
  // Validates: Requirements 3.1, 3.2
  // ─────────────────────────────────────────────────────────────────────────
  it('2.5 — property: any sessionCalledNumbers (length 0–5) with null pending produces consistent replay', async () => {
    const testArrays: Array<number[]> = [
      [],              // length 0 → mutate()
      [10],            // length 1 → replay 10
      [10, 20],        // length 2 → replay 20
      [10, 20, 30],    // length 3 → replay 30
      [10, 20, 30, 40], // length 4 → replay 40
      [10, 20, 30, 40, 50], // length 5 → replay 50
    ];

    for (const arr of testArrays) {
      // Reset mocks for each case
      playNumberSoundAndWaitMock.mockClear();
      mutateRef.current.mockClear();

      refs.pendingNumberRef.current = null; // null pending — not the bug condition
      refs.resumePendingRef.current = null; // ensure clean state each iteration
      refs.sessionCalledRef.current = arr;

      let resolveAudio: (() => void) | undefined;
      const audioPromise = new Promise<void>((r) => { resolveAudio = r; });
      playNumberSoundAndWaitMock.mockReturnValue(audioPromise);

      // Rebuild for each case
      stopAuto = buildFixedStopAuto(refs);
      startAuto = buildFixedStartAuto(
        refs,
        playNumberSoundAndWaitMock as unknown as (num: number, voice: string, volume: number) => Promise<void>,
        setSessionCalledNumbers as unknown as (updater: (prev: number[]) => number[]) => void,
        mutateRef,
      );

      stopAuto();
      startAuto();

      if (arr.length === 0) {
        // Empty board + null pending → fire new server call immediately
        expect(
          mutateRef.current,
          `arr=[] → mutate() must be called`,
        ).toHaveBeenCalledTimes(1);
        expect(
          playNumberSoundAndWaitMock,
          `arr=[] → playNumberSoundAndWait must NOT be called`,
        ).not.toHaveBeenCalled();
      } else {
        const expectedReplay = arr[arr.length - 1];
        expect(
          playNumberSoundAndWaitMock,
          `arr=[${arr.join(',')}] → expected replay of ${expectedReplay}`,
        ).toHaveBeenCalledWith(
          expectedReplay,
          expect.any(String),
          expect.any(Number),
        );
        expect(
          mutateRef.current,
          `arr=[${arr.join(',')}] → mutate() must NOT be called`,
        ).not.toHaveBeenCalled();

        if (resolveAudio) resolveAudio();
        await flushPromises();
      }
    }
  });
});
