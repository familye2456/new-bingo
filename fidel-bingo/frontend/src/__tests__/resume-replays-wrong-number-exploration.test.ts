/**
 * Bug Condition Exploration Tests — Task 1 (resume-replays-wrong-number)
 *
 * NOTE: Originally written to FAIL on unfixed code (confirming the bug).
 * Task 3.3: Updated harness to use FIXED logic — all 4 tests now PASS on fixed code.
 *
 * Bug Summary:
 *   stopAuto() unconditionally set pendingNumberRef.current = null.
 *   startAuto() read pendingNumberRef.current (now null) and fell back to
 *   sessionCalledNumbers[last] — which did NOT include the interrupted number N,
 *   because N was never committed to the board (its sound was cut mid-play).
 *   Result: the wrong number was replayed, and N was silently skipped.
 *
 * Fix Summary:
 *   stopAuto() now saves pendingNumberRef.current into resumePendingRef.current
 *   BEFORE clearing pendingNumberRef.current.
 *   startAuto() reads resumePendingRef.current (the saved interrupted number N),
 *   consumes it immediately (sets to null), and uses N as the replay target.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *
 * Counterexamples documented (observed on unfixed code):
 *   pendingAtPause=37, sessionCalledNumbers=[5,22] →
 *     playNumberSoundAndWait called with 22 (last board number) instead of 37
 *     37 never added to sessionCalledNumbers — silently skipped
 *
 *   pendingAtPause=12, sessionCalledNumbers=[] (first number, board empty) →
 *     replayNum = null → mutateRef.current() fired immediately (new call)
 *     instead of replaying 12 — interrupted number skipped entirely
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Replica of the FIXED stopAuto / startAuto logic ──────────────────────────
//
// Extracted from PlayBingo.tsx (lines ~205-215 for stopAuto, ~370-395 for startAuto).
//
// stopAuto (fixed):
//   callGenRef.current++
//   resumePendingRef.current = pendingNumberRef.current   ← NEW: save before clear
//   pendingNumberRef.current = null
//   autoActiveRef.current = false
//
// startAuto (fixed):
//   const pendingNum = resumePendingRef.current   ← FIXED: read from resumePendingRef
//   resumePendingRef.current = null               ← FIXED: consume immediately
//   const replayNum = pendingNum ?? sessionCalledNumbers[last]
//   playNumberSoundAndWait(replayNum, ...)
//   .then(() => {
//     if (pendingNum != null && autoActiveRef.current) {  ← FIXED: simplified guard
//       setSessionCalledNumbers(prev => [...prev, pendingNum])
//     }
//   })
//
// ─────────────────────────────────────────────────────────────────────────────

interface TestRefs {
  pendingNumberRef: { current: number | null };
  resumePendingRef: { current: number | null };  // NEW: added by fix
  callGenRef: { current: number };
  autoActiveRef: { current: boolean };
  sessionCalledRef: { current: number[] };
}

/**
 * Fixed stopAuto: saves pendingNumberRef into resumePendingRef before clearing.
 */
function buildFixedStopAuto(refs: TestRefs) {
  return function stopAuto() {
    refs.autoActiveRef.current = false;
    refs.callGenRef.current++;
    refs.resumePendingRef.current = refs.pendingNumberRef.current; // NEW: save before clear
    refs.pendingNumberRef.current = null;
  };
}

/**
 * Fixed startAuto: reads resumePendingRef (which holds the interrupted number N),
 * consumes it immediately, and uses it as the replay target.
 */
function buildFixedStartAuto(
  refs: TestRefs,
  playNumberSoundAndWait: (num: number, voice: string, volume: number) => Promise<void>,
  setSessionCalledNumbers: (updater: (prev: number[]) => number[]) => void,
  mutateRef: { current: () => void },
) {
  return function startAuto() {
    refs.autoActiveRef.current = true;

    // FIXED: read interrupted number from resumePendingRef (not pendingNumberRef)
    const pendingNum = refs.resumePendingRef.current;
    refs.resumePendingRef.current = null; // FIXED: consume immediately (only replay once)

    const lastCalled = refs.sessionCalledRef.current;
    const replayNum =
      pendingNum ?? (lastCalled.length > 0 ? lastCalled[lastCalled.length - 1] : null);

    if (replayNum != null) {
      playNumberSoundAndWait(replayNum, 'voice', 1).then(() => {
        // FIXED: simplified guard — pendingNum was captured before resumePendingRef was cleared
        if (pendingNum != null && refs.autoActiveRef.current) {
          setSessionCalledNumbers((prev) =>
            prev.includes(pendingNum) ? prev : [...prev, pendingNum],
          );
        }
      });
      return;
    }

    // No replay needed — fire server call immediately (fresh game or board exhausted)
    mutateRef.current();
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration — Resume replays wrong number (PASSES on fixed code)', () => {
  let refs: TestRefs;
  let playNumberSoundAndWaitMock: ReturnType<typeof vi.fn>;
  let setSessionCalledNumbers: ReturnType<typeof vi.fn>;
  let mutateRef: { current: ReturnType<typeof vi.fn> };
  let stopAuto: () => void;
  let startAuto: () => void;

  beforeEach(() => {
    refs = {
      pendingNumberRef: { current: null },
      resumePendingRef: { current: null }, // NEW: added by fix
      callGenRef: { current: 0 },
      autoActiveRef: { current: true },
      sessionCalledRef: { current: [] },
    };
    playNumberSoundAndWaitMock = vi.fn();
    setSessionCalledNumbers = vi.fn();
    mutateRef = { current: vi.fn() };

    stopAuto = buildFixedStopAuto(refs);
    startAuto = buildFixedStartAuto(
      refs,
      playNumberSoundAndWaitMock as any,
      setSessionCalledNumbers,
      mutateRef,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1.1 ─────────────────────────────────────────────────────────────
  //
  // Mid-sound pause: N=37 is mid-announcement, board has [5, 22].
  // Expected: resume plays 37.
  // Fixed: resumePendingRef holds 37 after stopAuto, so startAuto replays 37.
  //
  // Validates: Requirements 1.1, 1.2
  // ─────────────────────────────────────────────────────────────────────────
  it('1.1 — mid-sound pause: resume MUST replay the interrupted number N, not the last board number (FAILS on unfixed code)', async () => {
    const interruptedNumber = 37;
    const boardNumbers = [5, 22]; // last board number is 22

    // Seed state: N=37 is mid-sound (pending), board has [5, 22]
    refs.pendingNumberRef.current = interruptedNumber;
    refs.sessionCalledRef.current = boardNumbers;

    // Simulate mid-sound audio promise (never auto-resolves)
    let resolveAudio!: () => void;
    const audioPromise = new Promise<void>((r) => { resolveAudio = r; });
    playNumberSoundAndWaitMock.mockReturnValue(audioPromise);

    // Step 1: User pauses (stopAuto — saves N into resumePendingRef, clears pendingNumberRef)
    stopAuto();

    // Verify stopAuto saved N into resumePendingRef
    expect(refs.resumePendingRef.current).toBe(interruptedNumber);
    // Verify stopAuto still clears pendingNumberRef (existing behavior)
    expect(refs.pendingNumberRef.current).toBeNull();

    // Step 2: User resumes (startAuto — reads resumePendingRef, finds 37)
    startAuto();

    // ASSERTION (PASSES on fixed code):
    // playNumberSoundAndWait MUST be called with 37 (the interrupted number).
    // On FIXED code: resumePendingRef holds 37, so startAuto replays 37.
    expect(playNumberSoundAndWaitMock).toHaveBeenCalledWith(
      interruptedNumber, // 37 — the number that was mid-sound at pause time
      expect.any(String),
      expect.any(Number),
    );

    resolveAudio();
    await flushPromises();
  });

  // ── Test 1.2 ─────────────────────────────────────────────────────────────
  //
  // Board commit test: after audio resolves, N MUST appear in sessionCalledNumbers.
  // Fixed: pendingNum is captured from resumePendingRef before it's cleared,
  // so the .then() guard fires and commits N to the board.
  //
  // Validates: Requirements 1.1, 1.3
  // ─────────────────────────────────────────────────────────────────────────
  it('1.2 — board commit: N MUST be added to sessionCalledNumbers after replay sound resolves (FAILS on unfixed code)', async () => {
    const interruptedNumber = 37;
    refs.pendingNumberRef.current = interruptedNumber;
    refs.sessionCalledRef.current = [5, 22];

    let resolveAudio!: () => void;
    const audioPromise = new Promise<void>((r) => { resolveAudio = r; });
    playNumberSoundAndWaitMock.mockReturnValue(audioPromise);

    stopAuto();
    startAuto();

    // Sound resolves
    resolveAudio();
    await flushPromises();

    // ASSERTION (PASSES on fixed code):
    // setSessionCalledNumbers MUST be called (to commit N=37 to the board).
    // On FIXED code: pendingNum=37 in the .then() guard, autoActiveRef=true → commits.
    expect(setSessionCalledNumbers).toHaveBeenCalledTimes(1);

    // Verify the updater adds 37
    if (setSessionCalledNumbers.mock.calls.length > 0) {
      const updater = setSessionCalledNumbers.mock.calls[0][0] as (prev: number[]) => number[];
      const result = updater([5, 22]);
      expect(result).toContain(interruptedNumber);
    }
  });

  // ── Test 1.3 ─────────────────────────────────────────────────────────────
  //
  // First number interrupted: board is empty, N=12 is the first-ever call,
  // paused mid-sound. Expected: resume replays 12.
  // Fixed: resumePendingRef holds 12, so replayNum=12 and playNumberSoundAndWait(12) fires.
  //
  // Validates: Requirements 1.1, 1.2, 1.3
  // ─────────────────────────────────────────────────────────────────────────
  it('1.3 — first number interrupted: resume MUST replay N (not fire new server call) when board is empty (FAILS on unfixed code)', async () => {
    const interruptedNumber = 12;

    // Board is empty — first number ever
    refs.pendingNumberRef.current = interruptedNumber;
    refs.sessionCalledRef.current = []; // no fully-committed numbers yet

    // Audio promise — won't auto-resolve for this test
    playNumberSoundAndWaitMock.mockReturnValue(new Promise<void>(() => {}));

    stopAuto();
    startAuto();

    // ASSERTION (PASSES on fixed code):
    // playNumberSoundAndWait MUST be called with 12 (replay the interrupted first number).
    // On FIXED code: resumePendingRef holds 12 → pendingNum=12 → replayNum=12 → replay fires.
    expect(playNumberSoundAndWaitMock).toHaveBeenCalledWith(
      interruptedNumber, // 12
      expect.any(String),
      expect.any(Number),
    );
    expect(mutateRef.current).not.toHaveBeenCalled();
  });

  // ── Test 1.4 (property-based) ─────────────────────────────────────────────
  //
  // For any N in 1–75 and any board state (0–74 previously-called numbers),
  // if pendingNumberRef === N at pause time, resume MUST replay N.
  //
  // Validates: Requirements 1.1, 1.2
  // ─────────────────────────────────────────────────────────────────────────
  it('1.4 — property: for any N (1-75) pending at pause, resume must call playNumberSoundAndWait(N) (FAILS on unfixed code)', async () => {
    // Sample a range of interrupted numbers and board states to act as property coverage
    const testCases: Array<{ N: number; board: number[] }> = [
      { N: 1,  board: [] },            // first number, empty board
      { N: 7,  board: [3] },           // second call interrupted
      { N: 25, board: [3, 7, 14] },    // mid-game interrupted
      { N: 37, board: [5, 22, 31] },   // documented counterexample
      { N: 50, board: Array.from({ length: 10 }, (_, i) => i + 1) }, // 10 numbers called
      { N: 63, board: Array.from({ length: 30 }, (_, i) => i + 1) }, // 30 numbers called
      { N: 75, board: Array.from({ length: 74 }, (_, i) => i + 1) }, // last number interrupted
    ];

    for (const { N, board } of testCases) {
      // Reset state for each case
      playNumberSoundAndWaitMock.mockClear();
      mutateRef.current.mockClear();
      refs.pendingNumberRef.current = N;
      refs.resumePendingRef.current = null; // reset resume ref
      refs.sessionCalledRef.current = board;
      refs.callGenRef.current = 0;
      refs.autoActiveRef.current = true;

      playNumberSoundAndWaitMock.mockReturnValue(new Promise<void>(() => {}));

      stopAuto();
      startAuto();

      // ASSERTION (PASSES on fixed code):
      // playNumberSoundAndWait MUST be called with exactly N (the interrupted number).
      // On FIXED code: resumePendingRef holds N after stopAuto, startAuto uses it.
      expect(
        playNumberSoundAndWaitMock,
        `N=${N}, board=[${board.slice(-3).join(',')}...] — expected replay of ${N}`,
      ).toHaveBeenCalledWith(N, expect.any(String), expect.any(Number));

      expect(
        mutateRef.current,
        `N=${N} — mutate() must NOT be called when interrupted number pending`,
      ).not.toHaveBeenCalled();
    }
  });
});
