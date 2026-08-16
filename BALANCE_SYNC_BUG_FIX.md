# Balance Sync Issues - Critical Bug Report

## Problems Identified

### 🔴 **Issue #1: Admin Balance Update Not Syncing to Frontend**
**Severity:** CRITICAL  
**Location:** Frontend caching + sync logic  

**Symptom:**
- Admin increases/decreases balance via admin page → Server shows 2000
- User frontend shows old cached value → 11000
- Discrepancy persists even after user comes online

**Root Cause:**
The frontend caches user data (including balance) in IndexedDB when user logs in. When admin updates the balance on the backend, the frontend:
1. Doesn't get real-time notifications of admin changes
2. Only syncs when `flushQueue()` is called (on 'online' event)
3. If user is already online, no 'online' event fires, so sync doesn't happen
4. User sees stale cached balance indefinitely

**Code Flow:**
```
Admin: PATCH /api/users/:id/balance → balance = 2000 ✓ (server updated)
User Frontend: Cached in IDB → balance = 11000 (old)
User status: Already online → NO 'online' event fires
Result: User never syncs → sees 11000 forever
```

---

### 🔴 **Issue #2: No Automatic Balance Sync for Already-Online Users**
**Severity:** CRITICAL  
**Location:** `sync.ts` - missing periodic sync

**Problem:**
The current sync logic relies on:
```typescript
window.addEventListener('online', debouncedSync);
```

This only triggers when transitioning from **offline → online**.

If user is already online when admin updates balance:
- No 'online' event fires
- `debouncedSync()` never called
- `flushQueue()` never called
- `refreshCache()` never runs
- User balance stays stale indefinitely

**Solution:** Need periodic sync even when already online, OR push notifications for admin updates.

---

### 🟡 **Issue #3: Balance Lock Logic May Interfere**
**Severity:** HIGH  
**Location:** `sync.ts:50-56`

```typescript
const isLocked = localStorage.getItem('neg_balance_locked') === '1';
if (isLocked || (pendingQueue.length > 0 && localUser)) {
  if (localUser) meData.balance = localUser.balance;  // ← USES LOCAL, NOT SERVER
  console.log(`[balance] refreshCache server=${meData?.balance} locked=${isLocked} pending=${pendingQueue.length}`);
}
```

**Problem:**
- If there are pending queue items (games to sync), the code **ignores server balance** and uses local balance
- If admin updated balance but user has pending games, admin update is lost
- This is too aggressive — server should be source of truth for balance

**Example:**
1. User creates offline game → $50 deducted locally
2. Admin tops up account → +$100 on server
3. User comes online
4. Code sees: `pendingQueue.length > 0` → uses local balance instead of server
5. Admin's top-up lost!

---

### 🟡 **Issue #4: Debounce Logic May Prevent Multiple Syncs**
**Severity:** MEDIUM  
**Location:** `sync.ts:475-479`

```typescript
// Debounce — don't sync more than once per 10 seconds
let _lastSync = 0;
function debouncedSync() {
  const now = Date.now();
  if (now - _lastSync < 10_000) return;  // ← Blocks sync < 10 sec apart
  _lastSync = now;
  syncWhenOnline();
}
```

**Problem:**
- If user reconnects multiple times within 10 seconds, sync is blocked
- Broken wifi (connects/disconnects) = no sync for missed updates
- Admin updates won't sync if less than 10 seconds between reconnects

---

## Fixes Required

### ✅ **Fix #1: Add Periodic Sync Even When Already Online**

**File:** `sync.ts`

```typescript
// Periodic sync every 30 seconds (or configurable)
const PERIODIC_SYNC_INTERVAL = 30_000;  // 30 seconds
let _periodicSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSync() {
  if (_periodicSyncInterval) return;  // Already running
  
  _periodicSyncInterval = setInterval(async () => {
    if (!navigator.onLine) return;  // Skip if offline
    
    console.log('[sync] Running periodic sync');
    try {
      // Just refresh cache, don't flush queue every time (expensive)
      await refreshCache();
    } catch (err) {
      console.error('[sync] Periodic sync failed:', err);
    }
  }, PERIODIC_SYNC_INTERVAL);
}

export function stopPeriodicSync() {
  if (_periodicSyncInterval) {
    clearInterval(_periodicSyncInterval);
    _periodicSyncInterval = null;
  }
}

// Start periodic sync on app load
if (typeof window !== 'undefined') {
  // Start immediately
  startPeriodicSync();
  
  // Stop when offline, restart when online
  window.addEventListener('offline', () => {
    console.log('[sync] Going offline, stopping periodic sync');
    stopPeriodicSync();
  });
  
  window.addEventListener('online', () => {
    console.log('[sync] Back online, restarting periodic sync');
    startPeriodicSync();
    debouncedSync();  // Also do immediate sync
  });
}
```

**Call this from App.tsx:**
```typescript
useEffect(() => {
  import('../services/sync').then(({ startPeriodicSync }) => {
    startPeriodicSync();
  });
}, []);
```

---

### ✅ **Fix #2: Fix Balance Preservation Logic**

**File:** `sync.ts`

Replace the problematic logic at line 50-56:

```typescript
// CURRENT (BUG)
const isLocked = localStorage.getItem('neg_balance_locked') === '1';
if (isLocked || (pendingQueue.length > 0 && localUser)) {
  if (localUser) meData.balance = localUser.balance;  // ← Overwrites server with local
  console.log(`[balance] refreshCache server=${meData?.balance} locked=${isLocked} pending=${pendingQueue.length}`);
}

// FIXED
const isLocked = localStorage.getItem('neg_balance_locked') === '1';

// Only preserve local balance if LOCKED (negative balance scenario)
// Otherwise, always trust the server for balance
if (isLocked && localUser) {
  // Account is locked due to negative balance
  // Preserve local balance to keep player blocked until admin resolves it
  meData.balance = localUser.balance;
  console.log(`[balance] refreshCache locked=${isLocked}, preserving local balance=${meData.balance}`);
} else if (meData) {
  // Account is NOT locked — server balance is authoritative
  // Even if there are pending games, use server balance
  // Pending games affect local temporary balance, not permanent balance
  const serverBalance = Number(meData.balance ?? 0);
  if (localUser) {
    // Update local cache with server balance
    await dbPut('user', { ...localUser, balance: serverBalance }, 'me');
  }
  console.log(`[balance] refreshCache using server balance=${serverBalance} pending=${pendingQueue.length}`);
}
```

---

### ✅ **Fix #3: Improve Debounce to Retry on Reconnect**

**File:** `sync.ts`

```typescript
// Debounce — don't sync more than once per 10 seconds,
// BUT reset timer on reconnect to ensure sync happens after network change
let _lastSync = 0;
function debouncedSync() {
  const now = Date.now();
  if (now - _lastSync < 10_000) {
    console.log('[sync] Debounced (< 10s since last sync)');
    return;
  }
  _lastSync = now;
  console.log('[sync] Running debouncedSync');
  syncWhenOnline();
}

// Reset debounce timer on network status changes
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    _lastSync = 0;  // Reset timer when going offline
    console.log('[sync] Offline, resetting debounce timer');
  });
}
```

---

### ✅ **Fix #4: Add Manual Sync Trigger for Admin Updates**

**File:** `frontend/src/pages/admin/UserDetail.tsx` (or similar admin page that updates balance)

```typescript
// After admin updates balance
const updateUserBalance = async (userId: string, amount: number) => {
  try {
    await adminApi.topUpBalance(userId, amount);
    
    // Trigger immediate sync to pull updated data
    // If it's the current user, also refresh locally
    const { user } = useAuthStore.getState();
    if (user?.id === userId) {
      // Refresh current user's balance immediately
      await useAuthStore.getState().refreshBalance();
      
      // Also trigger full cache refresh
      import('../services/sync').then(({ flushQueue }) => {
        flushQueue().catch(console.error);
      });
    }
    
    // For other users, just refetch their data
    queryClient.invalidateQueries({ queryKey: ['user', userId] });
  } catch (err) {
    console.error('Failed to update balance:', err);
  }
};
```

---

### ✅ **Fix #5: Add Real-Time Balance Notification (Optional)**

If you want real-time updates without polling, use WebSocket:

**File:** `backend/src/modules/game/infrastructure/GameGateway.ts`

```typescript
// Emit balance update event when admin modifies balance
io.to(`user:${userId}`).emit('balance_updated', { 
  balance: updatedUser.balance,
  timestamp: new Date(),
  reason: 'admin_adjustment'
});
```

**File:** `frontend/src/services/socket.ts`

```typescript
export const getSocket = (token?: string): Socket => {
  // ... existing code ...
  
  socket.on('balance_updated', (data: { balance: number; reason: string }) => {
    console.log(`[socket] Balance updated: ${data.balance} (${data.reason})`);
    // Update IndexedDB and Zustand
    import('./db').then(({ dbPut, dbGet }) => {
      dbGet<any>('user', 'me').then(user => {
        if (user) {
          dbPut('user', { ...user, balance: data.balance }, 'me');
          useAuthStore.getState().adjustUserBalance(data.balance - (Number(useAuthStore.getState().user?.balance) || 0));
        }
      });
    });
  });
  
  return socket;
};
```

---

### ✅ **Fix #6: Ensure refreshCache Actually Updates Balance in Zustand**

**File:** `sync.ts` at end of `refreshCache()`

```typescript
export async function refreshCache() {
  try {
    const requests: Promise<any>[] = [
      api.get('/users/me'),
      api.get('/cartelas/mine'),
      api.get('/games/mine'),
      api.get('/users/me/transactions'),
    ];

    const [meRes, cartelasRes, gamesRes, txRes] = await Promise.all(requests);
    const meData = meRes.data?.data ?? meRes.data;

    // ... existing balance preservation logic ...
    
    await dbPut('user', meData, 'me');

    // ⭐ FIX: Update Zustand store to reflect server balance
    if (meData?.id) {
      const newBalance = Number(meData.balance);
      const oldBalance = Number(useAuthStore.getState().user?.balance || 0);
      const delta = newBalance - oldBalance;
      
      console.log(`[sync] Updating balance: ${oldBalance} → ${newBalance}`);
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, balance: newBalance } : state.user,
      }));
      useAuthStore.getState().adjustUserBalance(delta);
    }

    // ... rest of refresh ...
    
    window.dispatchEvent(new CustomEvent('cache-refreshed'));
  } catch (err) {
    console.error('[sync] refreshCache failed:', err);
    // Don't throw — continue even if refresh fails
  }
}
```

---

## Summary of Changes

| Fix | Priority | Impact | Effort |
|-----|----------|--------|--------|
| Add periodic sync (every 30s) | 🔴 CRITICAL | Catches admin updates automatically | 30 min |
| Fix balance preservation logic | 🔴 CRITICAL | Prevents admin updates from being lost | 20 min |
| Improve debounce on reconnect | 🟡 HIGH | Ensures sync after network changes | 15 min |
| Add manual sync trigger in admin | 🟡 HIGH | Immediate feedback for admin updates | 20 min |
| Real-time WebSocket updates | 🟢 OPTIONAL | Instant balance sync (nice-to-have) | 1-2 hrs |
| Ensure Zustand updates | 🟡 HIGH | UI shows correct balance immediately | 20 min |

---

## Testing Checklist

```bash
# Test 1: Admin updates balance while user is already online
[ ] Open admin page
[ ] Open user account in another tab
[ ] Admin: Increase balance to 2000
[ ] User tab: Observe balance update to 2000 (within 30 seconds)

# Test 2: Admin updates balance while user is offline
[ ] Close browser or disconnect network
[ ] Admin: Increase balance to 2000
[ ] Reconnect to network
[ ] Observe balance immediately updates to 2000

# Test 3: Multiple rapid reconnects
[ ] Rapidly toggle network on/off 3-4 times (< 10 seconds apart)
[ ] Admin updates balance
[ ] Verify sync completes after reconnect (not blocked by debounce)

# Test 4: Pending games don't block balance update
[ ] Create offline game (-$50)
[ ] Go online while sync still processing
[ ] Admin updates balance to +$100
[ ] Verify final balance reflects both pending deduction and admin addition

# Test 5: Locked negative balance preserved
[ ] Create scenario with negative balance (balance < 0)
[ ] Balance should lock
[ ] Admin tops up to +$50
[ ] Verify balance updates correctly and user can play again
```

---

## Configuration

```bash
# Add to frontend .env or constants
VITE_PERIODIC_SYNC_INTERVAL=30000    # 30 seconds (ms)
VITE_SYNC_DEBOUNCE_DELAY=10000       # 10 seconds (ms)
```

---

## Deployment Steps

1. **Deploy Backend First** (no changes needed)
2. **Deploy Frontend Changes:**
   - Update `sync.ts` with periodic sync + balance fix
   - Update `App.tsx` to start periodic sync
   - Update admin pages to trigger manual sync
   - Optional: Update `GameGateway.ts` + `socket.ts` for real-time updates

3. **Test in staging** before production

4. **Monitor logs** for sync errors:
   ```bash
   # Frontend console
   [sync] Running periodic sync
   [sync] Updating balance: 11000 → 2000
   ```

