# House Profit Double-Counting Fix (Online→Offline→Online Scenario)

## Problem
When a prepaid user works **online**, creates a game (house profit 100 Birr), then goes **offline** and comes back **online**, the dashboard shows **double house profit** (200 Birr instead of 100 Birr).

### Detailed Scenario:
1. User is **online** and creates a game
2. System creates offline game `offline-123` (prepaid users always use offline-first mode)
3. House cut (100 Birr) deducted locally
4. Game immediately enqueued for sync
5. Sync runs and posts to server successfully
6. Server creates game `abc-456` and deducts 100 Birr
7. Offline game `offline-123` is deleted from IDB
8. `isSynced('offline-123')` marked as true in localStorage
9. User goes **offline** then back **online**
10. Sync runs again on reconnection
11. **BUG**: Finds `offline-123` still in sync queue
12. Checks `isSynced('offline-123')` → true, so skips re-posting
13. **BUT DOES NOT DELETE THE OFFLINE GAME!**
14. Dashboard shows both `offline-123` and `abc-456`
15. House profit calculated as: 100 + 100 = **200 Birr** ❌

## Root Cause

In `sync.ts`, when a game has already been synced (tracked in localStorage), the sync process dequeues it but **does NOT clean up the offline game from IndexedDB**:

```typescript
// OLD CODE (BUGGY)
if (p.tempId && isSynced(p.tempId)) {
  console.log(`[sync] skipping already-synced createGame tempId=${p.tempId}`);
  await dequeue(current.id!);
  break;  // ← Exits WITHOUT deleting offline game!
}
```

### Why The Offline Game Still Exists:
1. Initial sync deletes the offline game ✅
2. But `refreshCache()` can **restore it** from local cache before it's fully purged
3. Or the sync queue item persists across page reloads/reconnections
4. On subsequent syncs, the offline game is found but skipped
5. No cleanup happens, leaving it in IDB permanently
6. Dashboard sums profit from both offline and server games

## Solution

Modified the sync logic to **clean up offline game even when skipping**:

```typescript
// NEW CODE (FIXED)
if (p.tempId && isSynced(p.tempId)) {
  console.log(`[sync] skipping already-synced createGame tempId=${p.tempId}`);
  // Clean up the offline game even if already synced (may have been left behind)
  if (p.tempId) {
    await dbDelete('games', p.tempId);
    await dbDelete('gameCartelas', p.tempId);
  }
  await dequeue(current.id!);
  break;
}
```

### How It Works Now:
1. Sync finds already-synced game in queue
2. **Deletes offline game from IDB** (cleanup)
3. **Deletes gameCartelas mapping** (cleanup)
4. Dequeues the sync item
5. Dashboard only shows server game
6. House profit calculated correctly: **100 Birr** ✅

## Testing

### Manual Test Steps:

**Setup:**
- User must be prepaid (not postpaid)
- Start with clean state (no pending syncs)

**Test Procedure:**
1. **User is ONLINE**
2. Create a game with 10 Birr bet on 1 cartela (house cut = 1 Birr at 10%)
3. Check dashboard → Should show "Daily Profit: 1 Birr" ✅
4. Open DevTools Console → Look for logs:
   ```
   [sync] flushing 1 queued items
   [sync] posting createGame tempId=offline-...
   [sync] createGame success realId=abc-456
   [myGames] server=1 offline=0 total=1
   ```
5. **Go OFFLINE** (disable network in DevTools)
6. Wait 5 seconds
7. **Go ONLINE** (enable network)
8. Watch console for:
   ```
   [sync] flushing 1 queued items
   [sync] skipping already-synced createGame tempId=offline-...
   [dashboard] Cache refreshed, refetching games
   [myGames] server=1 offline=0 total=1  ← Offline should be 0!
   ```
9. Check dashboard → Should still show "Daily Profit: 1 Birr" ✅ (NOT 2 Birr!)

### Expected Logs (Success):
```
// First sync (immediate after game creation)
[sync] posting createGame tempId=offline-1786914192973 createdAt=2026-08-17T...
[sync] createGame success realId=f4c8e3a1-...
[myGames] server=1 offline=0 total=1

// Second sync (after offline→online)
[sync] skipping already-synced createGame tempId=offline-1786914192973
[dashboard] Cache refreshed, refetching games
[myGames] server=1 offline=0 total=1  ← Still 0 offline games!
```

### Expected Logs (Bug - Before Fix):
```
// First sync
[sync] posting createGame tempId=offline-1786914192973
[sync] createGame success realId=f4c8e3a1-...
[myGames] server=1 offline=0 total=1

// Second sync
[sync] skipping already-synced createGame tempId=offline-1786914192973
[dashboard] Cache refreshed, refetching games
[myGames] server=1 offline=1 total=2  ← BUG: Offline game still there!
```

### Automated Test:
```typescript
describe('House Profit Double-Count Prevention', () => {
  it('should not double-count when reconnecting after initial sync', async () => {
    // Create game online (triggers immediate sync)
    const game = await offlineGameApi.create({
      cartelaIds: ['cartela-1'],
      betAmountPerCartela: 10,
      housePercentage: 10,
    });
    
    // Wait for sync to complete
    await waitForSync();
    
    // Verify game was synced
    const synced = isSynced(game.id);
    expect(synced).toBe(true);
    
    // Simulate offline→online (triggers another sync)
    window.dispatchEvent(new Event('offline'));
    await new Promise(r => setTimeout(r, 100));
    window.dispatchEvent(new Event('online'));
    
    // Wait for second sync
    await waitForSync();
    
    // Get games
    const games = await offlineGameApi.myGames();
    
    // Should only have 1 game (server), not 2 (server + offline)
    expect(games.length).toBe(1);
    expect(games[0].id).not.toStartWith('offline-');
    
    // Calculate profit
    const profit = games.reduce((sum, g) => sum + g.houseCut, 0);
    expect(profit).toBe(1); // Not 2!
  });
});
```

## Files Modified

**fidel-bingo/frontend/src/services/sync.ts**
- Added cleanup logic in the "already synced" branch
- Deletes offline game from IDB even when skipping
- Deletes associated gameCartelas mapping

## Related Fixes

This fix works together with previous fixes:
1. **DAILY_PROFIT_SYNC_FIX** - Preserves original timestamp during sync
2. **DAILY_PROFIT_DUPLICATE_FIX** - Refetches dashboard data after sync
3. **THIS FIX** - Ensures offline games are deleted even when skipped

All three fixes combined ensure:
- ✅ Games appear on correct day
- ✅ No duplicate counting
- ✅ Offline games are always cleaned up
- ✅ Dashboard shows accurate house profit

## Why This Happens for Prepaid Users Only

**Prepaid users**:
- Always create offline-first games (even when online)
- Games are enqueued and synced in background
- Can create many games quickly before sync completes
- Prone to offline games lingering in IDB

**Postpaid users**:
- Post directly to server (no offline games)
- Wait for server response before proceeding
- No sync queue involved
- Not affected by this bug

## Verification Checklist

After deployment:
- [ ] Create game online with prepaid user
- [ ] Verify dashboard shows correct profit
- [ ] Go offline then online
- [ ] Verify dashboard still shows same profit (not doubled)
- [ ] Check console logs for `offline=0` in myGames
- [ ] Verify no offline games remain in IndexedDB after sync

## Status: ✅ READY FOR TESTING
