# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** — Resume Replays Interrupted Number
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `startAuto` replays `sessionCalledNumbers[last]` instead of the interrupted number N
  - Create a test harness that exposes the `stopAuto` / `startAuto` logic from `PlayBingo.tsx` for unit testing
  - Seed `pendingNumberRef.current = N` for any N in 1–75 (simulating a mid-sound pause)
  - Call `stopAuto` (simulated pause), then call `startAuto` (simulated resume)
  - Assert `playNumberSoundAndWait` is called with N
  - Assert that after the mocked sound promise resolves, `sessionCalledNumbers` includes N
  - Run on UNFIXED code — expect the assertion to FAIL (wrong number or N missing from board)
  - Document counterexample: e.g. `pendingAtPause=37` → `playNumberSoundAndWait` called with 22 (last board number) instead
  - Mark task complete when test is written, run, and counterexample is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Non-Interrupted Pause Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe unfixed code behavior first
  - Observe: when `pendingNumberRef.current === null` at pause time (audio finished before pause), `startAuto` falls back to `sessionCalledNumbers[last]` for the normal replay — this is correct behavior to preserve
  - Write property-based test: for any `sessionCalledNumbers` array (length 0–74) with `pendingNumberRef === null`, the fixed `startAuto` produces the same replay target as the original
  - Write edge-case test: fresh game (empty `sessionCalledNumbers`, null pending) — `startAuto` fires a new server call immediately with no replay
  - Write property: in-flight discard — `callGenRef` increment in `stopAuto` still causes in-flight server results to be ignored on resume
  - Write property: multiple pause/resume cycles with null pending — no duplicates or gaps in `sessionCalledNumbers` after all cycles
  - Verify all these tests PASS on UNFIXED code (confirms baseline behaviors to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix resume-replays-wrong-number

  - [x] 3.1 Add `resumePendingRef` and update `stopAuto` in `PlayBingo.tsx`
    - Declare `const resumePendingRef = useRef<number | null>(null)` alongside `pendingNumberRef`
    - In `stopAuto`, add `resumePendingRef.current = pendingNumberRef.current` immediately before the existing `pendingNumberRef.current = null` line
    - In `hardStopAuto`, add `resumePendingRef.current = null` (hard stop discards everything)
    - Do NOT change any other logic in `stopAuto` or `hardStopAuto`
    - _Requirements: 2.1_

  - [x] 3.2 Update `startAuto` to use `resumePendingRef`
    - Replace `const pendingNum = pendingNumberRef.current` with `const pendingNum = resumePendingRef.current`
    - Add `resumePendingRef.current = null` immediately after reading it (consume: only replay once per pause)
    - Update the post-replay board-commit guard: replace the `pendingNumberRef.current === pendingNum` check with a direct check that `pendingNum != null` (since `resumePendingRef` is already cleared, the guard simplifies to whether there was an interrupted number)
    - All other `startAuto` logic (replayNum fallback, `playNumberSoundAndWait`, `scheduleNextRef` call) remains unchanged
    - _Requirements: 2.2, 2.3_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** — Resume Replays Interrupted Number
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - Run bug condition exploration test from step 1 on FIXED code
    - **EXPECTED OUTCOME**: Test PASSES (`playNumberSoundAndWait` called with N, N appears on board)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** — Non-Interrupted Pause Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation tests from step 2 on FIXED code
    - **EXPECTED OUTCOME**: All tests PASS (non-interrupted resume, fresh game, in-flight discard, multiple cycles all unchanged)
    - Confirm no regressions across all preservation scenarios

- [x] 4. Checkpoint — Ensure all tests pass
  - Run all tests in the project to confirm no regressions
  - Verify the bug condition exploration test passes (interrupted number replayed and committed)
  - Verify preservation tests pass (null-pending, fresh-game, in-flight-discard, multi-cycle paths unchanged)
  - Ask the user if any questions arise
