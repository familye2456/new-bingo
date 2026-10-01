# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Audio/Pending/Timestamp Gate Stuck
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: Tests encode expected post-fix behavior — they validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate all three root causes
  - **Scoped PBT Approach**: Scope each sub-test to the concrete failing case for reproducibility

  Sub-test A — Root cause 1 (AudioQueue.drain swallows errors without resetting playing):
  - Mock `playCachedSound` to reject with a network error
  - Call `playNumberSoundQueued(1, 'voice', 1)` (which enqueues via `audioQueue.enqueue`)
  - Wait for the queue to drain (use `audioQueue.waitForDrain()` or a short `setTimeout`)
  - Assert `audioQueue.playing === false` — on unfixed code this will be `true` (gate stuck)
  - Document counterexample: `audioQueue.playing` remains `true` after sound failure

  Sub-test B — Root cause 2 (onError doesn't reset isMutationPendingRef on unhandled errors):
  - Render `PlayBingo` with auto-call active (or isolate `onError` handler via unit test)
  - Mock `offlineGameApi.callNumber` to reject with `{ response: { status: 500 } }`
  - Trigger a call mutation and wait for `onError` to fire
  - Assert `isMutationPendingRef.current === false` — on unfixed code this will be `true` (pending stuck)
  - Document counterexample: `isMutationPendingRef.current` remains `true` after HTTP 500

  Sub-test C — Root cause 3 (mutationStartTimeRef set in interval callback before mutationFn runs):
  - Inspect the `startAuto` interval callback in `PlayBingo.tsx`
  - Verify that `mutationStartTimeRef.current = Date.now()` is present in the interval body (before `mutateRef.current()`)
  - Document counterexample: timestamp set in interval proves premature start

  - Run all three sub-tests on UNFIXED code
  - **EXPECTED OUTCOME**: Sub-tests A and B FAIL; sub-test C confirms premature timestamp location
  - Document all counterexamples to understand root causes before implementing fix
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Successful Playback Gate and Handled Error Codes Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run on UNFIXED code first
  - **GOAL**: Establish baseline behavior that must survive the fix

  Sub-test A — Successful sound preserves gate timing (Root cause 1 non-buggy path):
  - Observe: `playCachedSound` resolves normally → `audioQueue.playing` is `false` after `onended`
  - Write property-based test: for all sounds where `playCachedSound` resolves, after queue drains `audioQueue.playing === false`
  - Verify test PASSES on unfixed code

  Sub-test B — HTTP 429 still skips and keeps auto-call running (Root cause 2 non-buggy path):
  - Observe: `onError` with `status=429` returns early; `autoActiveRef.current` remains `true`
  - Assert `autoActiveRef.current === true` and no `stopAuto` called after 429
  - Verify test PASSES on unfixed code

  Sub-test C — NO_NUMBERS_LEFT / INVALID_STATE still stops silently:
  - Observe: `onError` with these codes calls `stopAuto(true)` and returns; no alert shown
  - Assert `stopAuto` called with `silent=true`, no `alert()` invocation
  - Verify test PASSES on unfixed code

  Sub-test D — Genuine 10-second hang still fires stuck detection:
  - Observe: `checkMutationTimeout` with `isMutationPendingRef.current=true` and elapsed > 10 000ms calls `stopAuto` + `alert`
  - Set `mutationStartTimeRef.current = Date.now() - 11000` and `isMutationPendingRef.current = true`
  - Call `checkMutationTimeout` directly; assert `stopAuto` and `alert` are called
  - Verify test PASSES on unfixed code

  Sub-test E — In-flight dedup preserved:
  - While `isMutationPendingRef.current = true` (genuine in-flight), assert no second `mutate()` call is made by the interval
  - Verify test PASSES on unfixed code

  - Verify ALL sub-tests pass on unfixed code (confirms preserved baseline behavior)
  - Mark task complete when tests are written, run, and all passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for called-number-stuck — three root causes

  - [x] 3.1 Fix AudioQueue.drain error recovery in `fidel-bingo/frontend/src/services/db.ts`
    - Locate the `catch { /* continue on error */ }` block inside `AudioQueue.drain()`
    - Replace with `catch { this.playing = false; }` so the playing flag is explicitly cleared on task failure
    - Also wrap the `playCachedSound` call inside `playNumberSoundQueued` with a try/catch that sets `audioQueue.playing = false` on failure, as a defense-in-depth safeguard
    - _Bug_Condition: isBugCondition where audioPlaying=true AND no_sound_currently_playing() (Root cause 1)_
    - _Expected_Behavior: audioQueue.playing === false after any playCachedSound rejection_
    - _Preservation: Successful sounds still keep playing=true during playback, false only after onended_
    - _Requirements: 2.1, 3.1_

  - [x] 3.2 Fix callMutation.onError to reset isMutationPendingRef in `fidel-bingo/frontend/src/pages/user/PlayBingo.tsx`
    - Add `isMutationPendingRef.current = false` at the very top of `onError`, before any branching
    - Add `mutationStartTimeRef.current = 0` at the very top as well (already present for some branches; consolidate to top)
    - This ensures every code path — including the default `stopAuto` branch and any future branches — resets the pending flag
    - _Bug_Condition: isBugCondition where mutationPending=true AND no_mutation_in_flight() (Root cause 2)_
    - _Expected_Behavior: isMutationPendingRef.current === false after any unhandled onError_
    - _Preservation: 429 branch still returns early and keeps auto-call running; NO_NUMBERS_LEFT/INVALID_STATE still stops silently_
    - _Requirements: 2.2, 3.2, 3.3_

  - [x] 3.3 Remove premature mutationStartTimeRef timestamp from interval callback in `fidel-bingo/frontend/src/pages/user/PlayBingo.tsx`
    - Delete the line `mutationStartTimeRef.current = Date.now();` from inside the `setInterval` callback in `startAuto`
    - Confirm the timestamp is still set inside `mutationFn` (it already is — no change needed there)
    - This ensures `checkMutationTimeout` measures only actual server call duration, not scheduling delay
    - _Bug_Condition: isBugCondition where startTime>0 AND mutationActuallyStarted=false AND elapsed>10000 (Root cause 3)_
    - _Expected_Behavior: mutationStartTimeRef.current only ever set inside mutationFn_
    - _Preservation: Genuine 10-second hangs (timer set inside mutationFn) still fire stopAuto + alert_
    - _Requirements: 2.3, 3.5_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Audio/Pending/Timestamp Gate Stuck
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - Sub-test A: assert `audioQueue.playing === false` after sound failure — must now PASS
    - Sub-test B: assert `isMutationPendingRef.current === false` after HTTP 500 — must now PASS
    - Sub-test C: assert `mutationStartTimeRef.current` is NOT set in interval callback — must now PASS
    - **EXPECTED OUTCOME**: All three sub-tests PASS (confirms all three bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Successful Playback Gate and Handled Error Codes Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all five preservation sub-tests (A through E) against fixed code
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions)
    - Confirm: successful audio gate timing unchanged, 429 skip-and-continue unchanged, NO_NUMBERS_LEFT/INVALID_STATE silent stop unchanged, genuine 10s hang detection unchanged, in-flight dedup unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite; all exploration and preservation tests must be green
  - Manually smoke-test auto-call: trigger a sound failure mid-game and verify the loop continues
  - Manually smoke-test: trigger a server 500 mid-auto-call and verify the loop resumes on the next tick
  - Confirm no false-positive stuck alerts appear during normal play
  - Ask the user if any questions arise before closing
