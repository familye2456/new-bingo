# User Game Data Isolation Bugfix Design

## Overview

The `GET /games/:gameId/cartelas` endpoint in `gameRoutes.ts` returns all cartelas for a game
without filtering by the requesting user's ID. This exposes other players' cartela numbers,
bet amounts, and win state. The fix adds a `userId` filter to the repository query for
non-admin users, mirroring the pattern already used in the `/games/mine` route.

## Glossary

- **Bug_Condition (C)**: A non-admin user requests `GET /games/:gameId/cartelas` and the
  response includes cartelas belonging to other users
- **Property (P)**: The response contains only cartelas where `GameCartela.userId` matches
  the authenticated user's ID
- **Preservation**: All other endpoints and their existing authorization logic remain unchanged
- **GameCartela**: The join entity in `game_cartelas` table linking a `Game`, a `UserCartela`,
  and a `userId` with a `betAmount`
- **UserCartela**: The entity holding the actual cartela card data (numbers, etc.)
- **AuthRequest**: Express request type extended with `req.user` populated by `authenticate`
  middleware

## Bug Details

### Bug Condition

The bug manifests when a non-admin authenticated user calls `GET /games/:gameId/cartelas`.
The handler queries `GameCartela` filtered only by `gameId`, returning every participant's
cartela for that game instead of just the caller's.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { gameId: string, requestingUser: { id: string, role: string } }
  OUTPUT: boolean

  RETURN input.requestingUser.role NOT IN ['admin']
         AND gcRepo.find({ where: { gameId: input.gameId } }).some(
               entry => entry.userId != input.requestingUser.id
             )
END FUNCTION
```

### Examples

- User A and User B both join game "g1". User A calls `GET /games/g1/cartelas` and receives
  both their own cartela AND User B's cartela numbers and bet amount. Expected: only User A's
  cartela is returned.
- User A calls the endpoint for a game they did not join. Expected: empty array (no cartelas
  with their userId exist for that game).
- An admin calls `GET /games/g1/cartelas`. Expected: all cartelas returned (unchanged behavior).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Admin users calling `GET /games/:gameId/cartelas` continue to receive all cartelas for the game
- `GET /games/mine` continues to return only games where the user's `userId` appears in `game_cartelas`
- `GET /games` continues to scope results by `creatorId` for non-admin users via `listGames`
- `POST /games/:gameId/join`, `start`, `call`, `finish`, `reset`, and `bingo` continue to enforce
  `creatorId` ownership checks unchanged

**Scope:**
All requests that are NOT a non-admin `GET /games/:gameId/cartelas` are completely unaffected
by this fix. This includes:
- All mutation endpoints (join, start, call, finish, reset, bingo, mark)
- The `/games/mine` route
- The `GET /games` list route
- Admin calls to the cartelas sub-route

## Hypothesized Root Cause

Based on the code in `gameRoutes.ts` (lines ~100-105):

1. **Missing userId filter**: The `gcRepo.find` call only passes `{ where: { gameId } }`.
   There is no `userId: req.user!.id` condition, so TypeORM returns every row for that game.

2. **No role check**: Unlike `listGames`, the handler does not branch on `req.user!.role`,
   so admins and regular users hit the same unfiltered query.

3. **Pattern inconsistency**: The `/games/mine` route correctly uses
   `.where('gc.userId = :userId', { userId: req.user!.id })` but this pattern was not
   applied to the cartelas sub-route.

## Correctness Properties

Property 1: Bug Condition - Cartelas Scoped to Requesting User

_For any_ request where the authenticated user is not an admin and `isBugCondition` returns
true, the fixed `GET /games/:gameId/cartelas` handler SHALL return only `GameCartela` entries
where `userId` equals `req.user.id`, so no other user's cartela data is exposed.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Admin Full Visibility Unchanged

_For any_ request where the authenticated user IS an admin (isBugCondition returns false),
the fixed handler SHALL return the same result as the original handler — all cartelas for
the game — preserving full admin visibility.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**File**: `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.ts`

**Route handler**: `GET /:gameId/cartelas`

**Specific Changes**:

1. **Add role-based branching**: Check `req.user!.role === 'admin'` to decide whether to
   apply the userId filter.

2. **Non-admin path — add userId filter**: Change the `gcRepo.find` call to include
   `userId: req.user!.id` in the `where` clause alongside `gameId`.

3. **Admin path — keep existing query**: Admins receive all cartelas unchanged.

Resulting handler (pseudocode):
```
if req.user.role === 'admin':
  entries = gcRepo.find({ where: { gameId }, relations: ['userCartela'] })
else:
  entries = gcRepo.find({ where: { gameId, userId: req.user.id }, relations: ['userCartela'] })
res.json({ success: true, data: entries.map(e => ({ ...e.userCartela, betAmount: e.betAmount })) })
```

## Testing Strategy

### Validation Approach

Two-phase approach: first run exploratory tests against the unfixed code to confirm the
data-leakage counterexample, then verify the fix satisfies Property 1 while Property 2
(admin preservation) holds.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples demonstrating that a non-admin user receives another
user's cartela data BEFORE the fix is applied.

**Test Plan**: Seed a game with two distinct users' cartelas, then call the handler as
User A and assert that User B's cartela is present in the response. This should PASS
(i.e., the leak is confirmed) on unfixed code.

**Test Cases**:
1. **Cross-user leak test**: Seed game "g1" with cartelas for userId "u1" and "u2". Call
   handler as "u1". Assert response contains an entry with userId "u2". (confirms bug on
   unfixed code)
2. **Non-participant test**: Call handler as a user with no cartelas in the game. Assert
   response is non-empty on unfixed code (should be empty after fix).
3. **Admin sees all**: Call handler as admin. Assert all cartelas are returned. (should
   pass on both unfixed and fixed code)

**Expected Counterexamples**:
- Response for User A contains entries where `userId !== req.user.id`
- Possible causes: missing `userId` filter in `gcRepo.find`, no role check

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed handler
returns only the requesting user's cartelas.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := cartelasHandler_fixed(input)
  ASSERT result.data.every(entry => entry.userId == input.requestingUser.id)
END FOR
```

### Preservation Checking

**Goal**: Verify that for admin users (where isBugCondition is false), the fixed handler
returns the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT cartelasHandler_original(input) = cartelasHandler_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many game/cartela configurations automatically
- It catches edge cases (empty games, single-user games, many participants)
- It provides strong guarantees that admin behavior is unchanged across all scenarios

**Test Plan**: Observe admin response on unfixed code, then write property-based tests
asserting the same full result set is returned after the fix.

**Test Cases**:
1. **Admin full visibility preservation**: Verify admin receives all cartelas for any game
   configuration after the fix
2. **Other endpoints unaffected**: Verify `/games/mine` and `GET /games` responses are
   identical before and after the fix
3. **Mutation endpoints unaffected**: Verify join/start/finish flows behave identically

### Unit Tests

- Non-admin user receives only their own cartelas when multiple users have joined
- Non-admin user with no cartelas in the game receives an empty array
- Admin user receives all cartelas regardless of userId
- Handler correctly maps `userCartela` relation and `betAmount` onto the response shape

### Property-Based Tests

- Generate random sets of (gameId, userId) cartela entries; assert non-admin response
  contains only entries matching the requesting userId
- Generate random game states with varying numbers of participants; assert admin always
  sees the full set and non-admin always sees only their own subset
- Generate inputs where `isBugCondition` is false (admin requests); assert response equals
  the original unfiltered query result

### Integration Tests

- Full flow: two users join a game, each calls the cartelas endpoint, each receives only
  their own cartela data
- Admin calls the endpoint mid-game and receives all participants' cartelas
- Offline cache scenario: after the fix, IndexedDB is populated only with the requesting
  user's own cartela data
