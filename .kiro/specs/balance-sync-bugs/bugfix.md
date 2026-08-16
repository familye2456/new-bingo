# Bugfix Requirements Document

## Introduction

Two related bugs affect the balance system for prepaid users in the Fidel Bingo application when transitioning from offline to online mode.

**Bug 1 — Game transaction jam:** When a prepaid user creates many games offline (e.g. 100 games) and then comes back online, only a fraction of those games (10–20) successfully sync to the server. The rest are silently abandoned because a single transient network error inside `_doFlush()` breaks out of the entire processing loop, halting all remaining queue items.

**Bug 2 — Balance auto-increase / false revert:** When an offline user returns online, the displayed balance appears to spontaneously increase. This is caused by two compounding mechanisms: (a) offline `claimBingo` adds the prize to the local balance before server confirmation, and (b) when the server later rejects games with `INSUFFICIENT_BALANCE`, each rejection refunds the house-cut back to the local balance — if many games are rejected, these refunds stack up and cause the balance to visibly jump upward before the authoritative server balance is eventually written.

Both bugs are critical because they cause real financial discrepancies between what the user sees and what the server records.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a prepaid user has ≥ 1 offline-created game in the sync queue AND a transient network error occurs while processing any queue item THEN the system stops processing all remaining queue items in that flush cycle, leaving them unsynced.

1.2 WHEN a prepaid user has N offline-created games in the sync queue AND any one game's POST request fails with a network error (no HTTP status) THEN the system breaks out of the flush loop and the remaining (N − position) games are never submitted to the server.

1.3 WHEN a prepaid user claims bingo while offline THEN the system immediately adds the full `prizePool` amount to the local IndexedDB balance and Zustand store before the server has confirmed the win.

1.4 WHEN a prepaid user's offline-created game is rejected by the server with `INSUFFICIENT_BALANCE` THEN the system refunds the house-cut to the local balance; if many games are rejected in sequence, these refunds accumulate and inflate the local balance above what it should be at that point in the sync.

1.5 WHEN a prepaid user returns online and the sync queue still contains pending items THEN `refreshBalance()` skips the server balance fetch entirely, so the inflated local balance is displayed without correction for the entire duration of the flush.

1.6 WHEN the sync queue finishes and `refreshCache()` finally writes the authoritative server balance to IndexedDB THEN the displayed balance visibly jumps (upward or downward) relative to what was shown during the sync, giving the appearance that the balance changed on its own.

---

### Expected Behavior (Correct)

2.1 WHEN a prepaid user has ≥ 1 offline-created game in the sync queue AND a transient network error occurs while processing a queue item THEN the system SHALL stop only the current item and retry it later, but SHALL continue attempting to process subsequent queue items in the same flush cycle (or immediately retry the failed item before moving on).

2.2 WHEN a prepaid user has N offline-created games in the sync queue AND any one game's POST request fails with a network error THEN the system SHALL continue processing the remaining queued games so that all successfully-reachable items are submitted to the server.

2.3 WHEN a prepaid user claims bingo while offline THEN the system SHALL record the pending win locally without crediting the balance, and SHALL only update the local balance after the server confirms the win during sync.

2.4 WHEN a prepaid user's offline-created game is rejected by the server with `INSUFFICIENT_BALANCE` THEN the system SHALL refund the house-cut for that specific game to the local balance, but SHALL NOT allow the cumulative refunded amount to push the displayed balance above the server-confirmed balance once sync completes.

2.5 WHEN a prepaid user returns online and the sync queue contains pending items THEN the system SHALL display a balance that reflects the server-confirmed balance adjusted only by the net pending deductions (house-cuts not yet confirmed by the server), rather than skipping the balance update entirely.

2.6 WHEN the sync queue finishes and `refreshCache()` writes the authoritative server balance THEN the system SHALL transition smoothly to the server balance without a visible upward jump, because the displayed balance during sync SHALL already approximate the final server value.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a prepaid user creates games while online THEN the system SHALL CONTINUE TO deduct the house-cut immediately via the server and reflect the correct balance from the server response.

3.2 WHEN a prepaid user's balance is negative and the account is locked THEN the system SHALL CONTINUE TO block further game creation and SHALL CONTINUE TO preserve the locked state across page reloads via `localStorage`.

3.3 WHEN a prepaid user has zero items in the sync queue and returns online THEN the system SHALL CONTINUE TO fetch the server balance immediately and update the displayed balance without delay.

3.4 WHEN a prepaid user's offline-created game POST is rejected by the server with a permanent HTTP error (e.g. `INSUFFICIENT_BALANCE`, `FORBIDDEN`) THEN the system SHALL CONTINUE TO remove the orphaned offline game, its cartela mappings, and its dependent queue items (finishGame, claimBingo) from IndexedDB.

3.5 WHEN a postpaid user uses the application THEN the system SHALL CONTINUE TO require a live server connection for game creation and SHALL CONTINUE TO not enqueue games to the offline sync queue.

3.6 WHEN the `_flushing` lock is active THEN the system SHALL CONTINUE TO prevent concurrent flush operations from starting.

3.7 WHEN a prepaid user successfully claims bingo online THEN the system SHALL CONTINUE TO add the server-confirmed prize amount to the local balance immediately from the server response.

3.8 WHEN the periodic 30-second sync runs THEN the system SHALL CONTINUE TO call `refreshCache()` and update the balance from the server for users with no pending queue items.

---

## Bug Condition Derivation

### Bug 1: Game Transaction Jam

```pascal
FUNCTION isBugCondition_TransactionJam(flushState)
  INPUT: flushState with fields { queueLength, currentItemIndex, errorType }
  OUTPUT: boolean

  RETURN flushState.queueLength > 1
    AND flushState.currentItemIndex < flushState.queueLength - 1
    AND flushState.errorType = NETWORK_ERROR  // no HTTP status
END FUNCTION
```

```pascal
// Property: Fix Checking — Remaining items processed after network error
FOR ALL flushState WHERE isBugCondition_TransactionJam(flushState) DO
  result ← _doFlush'(flushState)
  ASSERT result.itemsAttempted = flushState.queueLength
    AND result.itemsSkippedDueToNetworkError = 0
END FOR

// Property: Preservation Checking
FOR ALL flushState WHERE NOT isBugCondition_TransactionJam(flushState) DO
  ASSERT _doFlush(flushState) = _doFlush'(flushState)
END FOR
```

### Bug 2: Balance Auto-Increase

```pascal
FUNCTION isBugCondition_BalanceJump(syncEvent)
  INPUT: syncEvent with fields { pendingQueueLength, offlineClaimBingoCount, rejectedGamesCount }
  OUTPUT: boolean

  RETURN (syncEvent.offlineClaimBingoCount > 0 AND syncEvent.pendingQueueLength > 0)
    OR (syncEvent.rejectedGamesCount > 0)
END FUNCTION
```

```pascal
// Property: Fix Checking — Balance does not visibly jump upward after sync
FOR ALL syncEvent WHERE isBugCondition_BalanceJump(syncEvent) DO
  balanceBefore ← displayedBalance(syncEvent.start)
  balanceAfter  ← displayedBalance(syncEvent.end)
  serverBalance ← authoritative_server_balance(syncEvent.end)
  ASSERT balanceAfter = serverBalance
    AND NOT (balanceAfter > balanceBefore AND reason = REFUND_ACCUMULATION)
END FOR

// Property: Preservation Checking
FOR ALL syncEvent WHERE NOT isBugCondition_BalanceJump(syncEvent) DO
  ASSERT displayedBalance_after(syncEvent) = server_balance(syncEvent)
END FOR
```
