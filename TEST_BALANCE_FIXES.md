# Balance Fixes - Testing Guide

## Quick Test Script

Run these tests in order to verify all fixes are working:

---

## Test 1: Offline Bingo Credit Deferral ⭐ CRITICAL

**Purpose:** Verify Bug 2a fix - balance should NOT increase until server confirms

**Steps:**
1. Open browser DevTools → Console
2. Open browser DevTools → Application → IndexedDB → fidel-bingo → user
3. Note current balance (e.g., 1000 ETB)
4. Start a game and play until you have bingo
5. **Go offline:** DevTools → Network tab → Throttling → Offline
6. Click "Claim Bingo"
7. **CHECK BALANCE IN CONSOLE:**
   ```
   // Run this in console:
   const db = await window.indexedDB.open('fidel-bingo', 1);
   const tx = db.transaction(['user'], 'readonly');
   const user = await tx.objectStore('user').get('me');
   console.log('Balance:', user.balance);
   ```
8. Balance should still be 1000 ETB (NOT increased) ✅
9. Check IndexedDB → syncQueue → should have `claimBingo` item
10. **Go online:** DevTools → Network tab → Throttling → Online
11. Wait 2-3 seconds for sync
12. Check console for:
    ```
    [sync] processing item id=X type=claimBingo
    [sync] claimBingo success
    ```
13. Check balance again - should NOW show increased amount ✅

**Expected Result:**
- ✅ Balance does NOT increase while offline
- ✅ Balance increases only after server confirms (after going online)

**If Test Fails:**
- ❌ Balance increases immediately → Bug 2a NOT fixed
- Check `offlineApi.ts` line ~520 - should NOT have `applyBalanceDelta(prize)` call

---

## Test 2: Transaction Jam Fix ⭐ CRITICAL

**Purpose:** Verify Bug 1 fix - all games should sync even if one fails with network error

**Steps:**
1. Go offline
2. Create 10 games (use console if needed for speed):
   ```javascript
   for (let i = 0; i < 10; i++) {
     await offlineGameApi.create({
       cartelaIds: ['cartela-id'],
       betAmountPerCartela: 10,
       winPattern: 'any',
       housePercentage: 10
     });
   }
   ```
3. Check IndexedDB → syncQueue → should have 10 items
4. Go online
5. **Immediately** go offline again after 1 second (simulate network hiccup)
6. Go online again
7. Watch console for:
   ```
   [sync] flushing 10 queued items
   [sync] posting createGame tempId=offline-...
   [sync] createGame success realId=...
   ... (should see 10 posts, not stopping after error)
   ```
8. Check syncQueue → should be empty (all processed)

**Expected Result:**
- ✅ All 10 games are eventually synced
- ✅ Network errors don't stop the loop

**If Test Fails:**
- ❌ Only a few games sync → Bug 1 NOT fixed
- Check `sync.ts` line ~347 - should have `continue` not `break`

---

## Test 3: Admin Balance Update ⭐ CRITICAL

**Purpose:** Verify periodic sync catches admin updates

**Steps:**
1. Login as regular user
2. Note current balance (e.g., 100 ETB)
3. Open admin panel in another tab/window
4. Admin: Update user balance to 500 ETB
5. Switch back to user dashboard
6. Wait 30 seconds (watch console for `[sync] Running periodic refresh cache`)
7. Balance should update to 500 ETB automatically

**Expected Result:**
- ✅ Balance updates within 30 seconds without manual refresh

**If Test Fails:**
- ❌ Balance doesn't update → Periodic sync not working
- Check `sync.ts` lines 536-572 - verify `startPeriodicSync()` is defined and called

---

## Test 4: Balance During Sync

**Purpose:** Verify Bug 2b/2c fix - balance shows `serverBalance - pendingHouseCuts` during sync

**Steps:**
1. Go offline
2. Create 5 games (10 ETB bet, 10% house = 1 ETB cut per game)
3. Total pending houseCuts = 5 ETB
4. Server balance = 100 ETB
5. Go online (triggers sync)
6. **IMMEDIATELY** call `refreshBalance()` in console:
   ```javascript
   useAuthStore.getState().refreshBalance();
   ```
7. Watch console for:
   ```
   [balance] refreshBalance server=100 pendingHouseCuts=5 effective=95
   ```
8. Displayed balance should be 95 ETB (not 100, not stale IDB value)
9. After sync completes, balance should be server value (100 ETB)

**Expected Result:**
- ✅ Balance during sync = serverBalance - pendingHouseCuts
- ✅ Balance after sync = serverBalance

**If Test Fails:**
- ❌ Balance shows stale IDB value → Bug 2b/2c NOT fixed
- Check `authStore.ts` lines 303-338 (`refreshBalance`) and 345-390 (`fetchMe`)

---

## Test 5: No Duplicate Counting

**Purpose:** Verify dashboard doesn't double-count games after sync

**Steps:**
1. Create 1 game offline (house cut = 10 ETB)
2. Dashboard should show "Daily Profit: 10 ETB"
3. Note the game ID (e.g., `offline-1234567890`)
4. Go online (triggers sync)
5. Watch console for:
   ```
   [sync] createGame success realId=abc-123...
   [dashboard] Cache refreshed, refetching games
   [myGames] server=1 offline=0 total=1
   ```
6. Dashboard should still show "Daily Profit: 10 ETB" (not 20)
7. Check IndexedDB → games → should only have 1 game (server ID, not offline ID)

**Expected Result:**
- ✅ Offline game is deleted after sync
- ✅ Dashboard shows correct profit (not doubled)

**If Test Fails:**
- ❌ Dashboard shows 20 ETB → Duplicate counting bug
- Check `UserDashboard.tsx` - should have `useEffect` listening for `cache-refreshed` event

---

## Test 6: Correct Day for Offline Games

**Purpose:** Verify games appear on creation day, not sync day

**Manual Test (Timing-Sensitive):**
1. Set system clock to 11:58 PM Monday
2. Go offline
3. Create game at 11:59 PM Monday
4. Set system clock to 12:01 AM Tuesday
5. Go online (sync)
6. Check dashboard → game should appear under Monday, not Tuesday

**Alternative Test (Console Log Verification):**
1. Create game offline
2. Check console/network log during sync:
   ```
   [sync] posting createGame tempId=offline-... createdAt=2026-08-17T23:59:00.000Z
   ```
3. Verify `createdAt` matches offline creation time, not sync time

**Expected Result:**
- ✅ Games appear on correct creation day

**If Test Fails:**
- ❌ Games appear on sync day → Timestamp not preserved
- Check `offlineApi.ts` (enqueue with `createdAt`) and `sync.ts` (send `createdAt` to server)
- Check backend `GameService.ts` (accept and use `createdAt`)

---

## Test 7: No Double-Count After Reconnect

**Purpose:** Verify already-synced games don't reappear after offline→online

**Steps:**
1. Create 1 game online (it syncs immediately)
2. Check dashboard → Daily Profit = 10 ETB
3. Check localStorage → should have entry in `synced_temp_ids`
4. Go offline, wait 2 seconds, go online
5. Watch console for:
   ```
   [sync] skipping already-synced createGame tempId=offline-...
   [dashboard] Cache refreshed, refetching games
   ```
6. Check dashboard → Daily Profit should still be 10 ETB (not 20)

**Expected Result:**
- ✅ Already-synced games are skipped and cleaned up
- ✅ No duplicate profit counting

**If Test Fails:**
- ❌ Daily Profit = 20 ETB → Double-count bug
- Check `sync.ts` lines 161-168 - should delete offline game even when skipping

---

## Automated Test Run

If you want to run the automated tests:

```bash
cd fidel-bingo/frontend
npm test
```

Look for:
- `balance-sync-bugs.exploration.test.ts` - These tests verify Bugs 1, 2a, 2c

**Important:** These tests are designed to FAIL on unfixed code. If they PASS, the bugs are fixed! ✅

---

## Console Verification Commands

Run these in browser console to check current state:

### Check Balance
```javascript
const db = await window.indexedDB.open('fidel-bingo', 1);
const tx = db.transaction(['user'], 'readonly');
const user = await tx.objectStore('user').get('me');
console.log('Balance:', user.balance);
```

### Check Sync Queue
```javascript
const db = await window.indexedDB.open('fidel-bingo', 1);
const tx = db.transaction(['syncQueue'], 'readonly');
const queue = await tx.objectStore('syncQueue').getAll();
console.log('Queue:', queue);
```

### Check Games
```javascript
const db = await window.indexedDB.open('fidel-bingo', 1);
const tx = db.transaction(['games'], 'readonly');
const games = await tx.objectStore('games').getAll();
console.log('Games:', games);
console.log('Offline games:', games.filter(g => g.id.startsWith('offline-')));
```

### Trigger Manual Sync
```javascript
// Force immediate sync (bypass debounce)
const { flushQueue } = await import('./src/services/sync');
await flushQueue();
```

### Check Synced IDs
```javascript
console.log('Synced IDs:', localStorage.getItem('synced_temp_ids'));
```

---

## Success Criteria

All tests pass = All balance problems fixed ✅

| Test | Status | Expected Log |
|------|--------|--------------|
| Offline Bingo Credit | ✅ | Balance unchanged until sync |
| Transaction Jam | ✅ | All games attempted |
| Admin Balance Update | ✅ | Balance updates within 30s |
| Balance During Sync | ✅ | `effective=serverBalance-pending` |
| No Duplicate Counting | ✅ | `offline=0` after sync |
| Correct Day | ✅ | `createdAt` sent to server |
| No Double-Count Reconnect | ✅ | Offline game deleted when skipped |

---

## Troubleshooting

### If tests fail:

1. **Check file versions:**
   - `sync.ts` should have `continue` at line 347
   - `offlineApi.ts` should NOT have `applyBalanceDelta` in offline claimBingo path
   - `authStore.ts` `refreshBalance` should compute `pendingHouseCuts`

2. **Clear cache and reload:**
   ```javascript
   localStorage.clear();
   // Then reload page
   ```

3. **Check browser console for errors:**
   - Look for sync errors
   - Look for API call failures
   - Look for balance calculation logs

4. **Verify IndexedDB state:**
   - DevTools → Application → IndexedDB
   - Check `user`, `games`, `syncQueue`, `transactions`

5. **Check network tab:**
   - Verify API calls are being made
   - Verify `/users/me` is called every 30 seconds
   - Verify `/games` POST includes `createdAt`

---

## Production Checklist

Before deploying:
- [ ] All 7 manual tests pass
- [ ] Automated tests pass
- [ ] No errors in browser console
- [ ] IndexedDB is clean (no orphaned offline games)
- [ ] Periodic sync is running (check console every 30s)
- [ ] Admin balance updates are reflected
- [ ] Daily profit calculations are correct

**Last Updated:** 2026-08-20
