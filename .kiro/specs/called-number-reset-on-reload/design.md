# Called Number Reset on Reload — Bugfix Design

## Overview

When the `GamePage` mounts (including on browser reload) during an active Bingo game, the called
number sequence should reset so the host sees a clean board. Two separate defects prevent this:

1. **Backend — authorization gap**: `GameService.resetGame` throws a 403 for any non-creator user,
   so the reset silently fails in the frontend's `.catch(() => {})`.

2. **Backend — incomplete reset**: Even when the creator triggers `resetGame`, only `calledNumbers`
   is cleared; `numberSequence` is left intact. Because `callNumber` uses
   `calledNumbers.length` as the next index into the sequence, subsequent calls resume from the
   old position — producing numbers that were already announced.

The fix targets both defects with minimal surface area: extend `resetGame` to clear
`numberSequence` as well, and change the authorization rule so that any authenticated user (not
only the creator) can trigger the game-page reset.

---

## Glossary

- **Bug_Condition (C)**: A `GamePageLoadEvent` where `isPageReload = true` AND
  `game.status = 'active'`.
- **Property (P)**: After the load, `displayedCalledNumbers = []` AND
  `game.calledNumbers = []` AND the next `callNumber` returns `freshSequence[0]`.
- **Preservation**: All behaviors that must remain unchanged — sequential calling during a live
  game, pending→active initialization, cartela marking, finished-game record-keeping.
- **`resetGame`**: `GameService.resetGame(gameId, userId)` in
  `fidel-bingo/backend/src/modules/game/application/GameService.ts` — currently clears only
  `calledNumbers`.
- **`callNumber`**: `GameService.callNumber(gameId, userId)` — derives the next number as
  `sequence[calledNumbers.length]`, so an incorrect index survives the partial reset.
- **`numberSequence`**: The pre-shuffled 75-number array stored in `game.numberSequence`. Its
  index implicitly tracks progress via `calledNumbers.length`.
- **`GamePage`**: `fidel-bingo/frontend/src/pages/GamePage.tsx` — calls
  `gameApi.resetGame(gameId).catch(() => {})` on mount, then overwrites local state with an empty
  `calledNumbers` array regardless of the API result.

---

## Bug Details

### Bug Condition

The bug manifests when `GamePage` mounts for an active game (i.e., on a page reload or
re-navigation). `resetGame` is either rejected (403, non-creator) or partially applied (creator
only clears `calledNumbers`, not `numberSequence`), causing the displayed sequence and the
backend sequence to diverge or continue mid-stream.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type GamePageLoadEvent
  OUTPUT: boolean

  RETURN X.isPageReload = true
    AND X.game.status = 'active'
END FUNCTION
```

### Examples

- **Non-creator reload**: User A (not the creator) refreshes GamePage on game #42, which has
  called 10 numbers. `resetGame` returns 403 → frontend silently swallows the error and
  manually sets `calledNumbers = []` in local state only. The backend still has 10 numbers.
  The next `callNumber` returns `sequence[10]`, not `sequence[0]`. _Expected_: backend resets
  too, next call returns `sequence[0]`.

- **Creator reload — partial reset**: Creator refreshes on game #42 (10 numbers called).
  `resetGame` succeeds, clears `calledNumbers` to `[]`, but `numberSequence` stays as-is.
  `callNumber` computes `nextIndex = calledNumbers.length = 0` — but this is correct only
  because `calledNumbers` was cleared. Wait — actually this case _would_ work for the index
  _if_ `calledNumbers` is properly cleared. The real issue is that previously called numbers
  could reappear because the same shuffled sequence is reused without regeneration.
  _Expected_: `numberSequence` also regenerated so a genuinely fresh random sequence is used.

- **Edge case — all 75 numbers called**: Creator reloads on a game with all 75 numbers called.
  Without the fix, `resetGame` clears `calledNumbers` but `callNumber` would still use the
  same exhausted sequence. _Expected_: sequence is regenerated, enabling a fresh call from
  index 0.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Calling the next number during a live game (without a reload) MUST continue to add numbers
  sequentially from the current `calledNumbers.length` index.
- When a game transitions from `pending` to `active`, it MUST still start with an empty
  `calledNumbers` list and whatever `numberSequence` was established at creation / first call.
- Marking a number on a cartela MUST continue to validate and persist correctly, independent of
  any prior reload reset.
- When a game is finished, the final `calledNumbers` list MUST be preserved for record-keeping.
- After a reload-triggered reset, the creator MUST be able to call numbers starting from
  `freshSequence[0]`.

**Scope:**
All inputs where `isBugCondition(X)` is false — normal mid-game calls, cartela marks, game
starts, and finished-game reads — must be completely unaffected by this fix.

---

## Hypothesized Root Cause

1. **Creator-only authorization in `resetGame`**: The guard
   `if (game.creatorId !== userId) throw new AppError(403, ...)` blocks every non-creator user,
   making the on-mount reset a no-op for the majority of users.

2. **`numberSequence` not cleared on reset**: `resetGame` sets `game.calledNumbers = []` but
   never touches `game.numberSequence`. Since `callNumber` uses `calledNumbers.length` as the
   next index, clearing `calledNumbers` alone is sufficient to restart the index at 0 — but the
   same shuffled sequence is reused. This means the game does not get a fresh random sequence,
   and numbers already called will appear again in the same order.

3. **Frontend absorbs API errors silently**: `gameApi.resetGame(gameId).catch(() => {})` masks the
   403 so the developer (and user) never see the failure. The frontend then manually forces
   `calledNumbers: []` in local state, making the UI look correct while the backend is out of
   sync.

4. **No `numberSequence` regeneration path for active games**: There is no code path that
   regenerates `numberSequence` for an already-active game. `startGame` does not set it (it is
   lazily created on first `callNumber`). `resetGame` must become responsible for regenerating it.

---

## Correctness Properties

Property 1: Bug Condition — Reload Resets Called Sequence to Empty

_For any_ `GamePageLoadEvent` where `isBugCondition(X)` holds (active game on reload), the fixed
`resetGame` function SHALL clear both `game.calledNumbers` to `[]` and regenerate
`game.numberSequence` to a fresh shuffle, so that the next `callNumber` returns the first element
of the new sequence and the displayed board shows no previously called numbers.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Non-Reload Game Operations Unchanged

_For any_ input where `isBugCondition(X)` does NOT hold (normal mid-game call, cartela mark, game
start, finished-game read), the fixed code SHALL produce exactly the same result as the original
code, preserving all sequential calling, cartela marking, and game lifecycle behaviors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File**: `fidel-bingo/backend/src/modules/game/application/GameService.ts`

**Function**: `resetGame`

**Specific Changes**:

1. **Remove creator-only guard**: Replace `if (game.creatorId !== userId)` check with a simple
   authenticated-user check (any valid authenticated user may reset their own view). The existing
   route middleware already ensures `req.user` is authenticated.
   ```
   // BEFORE
   if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can reset the game');

   // AFTER  — remove or loosen to allow any authenticated participant
   // (no authorization check needed here; the route already requires auth)
   ```

2. **Clear and regenerate `numberSequence`**: After clearing `calledNumbers`, also regenerate
   the sequence so subsequent calls begin from a fresh shuffle:
   ```
   game.calledNumbers = [];
   game.numberSequence = this.shuffleNumbers();   // NEW
   ```

3. **Persist and cache the updated game**: The existing `gameRepo.save(game)` and Redis cache
   update already handle persistence — no additional change required.

**File**: `fidel-bingo/frontend/src/pages/GamePage.tsx`  _(optional improvement)_

- The frontend's manual `calledNumbers: []` override on mount is a reasonable client-side safety
  net. No change is strictly required here, but logging or surfacing the API error (rather than
  silently swallowing it) would aid future debugging.

---

## Testing Strategy

### Validation Approach

Two-phase: first surface counterexamples on the unfixed code, then verify the fix and run
preservation checks.

---

### Exploratory Bug Condition Checking

**Goal**: Demonstrate the bug on unfixed code to confirm root cause analysis.

**Test Plan**: Write integration tests against the real `GameService` (with a test database or
in-memory mock) that:
1. Create and start an active game with some called numbers.
2. Call `resetGame` as a non-creator user → expect it to currently throw 403.
3. Call `resetGame` as the creator → expect `calledNumbers = []` but `numberSequence` unchanged.
4. Call `callNumber` after the creator reset → observe that sequence index resumes correctly but
   the same sequence is reused (not a fresh shuffle).

**Test Cases**:
1. **Non-creator reset throws 403** (will fail after fix, confirming auth guard removal)
2. **Creator reset leaves numberSequence intact** (will fail after fix, confirming sequence regen)
3. **callNumber after creator reset uses old sequence** (will fail after fix)
4. **Edge case — reset after all 75 called still regenerates sequence** (may fail on unfixed code)

**Expected Counterexamples**:
- `resetGame` called by non-creator → throws `AppError(403)` instead of resetting.
- `resetGame` called by creator → `game.numberSequence` is non-empty array of the original shuffle.

---

### Fix Checking

**Goal**: After applying the fix, verify Property 1 holds for all buggy inputs.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result ← resetGame_fixed(gameId, anyAuthenticatedUserId)
  ASSERT result.calledNumbers = []
  ASSERT result.numberSequence.length = 75
  nextCall ← callNumber_fixed(gameId, creatorId)
  ASSERT nextCall.number = result.numberSequence[0]
END FOR
```

---

### Preservation Checking

**Goal**: Verify Property 2 — for all non-buggy inputs, behavior is unchanged.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT callNumber_original(X) = callNumber_fixed(X)
  ASSERT markNumber_original(X) = markNumber_fixed(X)
  ASSERT startGame_original(X) = startGame_fixed(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation because:
- It generates many game states automatically (various `calledNumbers` lengths, sequences).
- It catches edge cases manual tests miss (empty sequences, full sequences, mid-game states).
- It gives strong assurance that the authorization change does not affect any other path.

**Test Cases**:
1. **Sequential calling preserved**: Generate random active games, call `callNumber` N times
   without reload, verify each number is `sequence[i]` for `i = 0..N-1`.
2. **cartela mark preserved**: Generate random active games, call `markNumber` with valid/invalid
   numbers, verify outcomes identical before and after fix.
3. **pending→active transition preserved**: Call `startGame`, then `callNumber` — verify first
   number is `sequence[0]`.
4. **finished game calledNumbers preserved**: Call `finishGame`, verify `calledNumbers` unchanged.

---

### Unit Tests

- `resetGame` with non-creator userId → now succeeds (returns void, clears both fields).
- `resetGame` with creator userId → clears `calledNumbers` and regenerates `numberSequence`.
- `resetGame` on non-active game → still throws `400 INVALID_STATE`.
- `callNumber` after `resetGame` → returns `newSequence[0]`, `remaining = 74`.

### Property-Based Tests

- For any active game state with `calledNumbers.length` in `[0, 75)`, after `resetGame`:
  `calledNumbers = []` and `numberSequence.length = 75` and `numberSequence` is a permutation
  of `[1..75]`.
- For any active game state where reset has NOT been called: `callNumber` always returns
  `sequence[calledNumbers.length]` (preservation of sequential calling).
- For random sequences of `callNumber` invocations without reload: no number is ever repeated
  within a single game session.

### Integration Tests

- Full flow: create game → start → call 5 numbers → reload (call `resetGame`) → verify backend
  `calledNumbers = []` and `numberSequence` is new → call 1 number → verify it is `newSequence[0]`.
- Non-creator reload: join as player → call `resetGame` as player → verify no 403, game resets.
- Frontend smoke test: `GamePage` mounts → `resetGame` resolves → `displayedNumbers` state is `[]`.
