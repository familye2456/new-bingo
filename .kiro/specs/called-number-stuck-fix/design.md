# called-number-stuck-fix Bugfix Design

## Overview

The auto-call loop in `PlayBingo.tsx` can permanently freeze mid-game, requiring a manual page refresh. Three independent root causes all gate-block the `setInterval` tick: an uncleared `audioQueue.playing` flag after sound errors, an uncleared `isMutationPendingRef.current` after unhandled server errors, and a premature `mutationStartTimeRef.current` timestamp that fires a false-positive stuck alert.

The fix is surgical: add error recovery to the audio pipeline, ensure `isMutationPendingRef.current` is explicitly reset on every error path in `onError`, and move `mutationStartTimeRef.current = Date.now()` exclusively inside `mutationFn` where the server call actually begins.

## Glossary

- **Bug_Condition (C)**: Any of the three states that cause an interval tick to be permanently skipped — audio playing flag stuck, mutation pending flag stuck, or false-positive stuck timer.
- **Property (P)**: The desired post-fix behavior — interval ticks always eventually progress, and stuck detection only fires for genuine hangs.
- **Preservation**: All existing guarded paths (`429`, `NO_NUMBERS_LEFT`, `INVALID_STATE`, in-flight mutation dedup, user pause/stop) must remain exactly unchanged.
- **`audioQueue`**: Singleton `AudioQueue` instance in `db.ts` whose `.playing` flag gates every interval tick.
- **`isMutationPendingRef`**: React ref in `PlayBingo.tsx` synced to `callMutation.isPending`; a stuck `true` value skips every tick indefinitely.
- **`mutationStartTimeRef`**: Ref that records when a mutation begins; used by `checkMutationTimeout` to detect 10-second hangs.
- **`startAuto`**: The `useCallback` in `PlayBingo.tsx` that starts the `setInterval` auto-call loop.
- **`callMutation.onError`**: TanStack Query error handler for `callNumber` — the only reliable place to clear mutation-related refs on failure.
- **`playNumberSoundQueued`**: Function in `db.ts` that enqueues a number sound via `AudioQueue`.
- **`playCachedSound`**: Function in `db.ts` that resolves a sound from Cache Storage or network; the source of unhandled audio errors.

## Bug Details

### Bug Condition

The freeze manifests under three independent conditions, all of which leave the `startAuto` interval permanently stuck:

**Formal Specification:**
```
FUNCTION isBugCondition(state)
  INPUT: state = { audioPlaying, mutationPending, startTime, mutationActuallyStarted }
  OUTPUT: boolean

  // Root cause 1: audio gate stuck
  IF state.audioPlaying = true AND no_sound_currently_playing()
    RETURN true

  // Root cause 2: mutation pending flag stuck
  IF state.mutationPending = true AND no_mutation_in_flight()
    RETURN true

  // Root cause 3: false-positive timeout (timer started before mutation began)
  IF state.startTime > 0
     AND state.mutationActuallyStarted = false
     AND (Date.now() - state.startTime) > 10000
    RETURN true

  RETURN false
END FUNCTION
```

### Examples

- Sound file 404s during auto-call → `playCachedSound` rejects → `AudioQueue.drain()` swallows the error with `catch {}` but `playing` is never reset → every subsequent tick sees `audioQueue.playing = true` → game freezes forever.
- Server returns HTTP 500 during `callNumber` → `onError` receives error with `status=500`, no matching branch → no `isMutationPendingRef.current = false` → every subsequent tick sees `isMutationPendingRef.current = true` → game freezes forever.
- Interval fires tick → sets `mutationStartTimeRef.current = Date.now()` → React schedules `mutate()` async → 10 seconds elapse before React actually dispatches → `checkMutationTimeout` fires → `stopAuto(true)` + alert → game stopped despite no actual hang.
- Sound loads and plays normally → `AudioQueue` sets `playing = false` after `onended` → next tick proceeds correctly (NOT a bug condition).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When a sound plays successfully, the interval SHALL continue to wait for `audioQueue.playing` to become `false` before calling the next number.
- When `callNumber` returns HTTP 429, `onError` SHALL skip the tick and keep auto-call running unchanged.
- When `callNumber` returns `NO_NUMBERS_LEFT` or `INVALID_STATE`, `onError` SHALL stop auto-call silently without displaying an error.
- When a mutation is genuinely in-flight (`callMutation.isPending = true`), the interval SHALL continue to skip ticks to prevent duplicate calls.
- When `checkMutationTimeout` detects a genuine 10-second hang (timer set inside `mutationFn`), it SHALL continue to call `stopAuto(true)` and alert the user.
- When the user presses pause or stop, `stopAuto` SHALL continue to halt number progression immediately.

**Scope:**
All inputs that do NOT match the three bug conditions above are completely unaffected by this fix. This includes all successful code paths, the three explicitly handled error codes, user-initiated stops, and all sound playback that completes without error.

## Hypothesized Root Cause

1. **`AudioQueue.drain()` silences errors without resetting `playing`**: The `catch { /* continue on error */ }` block in `drain()` swallows the rejected promise from `playCachedSound` but does not call `this.playing = false`. The subsequent recursive `this.drain()` call is made, but since the queue is now empty it sets `playing = false` — however, if the error propagates before reaching that call (e.g. the task throws synchronously), `playing` is never reset. Additionally, `playNumberSoundQueued` calls `audioQueue.clear()` before enqueuing, which would reset the flag, but if `playCachedSound` itself throws during the enqueued execution, the `drain()` catch swallows it before the next `drain()` can clear the flag.

2. **`onError` has no default reset of `isMutationPendingRef.current`**: The handler explicitly manages four cases (`429`, `NO_NUMBERS_LEFT`, `INVALID_STATE`, and the default `stopAuto`). The `stopAuto` call does NOT set `isMutationPendingRef.current = false` — it only clears the interval. Since `isMutationPendingRef` is synced via `useEffect` from `callMutation.isPending`, the ref update depends on React re-rendering, which may lag or be blocked. The `onSettled` callback does reset `mutationStartTimeRef` but does NOT reset `isMutationPendingRef`.

3. **`mutationStartTimeRef.current` is set twice**: Once in the interval callback (`mutationStartTimeRef.current = Date.now()` just before `mutateRef.current()`) and once inside `mutationFn`. React's `useMutation` does not call `mutationFn` synchronously — it schedules it. The interval timestamp therefore starts counting before the network request begins, inflating elapsed time and causing `checkMutationTimeout` to fire prematurely.

4. **`onSettled` resets timestamps but not pending flags**: `onSettled` sets `mutationStartTimeRef.current = 0` correctly but does not reset `isMutationPendingRef.current`, leaving that responsibility entirely to the React effect, which requires a render cycle.

## Correctness Properties

Property 1: Bug Condition — Audio Failure Clears Queue

_For any_ invocation of `playNumberSoundQueued` or `playCachedSound` that rejects with an error (network failure, decode error, cache miss, or any other failure), the fixed implementation SHALL ensure `audioQueue.playing` is `false` after the error is handled, allowing the auto-call interval to proceed on its next tick.

**Validates: Requirements 2.1**

Property 2: Bug Condition — Unhandled Server Error Clears Pending Flag

_For any_ error returned by `callNumber` whose HTTP status is not `429` and whose code is neither `NO_NUMBERS_LEFT` nor `INVALID_STATE`, the fixed `callMutation.onError` handler SHALL set `isMutationPendingRef.current` to `false` before returning, so the interval is not permanently blocked.

**Validates: Requirements 2.2**

Property 3: Bug Condition — Timestamp Set Only Inside mutationFn

_For any_ interval tick that calls `mutateRef.current()`, the fixed code SHALL NOT set `mutationStartTimeRef.current` in the interval callback. The timestamp SHALL only be set inside `mutationFn`, ensuring `checkMutationTimeout` measures actual server call duration.

**Validates: Requirements 2.3**

Property 4: Preservation — Successful Sound Playback Unchanged

_For any_ sound that loads and plays without error, the fixed `AudioQueue` SHALL keep `playing = true` during playback and only set it to `false` after the sound ends, preserving the existing gate behavior for successful audio.

**Validates: Requirements 3.1**

Property 5: Preservation — Handled Error Codes Unchanged

_For any_ error with status `429`, code `NO_NUMBERS_LEFT`, or code `INVALID_STATE`, the fixed `onError` SHALL produce exactly the same behavior as the original — skip-and-continue for `429`, silent stop for the other two.

**Validates: Requirements 3.2, 3.3**

## Fix Implementation

### Changes Required

**File**: `fidel-bingo/frontend/src/services/db.ts`

**Function**: `AudioQueue.drain` / `playNumberSoundQueued`

**Specific Changes**:
1. **Error recovery in `AudioQueue.drain`**: Replace `catch { /* continue on error */ }` with a catch block that explicitly sets `this.playing = false` before calling `this.drain()`, ensuring the playing flag is always cleared after a task failure:
   ```
   try { await this.wrap(task, gen)(); } catch { this.playing = false; }
   this.drain();
   ```
   This is the minimal change — `drain()` already sets `playing = false` when the queue empties, but the explicit reset before the recursive call ensures the flag is correct even if something unexpected happens between the catch and the next drain invocation.

2. **Error handler in `playNumberSoundQueued`**: Wrap the `audioQueue.enqueue(...)` task so that if `playCachedSound` rejects, `audioQueue.playing` is guaranteed to be `false`:
   ```
   audioQueue.enqueue(async () => {
     try {
       await playCachedSound(path, volume);
     } catch {
       audioQueue.playing = false; // ensure gate is cleared on failure
     }
   });
   ```

---

**File**: `fidel-bingo/frontend/src/pages/user/PlayBingo.tsx`

**Function**: `callMutation.onError`

**Specific Changes**:
3. **Explicit reset on all non-return paths**: Add `isMutationPendingRef.current = false` at the top of `onError`, before any branching logic. Since `429` returns early and keeps auto-call running, it is the only branch where the ref must stay in sync with React's pending state (and it will be corrected by the `useEffect` on next render). For all other paths including `stopAuto`, force-clearing the ref is safe and necessary:
   ```
   onError: (err: any) => {
     isMutationPendingRef.current = false; // always clear — React effect will re-sync if needed
     mutationStartTimeRef.current = 0;
     ...
   }
   ```

**Function**: `startAuto` interval callback

**Specific Changes**:
4. **Remove premature timestamp from interval**: Delete the line `mutationStartTimeRef.current = Date.now();` from the interval callback. The timestamp is already set correctly inside `mutationFn`. The interval only needs to call `mutateRef.current()`:
   ```
   // REMOVE: mutationStartTimeRef.current = Date.now();
   mutateRef.current();
   ```

**Function**: `callMutation.mutationFn` (no change needed — already correct)

The `mutationFn` already sets `mutationStartTimeRef.current = Date.now()` before the `await offlineGameApi.callNumber(...)` call and resets it to `0` after. This is the correct and only location for the timestamp.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first surface counterexamples that demonstrate each of the three bugs on unfixed code, then verify the fix works and preserves all existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write unit tests that inject failures (mock `playCachedSound` to reject, mock `callNumber` to return a 500 error) and inspect the state of `audioQueue.playing` and `isMutationPendingRef.current` after the handlers run. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **Audio failure leaves playing stuck** (root cause 1): Mock `playCachedSound` to reject → call `playNumberSoundQueued` → assert `audioQueue.playing === true` on unfixed code (will pass on fixed code as `false`).
2. **500 error leaves pending stuck** (root cause 2): Mock `callNumber` to return HTTP 500 → trigger `onError` → assert `isMutationPendingRef.current === true` on unfixed code (will pass on fixed code as `false`).
3. **Interval sets timestamp before mutationFn** (root cause 3): Spy on `mutationFn` execution timing → verify `mutationStartTimeRef.current > 0` before `mutationFn` runs on unfixed code.

**Expected Counterexamples**:
- `audioQueue.playing` remains `true` after a failed sound — confirming root cause 1.
- `isMutationPendingRef.current` remains `true` after an unhandled error — confirming root cause 2.
- `mutationStartTimeRef.current` is non-zero before `mutationFn` executes — confirming root cause 3.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL sound_failures WHERE playCachedSound rejects DO
  result := playNumberSoundQueued_fixed(...)
  ASSERT audioQueue.playing = false
END FOR

FOR ALL errors WHERE status NOT IN {429} AND code NOT IN {NO_NUMBERS_LEFT, INVALID_STATE} DO
  result := onError_fixed(error)
  ASSERT isMutationPendingRef.current = false
END FOR

FOR ALL interval ticks DO
  ASSERT mutationStartTimeRef NOT SET in interval callback
  ASSERT mutationStartTimeRef SET inside mutationFn only
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, fixed behavior equals original behavior.

**Pseudocode:**
```
FOR ALL sounds WHERE playCachedSound resolves DO
  ASSERT audioQueue.playing behavior = original behavior
END FOR

FOR ALL errors WHERE status = 429 OR code IN {NO_NUMBERS_LEFT, INVALID_STATE} DO
  ASSERT onError_fixed(error) = onError_original(error)
END FOR
```

**Testing Approach**: Property-based testing is recommended for the audio queue preservation check because there are many possible sound paths (different voices, formats, cache hit/miss) and manual enumeration would be incomplete.

**Test Cases**:
1. **Successful sound preserves gate**: Verify that a successful `playNumberSoundQueued` call keeps `playing = true` during playback, then `false` after — unchanged from original.
2. **429 still skips and continues**: Inject 429 error → verify `autoActiveRef.current` remains `true` and `isMutationPendingRef.current` is reset correctly.
3. **NO_NUMBERS_LEFT still stops silently**: Inject this code → verify `stopAuto(true)` is called, no alert shown.
4. **In-flight dedup preserved**: While `isMutationPendingRef.current = true` (real in-flight), verify no second `mutate()` call is made.
5. **Genuine 10s hang still alerts**: Set `mutationStartTimeRef.current = Date.now() - 11000` with `isMutationPendingRef.current = true` → call `checkMutationTimeout` → verify `stopAuto` + alert.

### Unit Tests

- Test `AudioQueue.drain` with a task that throws — assert `playing = false` after.
- Test `playNumberSoundQueued` with mocked `playCachedSound` that rejects — assert `audioQueue.playing = false`.
- Test `onError` with status 500 — assert `isMutationPendingRef.current = false`.
- Test `onError` with status 429 — assert auto-call still running.
- Test `onError` with `NO_NUMBERS_LEFT` — assert `stopAuto` called, no alert.
- Test that the interval callback does NOT set `mutationStartTimeRef.current`.
- Test that `mutationFn` sets `mutationStartTimeRef.current` before the `await`.

### Property-Based Tests

- Generate random error objects with arbitrary status codes and error codes; for all where status ≠ 429 and code ∉ {NO_NUMBERS_LEFT, INVALID_STATE}, assert `isMutationPendingRef.current = false` after `onError`.
- Generate random sound file paths; for all paths where `playCachedSound` rejects, assert `audioQueue.playing = false` after the queue drains.
- Generate random successful sound completions; assert `audioQueue.playing` is `false` only after `onended` — preserving the existing gate timing.

### Integration Tests

- Simulate full auto-call loop with intermittent sound failures — verify game continues calling numbers without freeze.
- Simulate auto-call loop with HTTP 500 errors interspersed — verify loop recovers and continues.
- Simulate auto-call loop with a genuine 11-second mutation hang — verify stuck detection fires and shows alert.
- Simulate user pause during auto-call — verify loop stops immediately and end sound plays.
