# Implementation Plan

- [x] 1. Write bug condition exploration tests (BEFORE implementing the fix)
  - **Property 1: Bug Condition** - Game Transaction Jam & Balance Inflation
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms both bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples that demonstrate both bugs exist
  - **Scoped PBT Approach**: Scope Bug 1 property to queues of N items where network error occurs at position K (1 ≤ K < N); scope Bug 2a property to offline bingo claim when server is unreachable
  - Create test file at `fidel-bingo/frontend/src/services/__tests__/balance-sync-bugs.exploration.test.ts`
  - Use `vitest` and `fast-check` (already installed) for property-based testing
  - **Bug 1 — Transaction Jam (Unit)**: Queue 5 `createGame` items in syncQueue IDB; mock `api.post('/games', ...)` to throw a network error (no `response.status`) on item index 2; call `_doFlush()`; assert `api.post` was called exactly 5 times (items 3–4 should still be attempted). _Expect FAILURE: loop breaks at item 2, call count = 2._
  - **Bug 1 — PBT**: `fc.property(fc.integer({ min: 2, max: 10 }), fc.integer({ min: 0, max: N-2 }))` — for all queue sizes N and error positions K < N, assert all N items were attempted. _Expect FAILURE._
  - **Bug 2a — Offline Bingo Credit (Unit)**: Set `navigator.onLine = false`; seed IDB with a game that has `prizePool = 100`; record IDB balance before; call `offlineApi.claimBingo(gameId, cartelaId)`; assert IDB balance is UNCHANGED after the call. _Expect FAILURE: balance increases by 100 immediately._
  - **Bug 2c — RefreshBalance Skips Server (Unit)**: Enqueue 1 `createGame` item; seed IDB user with `balance: 200`; mock `GET /users/me` to return `balance: 500`; call `refreshBalance()`; assert Zustand balance reflects `serverBalance − pendingHouseCuts` (not stale 200). _Expect FAILURE: function returns early without updating._
  - Run tests with `vitest --run` from `fidel-bingo/frontend/`; document the counterexamples printed by fast-check
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 2. Fix `_doFlush()` in `sync.ts` — replace `break` with `continue` and apply bingo credit on confirmation

  - [x] 2.1 Replace `break` with `continue` in the network-error catch branch
    - In `fidel-bingo/frontend/src/services/sync.ts`, function `_doFlush()`
    - Locate the outer catch block at the bottom of the `for (const item of items)` loop
    - Change `else break; // network error — stop, retry later` to `else continue; // network error — skip item, attempt remaining`
    - The failed item is NOT dequeued (it stays for the next flush cycle)
    - _Bug_Condition: isBugCondition_TransactionJam — queue.length > 1 AND currentItemIndex < queue.length - 1 AND error has no response.status_
    - _Expected_Behavior: itemsAttempted === queueLength regardless of which item position fails_
    - _Preservation: HTTP errors (err.response.status truthy) continue to dequeue the item; single-item queues continue to leave the item for retry_
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Apply bingo credit on server confirmation inside `_doFlush()`
    - In the `case 'claimBingo'` branch of `_doFlush()`, after `await api.post(...)` succeeds
    - Read the confirmed amount from the response: `const amount = Number(res.data?.data?.data?.amount ?? 0)`
    - Call `if (amount > 0) { const { adjustBalance } = await import('./db'); await adjustBalance(amount); useAuthStore.getState().adjustUserBalance(amount); }`
    - This mirrors the online path in `offlineApi.claimBingo()` (which already does this correctly for the online case)
    - _Bug_Condition: isBugCondition_BalanceJump — offlineClaimBingoCount > 0 AND pendingQueueLength > 0_
    - _Expected_Behavior: balance is only credited when server confirms the win amount_
    - _Requirements: 2.3_

- [x] 3. Fix `offlineApi.claimBingo()` in `offlineApi.ts` — remove optimistic balance credit

  - [x] 3.1 Remove `await applyBalanceDelta(prize)` from the offline path
    - In `fidel-bingo/frontend/src/services/offlineApi.ts`, function `offlineApi.claimBingo()`
    - In the server-unreachable path (after `result.ok` check fails), locate the `if (prize > 0)` block
    - Remove the `await applyBalanceDelta(prize)` call inside that block
    - Keep the IDB win transaction write (`await dbPut('transactions', { ... })`) and the game state update (`game.isWinner = true`, `game.winnerIds`) — these are needed for the UI to show the win before sync
    - The balance credit will happen in task 2.2 when `_doFlush()` processes the `claimBingo` queue item
    - _Bug_Condition: isBugCondition_BalanceJump — offline bingo claim immediately inflates IDB balance before server confirmation_
    - _Expected_Behavior: IDB balance is unchanged after offline claimBingo; balance updates only after server confirms during sync_
    - _Preservation: Online bingo path (`if (result.ok)`) is completely unchanged — it still calls `applyBalanceDelta(amount)` from the server response_
    - _Requirements: 2.3_

- [x] 4. Fix `refreshBalance()` and `fetchMe()` in `authStore.ts` — use `serverBalance − pendingHouseCuts`

  - [x] 4.1 Fix `refreshBalance()` to compute effective balance instead of skipping
    - In `fidel-bingo/frontend/src/store/authStore.ts`, function `refreshBalance()`
    - Replace the early-return block:
      ```ts
      if (pending.length > 0) {
        console.log(`[balance] refreshBalance skipped — queue not empty`);
        return;
      }
      ```
      with effective balance computation:
      ```ts
      const pendingHouseCuts = pending
        .filter((item: any) => item.type === 'createGame')
        .reduce((sum: number, item: any) => {
          const p = item.payload as any;
          return sum + (p.betAmountPerCartela ?? 0) * (p.cartelaIds?.length ?? 0) * ((p.housePercentage ?? 10) / 100);
        }, 0);
      const effectiveBalance = serverBalance - pendingHouseCuts;
      console.log(`[balance] refreshBalance server=${serverBalance} pendingHouseCuts=${pendingHouseCuts} effective=${effectiveBalance}`);
      const normalized = { ...fresh, balance: effectiveBalance };
      await dbPut('user', normalized, 'me');
      set((state) => ({ user: state.user ? { ...state.user, balance: effectiveBalance } : normalized }));
      if (effectiveBalance < 0 && fresh.paymentType !== 'postpaid' && fresh.role !== 'admin' && fresh.role !== 'agent') {
        applyNegativeBalanceCheck(effectiveBalance, fresh.paymentType, fresh.role, get, (p) => set(p as any));
      }
      return;
      ```
    - _Bug_Condition: isBugCondition_BalanceJump — refreshBalance skips server fetch entirely when queue is non-empty_
    - _Expected_Behavior: displayed balance = serverBalance − sum(pendingHouseCuts for all createGame items in queue)_
    - _Preservation: When pending.length === 0, effectiveBalance === serverBalance — identical to original behavior_
    - _Requirements: 2.5, 2.6_

  - [x] 4.2 Fix `fetchMe()` to use `serverBalance − pendingHouseCuts` instead of stale IDB balance
    - In `fidel-bingo/frontend/src/store/authStore.ts`, function `fetchMe()`
    - Replace:
      ```ts
      const effectiveBalance = hasPending ? idbBalance : serverBalance;
      ```
      with:
      ```ts
      const pendingHouseCuts = pending
        .filter((item: any) => item.type === 'createGame')
        .reduce((sum: number, item: any) => {
          const p = item.payload as any;
          return sum + (p.betAmountPerCartela ?? 0) * (p.cartelaIds?.length ?? 0) * ((p.housePercentage ?? 10) / 100);
        }, 0);
      const effectiveBalance = hasPending ? serverBalance - pendingHouseCuts : serverBalance;
      ```
    - _Bug_Condition: fetchMe uses stale IDB balance when queue is non-empty, causing inflated display_
    - _Expected_Behavior: effectiveBalance = serverBalance − pendingHouseCuts, regardless of queue length_
    - _Preservation: When hasPending is false, effectiveBalance === serverBalance — identical to original_
    - _Requirements: 2.5, 2.6_

- [x] 5. Verify bug condition exploration test now passes (after fix)
  - **Property 1: Expected Behavior** - Transaction Jam & Balance Inflation
  - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
  - Run `vitest --run` from `fidel-bingo/frontend/` targeting the exploration test file
  - **Bug 1 PBT**: For all queue sizes N and error positions K < N, assert `api.post` call count === N (all items attempted). **EXPECTED: PASS**
  - **Bug 2a unit test**: Assert IDB balance is unchanged after offline `claimBingo`. **EXPECTED: PASS**
  - **Bug 2c unit test**: Assert Zustand balance === serverBalance − pendingHouseCuts after `refreshBalance()` with non-empty queue. **EXPECTED: PASS**
  - If any test still fails, revisit the corresponding fix task before proceeding
  - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 6. Write preservation property tests (AFTER fix is verified)
  - **Property 2: Preservation** - Non-Buggy Paths Are Unchanged
  - **IMPORTANT**: Follow observation-first methodology — confirm expected outputs on fixed code before asserting
  - Create test file at `fidel-bingo/frontend/src/services/__tests__/balance-sync-bugs.preservation.test.ts`
  - **Preservation 1 — HTTP Error Cleanup (Unit)**: Queue a `createGame` item; mock `api.post('/games', ...)` to return HTTP 400 `INSUFFICIENT_BALANCE`; call `_doFlush()`; assert: offline game deleted from IDB, `gameCartelas` deleted, offline transactions deleted, dependent queue items removed, houseCut refunded to IDB balance. _Must PASS on fixed code._
  - **Preservation 2 — Empty Queue Balance (Unit)**: Ensure syncQueue is empty; mock `GET /users/me` to return `balance: 300`; call `refreshBalance()`; assert IDB balance === 300 and Zustand balance === 300. _Must PASS._
  - **Preservation 3 — Online Bingo Credit Unchanged (Unit)**: Mock `api.post('/games/{id}/bingo', ...)` to return `{ data: { data: { amount: 150 } } }`; call `offlineApi.claimBingo(gameId, cartelaId)`; assert IDB balance increased by 150. _Must PASS._
  - **Preservation 4 — Flush Lock (Unit)**: Start `flushQueue()`; while it is running, call `flushQueue()` again; assert `_doFlush` internal logic runs only once. _Must PASS._
  - **Preservation 5 — PBT Random Queue Configs**: `fc.property(fc.array(fc.record({ type: fc.constant('createGame'), errorType: fc.oneof(fc.constant('network'), fc.constant('http400'), fc.constant('success')) }), { minLength: 1, maxLength: 20 }))` — assert: items with HTTP errors are dequeued; items with network errors remain in queue; ALL items were attempted regardless of where network errors appear. _Must PASS._
  - **Preservation 6 — PBT Empty Queue Balance Monotonicity**: `fc.property(fc.integer({ min: 0, max: 10_000 }))` — for any server balance with zero pending queue items, assert `refreshBalance()` writes exactly that server balance to IDB and Zustand. _Must PASS._
  - Verify ALL preservation tests PASS on fixed code; if any fail, the fix introduced a regression
  - _Requirements: 3.1, 3.3, 3.4, 3.6, 3.7_

- [x] 7. Checkpoint — Ensure all tests pass
  - Run `vitest --run` from `fidel-bingo/frontend/` to execute both test files
  - All 4 exploration tests (from task 1, now re-run as fix-checking) must PASS
  - All 6 preservation tests (from task 6) must PASS
  - Run `tsc --noEmit` from `fidel-bingo/frontend/` to confirm no TypeScript errors introduced by the changes
  - Verify the three changed files compile cleanly: `sync.ts`, `offlineApi.ts`, `authStore.ts`
  - Ask the user if any questions arise or if manual integration testing is needed
