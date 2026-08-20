# Balance Fixes - Verification Checklist

Use this checklist to verify all fixes are working correctly in your environment.

---

## 🔍 Code Verification (Quick Scan)

### Critical Files Check

- [ ] **sync.ts Line 347**: Contains `else continue;` (NOT `else break;`)
- [ ] **sync.ts Lines 536-572**: `startPeriodicSync()` function exists and is called
- [ ] **sync.ts Lines 43-68**: Server balance is used (check for "SERVER BALANCE is AUTHORITATIVE" comment)
- [ ] **sync.ts Lines 161-168**: Offline game cleanup in already-synced branch
- [ ] **sync.ts Line 177**: Sends `createdAt` to server in POST /games
- [ ] **sync.ts Lines 223-241**: Preserves local numberSequence for prepaid users
- [ ] **sync.ts Lines 308-318**: claimBingo case credits balance on server confirmation
- [ ] **offlineApi.ts Line ~520**: NO `applyBalanceDelta(prize)` in offline claimBingo path
- [ ] **offlineApi.ts Line 311**: `applyBalanceDelta(-houseCut)` for offline game creation (correct)
- [ ] **offlineApi.ts Line 496**: `applyBalanceDelta(amount)` in ONLINE claimBingo path (correct)
- [ ] **authStore.ts Lines 303-338**: `refreshBalance` computes `pendingHouseCuts`
- [ ] **authStore.ts Lines 345-390**: `fetchMe` computes `pendingHouseCuts`
- [ ] **UserDashboard.tsx**: Has `useEffect` listening for `cache-refreshed` event
- [ ] **package.json**: Contains `"test": "vitest"` script

---

## 🧪 Functional Testing

### Test 1: Offline Bingo Credit Deferral ⭐ CRITICAL

- [ ] Create game and play until bingo
- [ ] Go offline (DevTools → Network → Offline)
- [ ] Click "Claim Bingo"
- [ ] Check balance in console/IndexedDB → Should NOT increase
- [ ] Check syncQueue → Should have `claimBingo` item
- [ ] Go online
- [ ] Wait for sync (watch console for `[sync] claimBingo success`)
- [ ] Check balance → Should NOW increase

**Expected:** Balance increases only after server confirms ✅

---

### Test 2: Transaction Jam Fix ⭐ CRITICAL

- [ ] Go offline
- [ ] Create 10 games (can use console for speed)
- [ ] Check syncQueue → Should have 10 items
- [ ] Go online
- [ ] Immediately go offline after 1 second (simulate network hiccup)
- [ ] Go online again
- [ ] Watch console → Should see all 10 games being posted
- [ ] Check syncQueue → Should be empty

**Expected:** All 10 games sync successfully ✅

---

### Test 3: Admin Balance Update ⭐ CRITICAL

- [ ] Login as regular user
- [ ] Note current balance
- [ ] Open admin panel in another tab
- [ ] Admin: Update user balance to different amount
- [ ] Switch back to user tab
- [ ] Wait max 30 seconds (watch for `[sync] Running periodic refresh cache`)
- [ ] Balance should update automatically

**Expected:** Balance updates within 30 seconds without manual refresh ✅

---

### Test 4: Balance During Sync

- [ ] Go offline
- [ ] Create 5 games (10 ETB bet each, 10% house = 5 ETB total pending)
- [ ] Note server balance (e.g., 100 ETB)
- [ ] Go online (triggers sync)
- [ ] Immediately check balance or run `refreshBalance()` in console
- [ ] Watch console for: `[balance] refreshBalance server=100 pendingHouseCuts=5 effective=95`
- [ ] Balance should show 95 ETB (not 100, not stale)
- [ ] After sync completes, balance should be 100 ETB

**Expected:** Balance during sync = serverBalance - pendingHouseCuts ✅

---

### Test 5: No Duplicate Counting

- [ ] Create 1 game offline (house cut = 10 ETB)
- [ ] Dashboard shows "Daily Profit: 10 ETB"
- [ ] Note the offline game ID
- [ ] Go online (triggers sync)
- [ ] Watch console for `[dashboard] Cache refreshed, refetching games`
- [ ] Dashboard should still show "Daily Profit: 10 ETB" (not 20)
- [ ] Check IndexedDB → games → Should only have 1 game (server ID)

**Expected:** No duplicate counting, offline game deleted ✅

---

### Test 6: Correct Day for Offline Games

**Option A (Manual - Timing Sensitive):**
- [ ] Set system clock to 11:58 PM Day 1
- [ ] Go offline
- [ ] Create game at 11:59 PM Day 1
- [ ] Set system clock to 12:01 AM Day 2
- [ ] Go online
- [ ] Dashboard should show game under Day 1, not Day 2

**Option B (Console Log Verification):**
- [ ] Create game offline
- [ ] Go online, watch console during sync
- [ ] Look for: `[sync] posting createGame tempId=... createdAt=2026-08-17T...`
- [ ] Verify `createdAt` matches offline creation time, not current time

**Expected:** Games appear on creation day, not sync day ✅

---

### Test 7: No Double-Count After Reconnect

- [ ] Create 1 game online (it syncs immediately)
- [ ] Dashboard shows "Daily Profit: 10 ETB"
- [ ] Check localStorage → `synced_temp_ids` should contain the game ID
- [ ] Go offline, wait 2 seconds, go online
- [ ] Watch console for: `[sync] skipping already-synced createGame`
- [ ] Dashboard should still show "Daily Profit: 10 ETB" (not 20)

**Expected:** Already-synced games don't cause duplicate counting ✅

---

### Test 8: Prepaid NumberSequence Preservation

- [ ] Login as prepaid user
- [ ] Create game offline
- [ ] Note first few numbers in numberSequence (check IndexedDB)
- [ ] Go online (game syncs)
- [ ] Check game in IndexedDB after sync
- [ ] NumberSequence should be same as before sync

**Expected:** Prepaid users keep their local numberSequence ✅

---

## 🔧 Console Commands for Verification

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
console.log('Queue items:', queue.length, queue);
```

### Check Games (Offline vs Server)
```javascript
const db = await window.indexedDB.open('fidel-bingo', 1);
const tx = db.transaction(['games'], 'readonly');
const games = await tx.objectStore('games').getAll();
console.log('Total games:', games.length);
console.log('Offline games:', games.filter(g => g.id.startsWith('offline-')).length);
console.log('Server games:', games.filter(g => !g.id.startsWith('offline-')).length);
```

### Trigger Manual Sync
```javascript
const { flushQueue } = await import('./src/services/sync.ts');
await flushQueue();
```

### Check Synced IDs
```javascript
console.log('Synced temp IDs:', JSON.parse(localStorage.getItem('synced_temp_ids') || '[]'));
```

### Check if Periodic Sync is Running
```javascript
// Look for console logs every 30 seconds:
// [sync] Running periodic refresh cache
```

---

## 📊 Expected Console Logs

When everything is working correctly:

```
✅ [sync] Starting periodic sync (every 30s)
✅ [sync] Running periodic refresh cache
✅ [balance] Using server balance=500 (locked=false pending=0)
✅ [balance] refreshBalance server=500 pendingHouseCuts=50 effective=450
✅ [sync] flushing 10 queued items
✅ [sync] posting createGame tempId=offline-... createdAt=2026-08-17T...
✅ [sync] createGame success realId=abc-123...
✅ [dashboard] Cache refreshed, refetching games
✅ [myGames] server=10 offline=0 total=10
```

---

## 🚨 Red Flags (Issues to Watch For)

### ❌ Problems That Indicate Bugs

- **Balance increases immediately when claiming bingo offline** → Bug 2a not fixed
- **Only a few games sync (not all)** → Bug 1 not fixed
- **Admin balance update not visible after 30s** → Bug 3 not fixed
- **Balance shows stale IDB value during sync** → Bug 2b/2c not fixed
- **Dashboard shows double profit after sync** → Bug 5 not fixed
- **Games appear on sync day instead of creation day** → Bug 7 not fixed
- **Console shows: `[sync] error: Cannot read property of undefined`** → Check code syntax
- **Console shows: `[balance] refreshBalance` but no `pendingHouseCuts` log** → Fix not applied

---

## 📋 Final Checklist

### Code Review
- [ ] All 14 file checks pass (see top of document)
- [ ] No console errors on page load
- [ ] Periodic sync logs appear every 30 seconds

### Functional Tests
- [ ] Test 1: Offline Bingo Credit ✅
- [ ] Test 2: Transaction Jam ✅
- [ ] Test 3: Admin Balance Update ✅
- [ ] Test 4: Balance During Sync ✅
- [ ] Test 5: No Duplicate Counting ✅
- [ ] Test 6: Correct Day ✅
- [ ] Test 7: No Double-Count Reconnect ✅
- [ ] Test 8: NumberSequence Preservation ✅

### Production Readiness
- [ ] All automated tests pass (`npm test`)
- [ ] No errors in browser console
- [ ] IndexedDB is clean (no orphaned offline games)
- [ ] Balance updates are accurate
- [ ] Daily profit calculations are correct
- [ ] Admin balance updates work
- [ ] Sync logs show correct behavior

---

## 🎯 Success Criteria

**ALL items checked = System is production-ready! ✅**

If any test fails, refer to:
- `ALL_BALANCE_PROBLEMS_FIXED.md` for detailed fix documentation
- `TEST_BALANCE_FIXES.md` for detailed testing instructions
- `BALANCE_FIX_SUMMARY.md` for quick reference

---

**Last Updated:** 2026-08-20  
**Status:** Ready for verification
