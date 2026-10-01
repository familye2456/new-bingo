# Tasks: Called Number Reset on Reload

## Phase 1: Exploratory Bug Condition Checking

- [x] 1.1 Write exploratory test — non-creator reset is blocked (403)
  Verify that calling `resetGame` as a non-creator user currently throws a 403. Run against unfixed code to confirm root cause.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 1.2 Write exploratory test — creator reset leaves numberSequence intact
  After a creator-triggered `resetGame`, assert that `game.numberSequence` is unchanged (same array as before). Run against unfixed code.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 1.3 Write exploratory test — callNumber after creator reset uses old sequence
  After creator reset, call `callNumber` and assert the returned number equals `oldSequence[0]` (not a new sequence element). Run against unfixed code to observe behavior.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

## Phase 2: Implement the Fix

- [x] 2.1 Remove creator-only authorization guard from `resetGame`
  In `GameService.resetGame`, remove (or loosen) the `if (game.creatorId !== userId)` check so any authenticated user can trigger a reset.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.ts`

- [x] 2.2 Clear and regenerate `numberSequence` inside `resetGame`
  After setting `game.calledNumbers = []`, add `game.numberSequence = this.shuffleNumbers()` so subsequent `callNumber` calls begin from a fresh shuffle.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.ts`

## Phase 3: Fix Checking Tests

- [x] 3.1 Write fix-check unit test — any-user reset now succeeds
  After fix: call `resetGame` with a non-creator userId and assert it resolves without error.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 3.2 Write fix-check unit test — reset clears both fields
  After fix: call `resetGame` as any user, assert `game.calledNumbers = []` and `game.numberSequence` is a fresh 75-element permutation of 1–75.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 3.3 Write fix-check unit test — callNumber after reset uses new sequence index 0
  After fix: reset then call `callNumber`; assert returned number equals `game.numberSequence[0]` (not the old sequence).
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [ ] 3.4 Write fix-check unit test — reset on non-active game still throws 400
  Assert that `resetGame` on a `pending` or `finished` game still throws `400 INVALID_STATE`.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

## Phase 4: Property-Based Tests

- [x] 4.1 [PBT] Property 1 — reset always produces a valid fresh sequence
  For any active game state (random `calledNumbers` length 0–74), after `resetGame`:
  `calledNumbers = []`, `numberSequence` is a permutation of [1..75], and `callNumber` returns `numberSequence[0]`.
  Validates: Requirements 2.1, 2.2, 2.3
  File: `fidel-bingo/backend/src/modules/game/application/GameService.pbt.test.ts`

- [x] 4.2 [PBT] Property 2 — sequential calling is preserved (no reset path)
  For any active game state where reset has NOT been called: repeated `callNumber` invocations always return `sequence[i]` for `i = 0, 1, 2, …` with no duplicates.
  Validates: Requirements 3.1, 3.5
  File: `fidel-bingo/backend/src/modules/game/application/GameService.pbt.test.ts`

## Phase 5: Preservation Tests

- [x] 5.1 Write preservation test — pending→active transition still starts fresh
  Call `startGame` then `callNumber`; verify first number is `sequence[0]` (unchanged behavior).
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 5.2 Write preservation test — cartela marking unaffected
  Call `markNumber` on an active game before and after the fix; verify outcomes are identical.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

- [x] 5.3 Write preservation test — finished game preserves calledNumbers
  Call `finishGame` and assert `calledNumbers` is retained in the final game record.
  File: `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

## Phase 6: Integration Tests

- [x] 6.1 Write integration test — full reload flow resets backend state
  Create game → start → call 5 numbers → simulate reload (call `resetGame`) → verify backend `calledNumbers = []` and new `numberSequence` → call 1 number → assert it equals `newSequence[0]`.
  File: `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.test.ts`

- [x] 6.2 Write integration test — non-creator can trigger reset via API
  Join as non-creator player → call `POST /games/:gameId/reset` as that player → assert 200 OK and game state is reset.
  File: `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.test.ts`
