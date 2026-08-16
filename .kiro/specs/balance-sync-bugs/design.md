# Balance Sync Bugs — Bugfix Design

## Overview

Two related bugs corrupt the displayed balance for prepaid users when transitioning from offline to online mode.

**Bug 1 — Game Transaction Jam**: `_doFlush()` in `sync.ts` hits a `break` statement on any network error, abandoning all remaining queue items in that flush cycle. A user who created 100 games offline may see only 10–20 sync after a brief hiccup.

**Bug 2 — Balance Auto-Increase / False Revert**: A cascade of three compounding issues inflates the local balance during sync:
- `offlineApi.claimBingo()` credits the full `prizePool` to local balance _before_ server confirmation.
- Each `INSUFFICIENT_BALANCE` rejection in `_doFlush()` refunds a `houseCut`, and many rejections stack.
- `refreshBalance()` and `fetchMe()` in `authStore.ts` skip the server balance fetch when the queue is non-empty, so the inflated value persists until the queue drains and `refreshCache()` writes the correct server balance — causing a visible jump.

The fix strategy is:
1. Replace the `break` with `continue` (plus an optional per-item retry) so network errors skip only the failing item.
2. Defer the offline bingo credit until server confirmation during sync.
3. Replace the "skip entirely" balance logic with "server balance minus pending deductions" so the displayed value tracks the server throughout the sync.

---

## Glossary

- **Bug_Condition (C)**: The condition that identifies a buggy input — either a network error that would abort the flush loop (Bug 1) or a sync event that would cause the displayed balance to differ from the server-authoritative balance (Bug 2).
- **Property (P)**: The desired correct behavior for inputs where C holds.
- **Preservation**: Behaviors that must remain exactly unchanged after the fix is applied.
- **`_doFlush()`**: The core loop in `fidel-bingo/frontend/src/services/sync.ts` that processes every item in `syncQueue` and posts them to the server.
- **`flushQueue()`**: Public entry point that acquires `_flushing` lock, calls `_doFlush()`, then `refreshCache()`.
- **`refreshCache()`**: In `sync.ts` — fetches authoritative server data and writes it all to IndexedDB + Zustand.
- **`refreshBalance()`**: Lightweight balance-only fetch in `authStore.ts`; currently skips when queue is non-empty.
- **`fetchMe()`**: Full user fetch in `authStore.ts`; currently uses IDB balance when queue is non-empty.
- **`offlineApi.claimBingo()`**: In `offlineApi.ts` — when offline, writes a win transaction and immediately credits `prizePool` to local balance; enqueues a `claimBingo` sync item.
- **`adjustBalance(delta)`**: In `db.ts` — adds `delta` to the cached IDB user balance.
- **`applyBalanceDelta(delta)`**: In `offlineApi.ts` — calls both `adjustBalance()` and `useAuthStore.adjustUserBalance()`.
- **`isBugCondition_TransactionJam`**: Pseudocode predicate identifying Bug 1 inputs (queue has >1 item, current item position < last, error has no HTTP status).
- **`isBugCondition_BalanceJump`**: Pseudocode predicate identifying Bug 2 inputs (offline bingo claims or rejected games exist in the sync state).
- **`pendingHouseCuts`**: The sum of `houseCut` values for all `createGame` items still in the sync queue — these are deductions the server has not yet confirmed but the local balance has already applied.

---

## Bug Details

### Bug 1 — Game Transaction Jam

The bug manifests when any item in `_doFlush()` throws a network error (no `err.response.status`). The `catch` block at the bottom of the `for` loop executes `break`, terminating the entire loop and leaving all subsequent items unprocessed.

**Formal Specification:**
```
FUNCTION isBugCondition_TransactionJam(flushState)
  INPUT: flushState with fields { queueLength, currentItemIndex, errorType }
  OUTPUT: boolean

  RETURN flushState.queueLength > 1
    AND flushState.currentItemIndex < flushState.queueLength - 1
    AND flushState.errorType = NETWORK_ERROR   // err.response.status is undefined
END FUNCTION
```

**Examples:**
- User creates 50 games offline. Item 3 fails with a network timeout. Items 4–50 are never POSTed — _expected: items 4–50 are attempted regardless_.
- Item 1 of 2 succeeds; item 2 fails with a network error; the loop breaks after item 2 — _no additional items abandoned_ (degenerate case where it doesn't matter).
- Item 5 of 100 returns HTTP 400 (`INSUFFICIENT_BALANCE`) — not a network error; existing code correctly discards and continues — _this path is already correct and must be preserved_.

---

### Bug 2 — Balance Auto-Increase

The bug manifests when a prepaid user has any combination of: offline bingo claims pending sync, or games that will be rejected with `INSUFFICIENT_BALANCE` during the next flush.

**Formal Specification:**
```
FUNCTION isBugCondition_BalanceJump(syncEvent)
  INPUT: syncEvent with fields {
    pendingQueueLength,
    offlineClaimBingoCount,
    rejectedGamesCount,
    preSyncDisplayedBalance,
    postSyncServerBalance
  }
  OUTPUT: boolean

  RETURN (syncEvent.offlineClaimBingoCount > 0 AND syncEvent.pendingQueueLength > 0)
    OR (syncEvent.rejectedGamesCount > 0)
END FUNCTION
```

**Examples:**
- User claims bingo offline (prizePool = 100 ETB). Balance immediately shows +100. Server later confirms 90 ETB won. Balance "corrects" visibly — _expected: no credit until server confirms_.
- User creates 10 games offline, returns online with insufficient balance. All 10 are rejected; each refunds its houseCut (+20 ETB each = +200 ETB total). Balance shows inflated value before `refreshCache()` writes the real server balance — _expected: refunds must not push IDB balance above server-authoritative value_.
- User has 5 pending games in queue; `refreshBalance()` is called; queue is non-empty so server balance fetch is skipped entirely — _expected: display server balance minus the sum of pending houseCuts_.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Online prepaid game creation (`offlineApi.create()` when server is reachable) continues to deduct houseCut via the server response and reflect the server balance immediately.
- Permanent HTTP errors during flush (`INSUFFICIENT_BALANCE`, `FORBIDDEN`) continue to remove the orphaned offline game, its `gameCartelas` mapping, offline transactions, and dependent queue items from IDB.
- The `_flushing` lock continues to prevent concurrent flush operations from starting.
- Postpaid users are completely unaffected — they never enqueue games offline.
- When a prepaid user has zero items in the sync queue and calls `refreshBalance()` or `fetchMe()`, the server balance is fetched immediately without any modification.
- Successfully claimed bingo online continues to credit the server-confirmed amount directly from the server response.
- The 30-second periodic sync continues to call `refreshCache()` and update balance for users with no pending queue items.
- The negative-balance lock (`neg_balance_locked`) continues to block game creation after the lock is set and persists across page reloads.

**Scope:**
All interactions that do NOT involve the offline sync queue (`pendingQueueLength == 0`) or offline bingo claims must be completely unaffected by this fix.

---

## Hypothesized Root Cause

### Bug 1

1. **`break` instead of `continue` in catch block**: The catch at the bottom of the `for (const item of items)` loop in `_doFlush()` contains `else break` for network errors. Changing it to `continue` (or skipping the item with a retry counter) would fix the jam.

2. **No per-item retry tracking**: There is no mechanism to retry a single failed item without abandoning the rest. A `failedNetworkItems` set could allow re-queueing just the failed item rather than breaking the whole loop.

### Bug 2

1. **Optimistic bingo credit in `offlineApi.claimBingo()`**: Line `await applyBalanceDelta(prize)` runs immediately when offline, before server confirmation. The fix is to record the claim locally (game state + IDB transaction) without crediting the balance, and apply the credit only when `_doFlush()` processes the `claimBingo` queue item and receives a successful server response.

2. **`refreshBalance()` skips server balance when queue is non-empty**: Instead of returning early, it should compute `serverBalance - pendingHouseCuts` and display that as the effective balance. `pendingHouseCuts` = sum of `houseCut` for all `createGame` items in the queue.

3. **`fetchMe()` uses IDB balance when queue is non-empty**: Same issue — replace `effectiveBalance = idbBalance` with `effectiveBalance = serverBalance - pendingHouseCuts`.

4. **Refund accumulation not bounded**: The existing refund-on-rejection logic in `_doFlush()` is correct in principle (restoring a houseCut that was never charged server-side), but once Bug 2a is fixed and the bingo credit is deferred, and Bug 2b is fixed by anchoring displayed balance to server truth, the net effect of refunds will naturally resolve to the server balance after `refreshCache()`.

---

## Correctness Properties

Property 1: Bug Condition — Remaining Queue Items Processed After Network Error

_For any_ flush state where `isBugCondition_TransactionJam` holds (queue length > 1, current item index < last, and the error has no HTTP status), the fixed `_doFlush'()` SHALL attempt to process ALL remaining queue items after the failing item, so that `itemsAttempted == queueLength` regardless of which item position fails.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — No Balance Inflation After Sync

_For any_ sync event where `isBugCondition_BalanceJump` holds (offline bingo claims exist, or rejected games produce refunds), the fixed sync flow SHALL ensure that the displayed balance at every point during the flush cycle does NOT exceed `serverBalance + pendingHouseCuts`, and SHALL equal `serverBalance` exactly once `refreshCache()` completes.

**Validates: Requirements 2.3, 2.4, 2.5, 2.6**

Property 3: Preservation — Network Errors Do Not Discard Items

_For any_ flush state where the bug condition does NOT hold (single item queue, OR last item in queue, OR a network error occurs on the last remaining item), the fixed `_doFlush'()` SHALL produce the same observable outcome as the original `_doFlush()`: the failing item is left in the queue for a future retry, and no items that succeeded before the error are re-processed.

**Validates: Requirements 3.6**

Property 4: Preservation — HTTP Errors Still Clean Up Orphaned Data

_For any_ `createGame` queue item that receives a permanent HTTP error (status present), the fixed `_doFlush'()` SHALL continue to delete the offline game record, `gameCartelas` mapping, offline transactions, and dependent queue items from IDB, and SHALL refund the houseCut to IDB — identical to the original behavior.

**Validates: Requirements 3.4**

Property 5: Preservation — Empty Queue Balance Fetch Is Unchanged

_For any_ call to `refreshBalance()` or `fetchMe()` where `pendingQueueLength == 0`, the fixed functions SHALL produce exactly the same result as the original functions: the server balance is fetched and written to IDB and Zustand without any modification.

**Validates: Requirements 3.3**

---

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

**File 1**: `fidel-bingo/frontend/src/services/sync.ts`

**Function**: `_doFlush()`

**Specific Changes**:

1. **Replace `break` with `continue`** in the network-error branch of the outer `catch`:
   ```
   // BEFORE
   else break; // network error — stop, retry later

   // AFTER
   else continue; // network error — skip item, attempt remaining items
   ```
   This is the minimal one-line fix for Bug 1. Items that fail with a network error remain in the queue (they are not dequeued) and will be retried on the next flush cycle.

2. **Apply bingo credit only on server confirmation** — in the `claimBingo` case of `_doFlush()`, after `await api.post(...)` succeeds, read the confirmed amount from the response and call `applyBalanceDelta(amount)`. This is the sync-time credit that offlineApi.claimBingo() should no longer do offline.

---

**File 2**: `fidel-bingo/frontend/src/services/offlineApi.ts`

**Function**: `offlineApi.claimBingo()`

**Specific Changes**:

3. **Remove the optimistic balance credit** from the offline path. Keep the game state update (`isWinner`, `winnerIds`) and the IDB win transaction write, but remove the `await applyBalanceDelta(prize)` call. The balance will be credited in `_doFlush()` when the server confirms.

---

**File 3**: `fidel-bingo/frontend/src/store/authStore.ts`

**Functions**: `refreshBalance()`, `fetchMe()`

**Specific Changes**:

4. **Replace "skip when queue non-empty" with "server minus pending deductions"** in both `refreshBalance()` and `fetchMe()`. The new logic:
   ```
   pendingHouseCuts = sum of (betAmountPerCartela * cartelaIds.length * housePercentage/100)
                      for each createGame item in the sync queue
   effectiveBalance = serverBalance - pendingHouseCuts
   ```
   Write `effectiveBalance` to IDB and Zustand. This keeps the displayed balance tightly anchored to the server truth minus only the confirmed-pending deductions.

5. **Handle pending claimBingo items**: If a `claimBingo` item is in the queue (prize not yet server-confirmed), do NOT add its prize to `effectiveBalance`. Since Bug 2a is fixed (offline claimBingo no longer credits the balance), the pending win is already excluded from the IDB balance — no additional adjustment is needed here.

---

## Testing Strategy

### Validation Approach

The strategy follows two phases:

**Phase A — Exploratory (on unfixed code)**: Write tests that reproduce both bugs on the current code. These tests are expected to fail, confirming the root cause hypothesis. Failures become the counterexamples that justify the fix.

**Phase B — Fix + Preservation checking**: After applying the fix, re-run the same tests (now expected to pass), and additionally run preservation tests that generate many random inputs covering the non-buggy domain.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate both bugs BEFORE implementing the fix.

**Test Plan**: Mock `api.post('/games', ...)` to fail with a network error on item K, then assert items K+1..N were still called. Separately, mock `api.post('/games/{id}/bingo', ...)` to fail, trigger an offline claimBingo, and assert the local balance was NOT increased.

**Test Cases**:

1. **Network Error Mid-Queue (Bug 1)**: Queue 5 `createGame` items. Mock item 3 to throw a network error (no `response.status`). Assert `api.post` was called for items 4 and 5. _(will fail on unfixed code — loop breaks at item 3)_

2. **First Item Network Error, Many Remaining (Bug 1)**: Queue 10 items. Mock item 1 to fail with a network error. Assert all 9 remaining items were attempted. _(will fail on unfixed code)_

3. **Offline Bingo Credit (Bug 2a)**: Set server unreachable. Call `offlineApi.claimBingo(gameId, cartelaId)`. Assert IDB balance was NOT changed. _(will fail on unfixed code — balance is credited immediately)_

4. **RefreshBalance Skips Server When Queue Non-Empty (Bug 2c)**: Enqueue 1 `createGame` item. Mock `/users/me` to return `balance: 500`. Call `refreshBalance()`. Assert Zustand balance reflects `500 - pendingHouseCuts` (not the stale IDB value). _(will fail on unfixed code — refreshBalance returns early)_

**Expected Counterexamples**:
- `api.post` call count for items after the failing one is 0 (Bug 1 — loop aborted).
- IDB balance increases by `prizePool` immediately after an offline bingo claim, before any sync (Bug 2a).
- Zustand balance is unchanged after `refreshBalance()` when queue is non-empty (Bug 2c).

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode — Bug 1:**
```
FOR ALL flushState WHERE isBugCondition_TransactionJam(flushState) DO
  callCounts := recordApiCallCounts()
  _doFlush'(flushState)
  ASSERT callCounts.attempted = flushState.queueLength
    AND callCounts.skippedDueToNetworkError = 0
END FOR
```

**Pseudocode — Bug 2:**
```
FOR ALL syncEvent WHERE isBugCondition_BalanceJump(syncEvent) DO
  balanceDuringSync  := captureDisplayedBalanceDuringFlush(syncEvent)
  balanceAfterSync   := displayedBalance(syncEvent.end)
  serverBalance      := authoritative_server_balance(syncEvent.end)

  ASSERT balanceAfterSync = serverBalance
  ASSERT FOR ALL t IN syncEvent.flushTimestamps:
    balanceDuringSync(t) <= serverBalance + pendingHouseCutsAt(t)
END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL flushState WHERE NOT isBugCondition_TransactionJam(flushState) DO
  ASSERT _doFlush(flushState) = _doFlush'(flushState)
END FOR

FOR ALL syncEvent WHERE NOT isBugCondition_BalanceJump(syncEvent) DO
  ASSERT displayedBalance_after(syncEvent) = server_balance(syncEvent)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random queue configurations, automatically covering edge cases.
- It provides strong guarantees that non-buggy paths are unchanged across the full input domain.
- It catches subtle interactions (e.g. mixed network + HTTP errors in the same queue) that manual cases miss.

**Test Cases**:

1. **HTTP Error Cleanup Preserved**: Queue a `createGame` item. Mock server to return HTTP 400 `INSUFFICIENT_BALANCE`. Assert: offline game deleted from IDB, `gameCartelas` deleted, offline transactions deleted, dependent queue items deleted, houseCut refunded to IDB balance. _(same as original)_

2. **Empty Queue — Server Balance Written Immediately**: Queue empty. Mock `/users/me` to return `balance: 300`. Call `refreshBalance()`. Assert IDB and Zustand balance == 300. _(same as original)_

3. **Online Bingo Credit Unchanged**: Mock server to return `amount: 150` from `/games/{id}/bingo`. Call `offlineApi.claimBingo()`. Assert IDB balance += 150. _(same as original)_

4. **`_flushing` Lock Prevents Concurrent Flush**: While `flushQueue()` is running, call `flushQueue()` again. Assert `_doFlush` is invoked only once. _(same as original)_

5. **Property — Random Queue Configs (PBT)**: Generate random queues of 1–20 items with random error patterns (network errors at random positions, HTTP errors at random positions, successes). Assert: all items with HTTP errors are dequeued; all items with network errors remain in queue; all items after a network error were still attempted.

6. **Property — Balance Monotonicity During Sync (PBT)**: Generate random sync events with `pendingQueueLength == 0`. Assert displayed balance after `refreshBalance()` equals server balance in all cases.

---

### Unit Tests

- Test `_doFlush()` with a 3-item queue where item 2 throws a network error: assert item 3 is still attempted.
- Test `_doFlush()` with a 1-item queue that throws a network error: item remains in queue (unchanged behavior).
- Test `offlineApi.claimBingo()` when offline: assert IDB balance is NOT changed; assert `claimBingo` item is enqueued.
- Test `refreshBalance()` with 2 pending `createGame` items: assert displayed balance = serverBalance − sum(houseCuts).
- Test `fetchMe()` with 3 pending items: assert effective balance = serverBalance − pendingHouseCuts (not IDB stale value).
- Test that `claimBingo` in `_doFlush()` applies balance delta on successful server response.

### Property-Based Tests

- Generate N random `createGame` queue items with a network error at position K (1 ≤ K ≤ N); assert items attempted = N regardless of K (fix checking — Bug 1).
- Generate random pending queue contents; assert `effectiveBalance = serverBalance − sum(pendingHouseCuts)` for any queue length ≥ 0 (fix checking — Bug 2).
- Generate random queue configs with no network errors; assert `_doFlush'` and `_doFlush` produce the same dequeue outcomes (preservation — Bug 1).
- Generate random `syncEvent` with `pendingQueueLength == 0`; assert `refreshBalance()` always writes serverBalance to IDB (preservation — Bug 2).

### Integration Tests

- Full offline-to-online flow: create 20 games offline, simulate network error on item 10, assert all 20 items are eventually attempted across two flush cycles.
- Full balance sync flow: create 5 games offline (balance = 500), claim bingo on game 3 offline, come online with 3 rejections; assert displayed balance during sync never exceeds server truth + pending deductions; assert final balance equals server balance.
- Postpaid user integration: verify postpaid game creation path is completely unaffected by all changes.
