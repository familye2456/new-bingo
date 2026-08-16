# Balance Sync Bug - Implementation & Testing Guide

## What Was Fixed

### 🔧 **Fix #1: Periodic Sync (CRITICAL)**
**File:** `frontend/src/services/sync.ts`

**What Changed:**
- Added `startPeriodicSync()` function that runs `refreshCache()` every 30 seconds
- Starts automatically on app load
- Stops when going offline, restarts when coming back online
- Catches admin balance updates even for users who never go offline/online

**Why It Matters:**
- **Before:** Admin increases balance → User sees old value indefinitely (unless user goes offline/online)
- **After:** Admin increases balance → User sees new value within 30 seconds automatically

**Code Added:**
```typescript
const PERIODIC_SYNC_INTERVAL = 30_000;  // 30 seconds
let _periodicSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSync() {
  if (_periodicSyncInterval) return;
  _periodicSyncInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    try { 
      await refreshCache(); 
    } catch (err) { 
      console.error('[sync] Periodic sync failed:', err); 
    }
  }, PERIODIC_SYNC_INTERVAL);
}
```

---

### 🔧 **Fix #2: Balance Preservation Logic (CRITICAL)**
**File:** `frontend/src/services/sync.ts` (lines ~45-65)

**What Changed:**
- **Before:** If pending queue existed, used LOCAL balance and ignored SERVER balance
- **After:** Only preserve LOCAL balance if account is LOCKED; otherwise SERVER balance is authoritative

**Why It Matters:**
- **Before:** Admin increases balance → But user has pending games → Local balance used → Admin update lost
- **After:** Admin update applied correctly even if user has pending games to sync

**Code Changed:**
```typescript
// OLD (BUG)
if (isLocked || (pendingQueue.length > 0 && localUser)) {
  if (localUser) meData.balance = localUser.balance;  // Always uses local
}

// NEW (FIXED)
if (isLocked && localUser) {
  // Only preserve if locked
  meData.balance = localUser.balance;
} else if (meData && localUser) {
  // Server balance is authoritative
  const serverBalance = Number(meData.balance ?? 0);
  meData.balance = serverBalance;
}
```

---

### 🔧 **Fix #3: Debounce Reset on Offline**
**File:** `frontend/src/services/sync.ts`

**What Changed:**
- Reset `_lastSync = 0` when going offline
- Ensures sync happens immediately on reconnect (not blocked by 10-second debounce)

**Why It Matters:**
- **Before:** Network flickers → Sync blocked for up to 10 seconds on reconnect
- **After:** Sync happens immediately on reconnect

---

### 🔧 **Fix #4: Start Periodic Sync on App Load**
**File:** `frontend/src/App.tsx`

**What Changed:**
```typescript
// NEW
import('./services/sync').then(({ startPeriodicSync }) => {
  console.log('[App] Starting periodic sync on app load');
  startPeriodicSync();
});
```

**Why It Matters:**
- Ensures periodic sync starts immediately when user opens app
- Catches any balance updates that happened while app was closed

---

## How to Test

### ✅ **Test 1: Admin Updates Balance — User Already Online**

**Setup:**
1. Open admin dashboard in Browser #1
2. Open user account page in Browser #2
3. Note current balance in user page (e.g., "Balance: 1000")

**Test Steps:**
1. Admin: Click "Increase Balance" → Add 500 → Click Submit
2. Admin: Verify new balance shown as 1500 ✓
3. User page: Wait up to 30 seconds
4. **Expected:** User balance updates to 1500 (not 1000)

**Success Criteria:**
- ✅ User sees 1500 within 30 seconds
- ✅ No manual refresh needed
- ✅ Browser console shows `[sync] Running periodic refresh cache` logs

**Failure Scenarios:**
- ❌ User still sees 1000 after 1 minute → Periodic sync not running
- ❌ Balance updates only after manual refresh → Periodic sync interval too long

---

### ✅ **Test 2: Admin Updates Balance — User Comes Online After Change**

**Setup:**
1. Open app in offline mode (DevTools → Network → Offline)
2. User account shows balance: 1000

**Test Steps:**
1. Switch to Admin (different tab/browser)
2. Admin: Increase balance by 500
3. Admin: Verify new balance is 1500 ✓
4. Switch back to User tab
5. Go back to Online (DevTools → Network → Online)
6. **Expected:** User sees 1500 within 10 seconds

**Success Criteria:**
- ✅ Balance updates to 1500 after going online
- ✅ Sync happens immediately (not blocked by debounce)

**Failure Scenarios:**
- ❌ Balance stays 1000 after reconnect → Sync not triggered on 'online' event
- ❌ Sync waits 10+ seconds → Debounce not reset properly

---

### ✅ **Test 3: Pending Games Don't Block Admin Updates**

**Setup:**
1. User has balance: 1000
2. User creates offline game (-500 locally) → Balance shows 500 locally

**Test Steps:**
1. Admin: Increases balance to 2000 (server updated)
2. User: Goes online (sync starts)
3. Sync: Flushes pending game
4. **Expected:** Final balance = 2000 (or 2000-game_cost if game consumed credits)

**Success Criteria:**
- ✅ Admin update (2000) not overwritten by pending game
- ✅ Final balance reflects both: admin increase + game deduction

**Failure Scenarios:**
- ❌ Final balance < 2000 → Admin update lost due to pending queue
- ❌ Final balance shows old value (500) → Server balance not used

---

### ✅ **Test 4: Rapid Network Toggles**

**Setup:**
1. DevTools → Network tab
2. Admin updates balance to 5000

**Test Steps:**
1. Go Offline
2. Go Online (< 1 second) 
3. Go Offline
4. Go Online (< 1 second)
5. Repeat 2-3 more times rapidly
6. **Expected:** Sync triggers on final reconnect, balance updates to 5000

**Success Criteria:**
- ✅ Balance updates after rapid toggles (not blocked by debounce)
- ✅ Browser console shows: `[sync] Offline, resetting debounce timer` then `Back online`

**Failure Scenarios:**
- ❌ Sync blocked due to debounce timer → Debounce reset not working
- ❌ Balance doesn't update → Sync never runs on rapid toggles

---

### ✅ **Test 5: Negative Balance Locked Still Works**

**Setup:**
1. Create scenario where balance goes negative (pending game deduction > actual balance)
2. Account locked with message "Insufficient balance"

**Test Steps:**
1. Admin: Top up balance to 100
2. **Expected:** User still locked initially
3. Admin: Click "Unlock Account"
4. **Expected:** User unlocked, can play with 100 balance

**Success Criteria:**
- ✅ Negative balance lock preserved (not overwritten by admin update)
- ✅ Admin can manually unlock
- ✅ Once unlocked, balance shows correctly

---

### ✅ **Test 6: Console Logging**

**Setup:**
1. Open browser DevTools → Console tab

**Test Steps:**
1. Refresh page
2. **Expected:** See logs:
   ```
   [App] Starting periodic sync on app load
   [sync] Starting periodic sync (every 30s)
   ```
3. Wait 30 seconds
4. **Expected:** See logs:
   ```
   [sync] Running periodic refresh cache
   [sync] Running periodic sync
   [sync] Using server balance=<amount> (locked=false pending=0)
   ```
5. Go offline/online
6. **Expected:** See logs:
   ```
   [sync] Going offline, resetting debounce timer
   [sync] Back online, restarting periodic sync + immediate sync
   ```

---

## Deployment Checklist

- [ ] Verify all changes in `frontend/src/services/sync.ts` are applied
- [ ] Verify all changes in `frontend/src/App.tsx` are applied
- [ ] Build frontend: `npm run build`
- [ ] No TypeScript errors: `npm run tsc`
- [ ] No ESLint errors: `npm run lint`
- [ ] Deploy to staging environment
- [ ] Run Test 1-6 in staging
- [ ] Get client sign-off
- [ ] Deploy to production
- [ ] Monitor server logs for sync errors
- [ ] Monitor browser console for `[sync]` logs
- [ ] Verify with real users

---

## Monitoring

### Browser Console Logs to Watch
```
[sync] Starting periodic sync (every 30s) ← App loaded
[sync] Running periodic refresh cache    ← 30-second interval
[balance] Using server balance=<amount>  ← Balance correctly using server
[cache-refreshed]                        ← Cache update complete
```

### Errors to Watch
```
[sync] Periodic sync failed: <error>     ← Network issue?
[sync] Periodic refresh cache failed     ← Check network tab
```

### Backend Logs to Monitor
```
GET /api/users/me                        ← Frequent refreshes = periodic sync working
PATCH /api/users/:id/balance             ← Admin updates
```

---

## Rollback Plan

If issues occur:

1. **Stop periodic sync (temporarily):**
   ```typescript
   // Comment out in App.tsx
   // import('./services/sync').then(({ startPeriodicSync }) => {
   //   startPeriodicSync();
   // });
   ```

2. **Revert balance preservation change:**
   - Restore original code in sync.ts around line 45-56
   - This reverts to old behavior (may lose admin updates but won't break existing functionality)

3. **Redeploy old frontend build**

---

## Performance Impact

- **Memory:** +1 setTimeout interval (~minimal)
- **Network:** +1 GET `/users/me` per 30 seconds per user (cached by browser)
- **CPU:** Negligible (only runs when online)

**Example:** 1000 users = 2 requests/min = 120 requests/hour = minimal server load

---

## Success Metrics

After deployment, monitor:

1. **User Reports:**
   - "Admin updates balance and I see it immediately" ✓
   - No more "balance shows wrong value" reports ✓

2. **Support Tickets:**
   - Reduction in "balance not syncing" issues ✓

3. **Server Metrics:**
   - No spike in API requests from periodic sync ✓
   - `/users/me` endpoint response time normal ✓

4. **Error Logs:**
   - No new errors from sync mechanism ✓

---

## Questions?

If periodic sync isn't running:
1. Check: Is periodic sync interval too long? (Try 15 seconds for testing)
2. Check: Is user online? (`navigator.onLine` should be true)
3. Check: Are API calls to `/users/me` succeeding? (DevTools → Network)

If balance still not updating:
1. Check: Is admin update actually hitting the backend? (DevTools → Network)
2. Check: Is `refreshCache()` being called? (Browser console)
3. Check: Is Zustand state being updated? (Redux DevTools)

