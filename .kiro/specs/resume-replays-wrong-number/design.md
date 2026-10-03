# Resume Replays Wrong Number — Bugfix Design

## Overview

When auto-call is paused while a number's audio is still mid-play, the system should replay
that interrupted number on resume. Instead, `stopAuto` unconditionally clears
`pendingNumberRef.current` to `null`, so `startAuto` falls back to the last entry in
`sessionCalledNumbers` — which is the number before the interrupted one. The result: players
hear the previous number replayed a second time, and the interrupted number N is silently
skipped from the session.

The fix is minimal: save the pending number into a separate "resume target" ref before
`stopAuto` clears `pendingNumberRef`, then use that saved value in `startAuto` to drive the
replay.

## Glossary

- **Bug_Condition (C)**: Auto-call is paused while number N's audio is still playing, so
  `pendingNumberRef.current === N` at the moment `stopAuto` fires
- **Property (P)**: On resume, N is replayed exactly once and committed to the board before
  any new number is scheduled
- **Preservation**: All pause/resume, stop, fresh-game, in-flight-discard, and 75-number-limit
  behaviors that must remain unchanged by the fix
- **pendingNumberRef**: Ref in `PlayBingo.tsx` holding the number returned by the server but
  not yet marked on the board (sound still playing); cleared by `stopAuto` so a hard stop
  does not commit an unfinished number
- **resumePendingRef**: New ref introduced by this fix, set in `stopAuto` to N when
  `pendingNumberRef.current !== null`, giving `startAuto` the correct replay target
- **sessionCalledNumbers**: React state array driving the board display; a number is only
  added here after its audio fully plays (or after replay on resume)
- **sessionCalledRef**: Stable ref mirror of `sessionCalledNumbers` readable inside callbacks
- **startAuto**: Function in `PlayBingo.tsx` that begins or resumes auto-call; responsible for
  the replay step on resume
- **stopAuto**: Function in `PlayBingo.tsx` that pauses auto-call; increments `callGenRef` and
  clears `pendingNumberRef`
- **callGenRef**: Generation counter; incremented on every `stopAuto` to invalidate in-flight
  server calls

## Bug Details

### Bug Condition

The bug manifests when `stopAuto` is called while `pendingNumberRef.current` holds number N
(i.e., N's audio is still playing). `stopAuto` unconditionally sets
`pendingNumberRef.current = null`, discarding N. When `startAuto` is subsequently called,
it reads `pendingNumberRef.current` (now `null`) and falls back to
`sessionCalledRef.current[last]` — which is the number before N, since N was never committed
to `sessionCalledNumbers`.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { pendingAtPause: number | null, resumeAction: 'start' }
  OUTPUT: boolean

  RETURN pendingAtPause IS NOT NULL        // a number's audio was mid-play at pause time
         AND stopAuto cleared pendingNumberRef to null
         AND startAuto uses sessionCalledNumbers[last] as replay target
         AND sessionCalledNumbers[last] != pendingAtPause  // wrong number replayed
END FUNCTION
```

### Examples

- Number 37 is mid-announcement. User pauses. Resumes: system replays the number before 37
  (e.g. 22) instead of 37. 37 is never announced. **Expected**: 37 is replayed and marked.
- First number ever called (board is empty), paused mid-sound. Resume: `sessionCalledNumbers`
  is empty, `replayNum` falls to `null`, system fires a new call — skipping the interrupted
  number entirely. **Expected**: interrupted number replayed first.
- User pauses and resumes three times in succession, each time mid-sound. Each resume should
  replay the number that was interrupted at that pause, not the one before it.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When auto-call is paused after a number's audio has fully completed, `pendingNumberRef` is
  already `null`; `startAuto` SHALL continue to skip replay and proceed to a new call
- A fresh game (no numbers called yet) SHALL continue to skip the replay step entirely and
  begin calling new numbers immediately
- When `stopAuto` is called while a server request is in-flight (number not yet returned),
  the `callGen` guard SHALL continue to discard that result so it is never added to the board
- Multiple pause/resume cycles SHALL never result in duplicate or skipped numbers on the board
- When `callMutation` returns `null` (all 75 numbers exhausted), auto-call SHALL continue to
  stop without announcing any number

**Scope:**
All inputs that do NOT involve `pendingNumberRef.current` being non-null at pause time are
completely unaffected by this fix. This includes mouse clicks, manual Next-button calls,
check-cartela flow, finish-game flow, and all cases where sound finished before pause.

## Hypothesized Root Cause

Based on the code in `PlayBingo.tsx`:

1. **`stopAuto` unconditionally nulls `pendingNumberRef`**: Line 211 sets
   `pendingNumberRef.current = null` with the comment "sound was cut — number not officially
   called". This is correct for the commit-suppression goal, but it also destroys the only
   reference to N that `startAuto` needs to replay the right number.

2. **`startAuto` reads `pendingNumberRef` after it is already cleared**: The `startAuto`
   closure (line ~370) reads `pendingNumberRef.current` to find the replay target. Because
   `stopAuto` runs first and clears it, `pendingNumberRef.current` is always `null` by the
   time `startAuto` reads it.

3. **Fallback to `sessionCalledNumbers[last]` is off-by-one**: N was never added to
   `sessionCalledNumbers` (its audio never completed), so the array's last entry is N-1, the
   number before the interrupted one. The fallback replays the wrong number.

4. **No secondary "resume target" storage exists**: There is no ref that survives `stopAuto`
   and carries N's identity to `startAuto`. Adding one is the minimal fix.

## Correctness Properties

Property 1: Bug Condition — Resume Replays Interrupted Number

_For any_ pause event where `pendingNumberRef.current === N` (N's audio was mid-play),
the fixed `startAuto` SHALL replay N exactly once via `playNumberSoundAndWait`, then mark
N on the board (add to `sessionCalledNumbers`) before scheduling any new server call.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Non-Interrupted Pause Behavior Unchanged

_For any_ pause event where `pendingNumberRef.current === null` at pause time (audio had
already finished), the fixed `startAuto` SHALL produce exactly the same behavior as the
original: no replay of the last board number, proceed directly to a new call (or replay
`sessionCalledNumbers[last]` for the normal "hear it again" UX if implemented).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `fidel-bingo/frontend/src/pages/user/PlayBingo.tsx`

**Specific Changes:**

1. **Add `resumePendingRef`**: Declare a new ref alongside `pendingNumberRef`:
   ```
   const resumePendingRef = useRef<number | null>(null);
   ```

2. **Save N in `stopAuto` before clearing `pendingNumberRef`**: In `stopAuto`, before the
   line that nulls `pendingNumberRef`, capture the value:
   ```
   resumePendingRef.current = pendingNumberRef.current; // save interrupted number for resume
   pendingNumberRef.current = null;                      // existing line — unchanged
   ```

3. **Update `startAuto` to use `resumePendingRef`**: Replace the current read of
   `pendingNumberRef.current` with `resumePendingRef.current`, then clear it immediately so
   a second resume without a new interruption does not re-replay:
   ```
   const pendingNum = resumePendingRef.current;
   resumePendingRef.current = null;          // consume: only replay once per pause
   const lastCalled = sessionCalledRef.current;
   const replayNum = pendingNum ?? (lastCalled.length > 0 ? lastCalled[lastCalled.length - 1] : null);
   ```

4. **Update the post-replay commit guard**: The existing guard inside the `.then()` of
   `playNumberSoundAndWait` currently checks `pendingNumberRef.current === pendingNum`. Since
   `pendingNum` now comes from `resumePendingRef`, update the guard variable name accordingly
   (the logic is identical):
   ```
   if (pendingNum != null && /* resumePendingRef already cleared */ autoActiveRef.current) {
     setSessionCalledNumbers((prev) => prev.includes(pendingNum) ? prev : [...prev, pendingNum]);
   }
   ```
   (The `pendingNumberRef` check is no longer needed here because the interrupted number is
   now tracked via `resumePendingRef`, not `pendingNumberRef`.)

5. **No changes to `hardStopAuto`**: Hard stops (game finish, unmount, error) do not need to
   preserve the interrupted number — clearing both refs on hard stop is correct.
   Add `resumePendingRef.current = null` to `hardStopAuto` for symmetry.

**Pseudocode of fixed stopAuto:**
```
stopAuto(silent):
  clearTimeout(autoRef)
  autoActiveRef.current = false
  callGenRef.current++
  resumePendingRef.current = pendingNumberRef.current  // NEW: save before clear
  pendingNumberRef.current = null
  lastCallTimeRef.current = 0
  setAutoOn(false)
  IF NOT silent: playRootSound('aac_ended.mp3')
```

**Pseudocode of fixed startAuto:**
```
startAuto():
  IF no active game: RETURN
  IF sessionCalledNumbers.length > 0: playRootSound('aac_resumed.mp3')
  autoActiveRef.current = true
  setAutoOn(true)

  pendingNum = resumePendingRef.current   // NEW: read saved interrupted number
  resumePendingRef.current = null          // NEW: consume immediately

  lastCalled = sessionCalledRef.current
  replayNum = pendingNum ?? (lastCalled.length > 0 ? lastCalled[last] : null)

  IF replayNum != null:
    playNumberSoundAndWait(replayNum, voice, volume).then(() => {
      IF pendingNum != null:               // was an interrupted number — commit it
        setSessionCalledNumbers(prev => [...prev, pendingNum])
      IF autoActiveRef.current:
        scheduleNextRef.current(speed * 1000)
    })
    RETURN

  // No replay needed — fire first call immediately
  mutateRef.current()
```

## Testing Strategy

### Validation Approach

Two-phase approach: first run exploration tests on unfixed code to surface counterexamples
and confirm the root cause; then verify the fix makes those tests pass while the preservation
tests remain green.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the wrong number is replayed on unfixed
code. Confirm `resumePendingRef` (or equivalent) is absent and `pendingNumberRef` is null by
the time `startAuto` reads it.

**Test Plan**: Directly invoke the `stopAuto` and `startAuto` logic extracted into a
test-harness module. Seed `pendingNumberRef.current = N` (simulating mid-sound pause), call
`stopAuto`, then call `startAuto`. Assert `playNumberSoundAndWait` is called with N. On
unfixed code this assertion fails — `playNumberSoundAndWait` is called with the last board
number instead, or not called with N at all.

**Test Cases:**
1. **Mid-sound pause replay test**: Set `pendingNumberRef.current = 37`; call `stopAuto`;
   call `startAuto`; assert `playNumberSoundAndWait` is called with `37`. (fails on unfixed code)
2. **First-number mid-sound test**: Board empty, `pendingNumberRef.current = 12`; pause then
   resume; assert `playNumberSoundAndWait` is called with `12`, not a new server call.
   (fails on unfixed code)
3. **Board commit test**: After `playNumberSoundAndWait` resolves in startAuto, assert
   `sessionCalledNumbers` includes the interrupted number N. (fails on unfixed code)
4. **Subsequent call test**: After replay of N completes, assert next server call is triggered
   (not a second replay of N). (may fail on unfixed code)

**Expected Counterexamples:**
- `playNumberSoundAndWait` is called with `sessionCalledNumbers[last]` (e.g. 22) instead of
  the interrupted number N (e.g. 37)
- Root cause: `pendingNumberRef.current` is `null` when `startAuto` reads it, because
  `stopAuto` cleared it before `startAuto` ran

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed `startAuto`
replays the interrupted number and commits it to the board.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := startAuto_fixed(input)
  ASSERT playNumberSoundAndWait called with input.pendingAtPause
  ASSERT sessionCalledNumbers includes input.pendingAtPause after sound resolves
  ASSERT no new server call until replay completes
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (audio finished
before pause, fresh game, in-flight discard, 75-number limit), the fixed code behaves
identically to the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT startAuto_original(input) = startAuto_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of `pendingNumberRef` states (null vs. non-null) and
  `sessionCalledNumbers` lengths automatically
- It catches edge cases like empty boards, full boards (75 numbers), and rapid pause/resume
- It provides strong guarantees that non-interrupted pauses are completely unaffected

**Test Cases:**
1. **Post-audio-completion pause**: `pendingNumberRef.current` is already `null` at pause
   time; verify resume does NOT replay `sessionCalledNumbers[last]` spuriously when the
   fix is applied (normal last-number replay behavior preserved)
2. **Fresh game resume**: `sessionCalledNumbers` empty and `pendingNumberRef` null; verify
   `startAuto` immediately fires a new server call without any replay
3. **In-flight discard preservation**: Call `stopAuto` while a server request is in-flight;
   verify `callGenRef` increment still discards the result on fixed code
4. **Multiple pause/resume cycles**: Simulate 5 consecutive mid-sound pauses with different N
   values; verify each resume replays the correct N and the board contains all numbers in
   order with no duplicates

### Unit Tests

- `stopAuto` sets `resumePendingRef.current` to the value of `pendingNumberRef.current`
  before clearing it
- `stopAuto` still sets `pendingNumberRef.current = null` (existing behavior unchanged)
- `startAuto` calls `playNumberSoundAndWait` with the value from `resumePendingRef`, not from
  `pendingNumberRef` or `sessionCalledNumbers[last]`
- `startAuto` clears `resumePendingRef.current` immediately after reading it
- After replay sound resolves, `sessionCalledNumbers` includes the interrupted number

### Property-Based Tests

- For any number N (1–75) held in `pendingNumberRef` at pause time, the fixed flow always
  replays N and never replays `sessionCalledNumbers[last]` when `last !== N`
- For any `sessionCalledNumbers` array (length 0–74) with `pendingNumberRef === null`, the
  fixed `startAuto` produces identical behavior to the original (no regression)
- For any sequence of pause/resume events with random N values, `sessionCalledNumbers` after
  all events contains each N exactly once in call order

### Integration Tests

- Full game flow: start auto, pause mid-sound at number 37, resume, verify 37 is announced
  and appears on the board before the next new number is called
- First-call interrupted: start auto on empty board, pause mid-sound, resume, verify the
  first number is replayed (not skipped) and appears on the board
- Rapid pause/resume: pause and resume 5 times with mid-sound interruptions; verify the board
  matches the full intended sequence with no gaps or duplicates
- Post-audio pause: let a sound finish fully, then pause, resume — verify no spurious replay
  occurs and the game continues normally to the next new call
