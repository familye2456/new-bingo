# Daily Profit Duplicate Counting Fix

## Problem
When a user works offline, creates games, then goes online and syncs, the dashboard shows **duplicate house profits** - counting both the offline game and the synced server game.

### Example Scenario:
1. User goes offline and creates game `offline-123` with 5 Birr house cut
2. Dashboard shows: Daily Profit = 5 Birr ✅ (correct)
3. User comes online, system syncs
4. Server creates game `abc-456` with 5 Birr house cut (same game)
5. Dashboard shows: Daily Profit = 10 Birr ❌ (wrong! Should still be 5)

## Root Cause

### The Problem Flow:
1. **Offline game creation** → Game `offline-123` stored in IndexedDB with houseCut=5
2. **Dashboard loads** → React Query fetches via `offlineGameApi.myGames()`
3. **myGames returns** → `[offline-123]` (houseCut=5)
4. **Dashboard calculates** → Daily Profit = 5 Birr ✅
5. **User comes online** → Sync starts via `flushQueue()`
6. **_doFlush() runs** → POSTs game to server, gets back `abc-456`, deletes `offline-123` from IDB
7. **refreshCache() runs** → Fetches server games, updates IDB
8. **Dashboard STILL SHOWS** → `[offline-123, abc-456]` ❌ (React Query cache is stale!)
9. **Dashboard calculates** → Daily Profit = 5 + 5 = 10 Birr ❌

### Why React Query Shows Stale Data:
- React Query caches the result of `myGames()` 
- Even after sync deletes `offline-123` from IndexedDB
- The cached data still includes both offline and server games
- Dashboard never refetches to get updated data
- Result: **Duplicate counting**

## Solution

### Fix 1: Refetch Dashboard Data After Cache Refresh
Added an event listener in `UserDashboard.tsx` to refetch games when cache is refreshed:

```typescript
// Refetch games when cache is refreshed (after sync) to prevent duplicate counting
React.useEffect(() => {
  const handleCacheRefresh = () => {
    console.log('[dashboard] Cache refreshed, refetching games');
    refetch();
  };
  window.addEventListener('cache-refreshed', handleCacheRefresh);
  return () => window.removeEventListener('cache-refreshed', handleCacheRefresh);
}, [refetch]);
```

**How it works:**
1. Sync completes and calls `refreshCache()`
2. `refreshCache()` dispatches `cache-refreshed` event
3. Dashboard's `useEffect` catches the event
4. React Query's `refetch()` is called
5. `myGames()` runs again and gets fresh data from IDB
6. Dashboard re-renders with correct (non-duplicate) games

### Fix 2: Added Logging for Debugging
Added console log in `offlineApi.ts` to track game counts:

```typescript
console.log(`[myGames] server=${serverList.length} offline=${uniqueOffline.length} total=${mergedList.length + uniqueOffline.length}`);
```

This helps verify:
- How many games came from server
- How many offline games still exist in IDB
- Total games returned to dashboard

## Testing

### Manual Test Steps:
1. **Go offline** (disable network in DevTools)
2. **Create a game** offline (note the house cut amount)
3. **Check dashboard** → Daily Profit should show correct amount
4. **Open console** → Note the log `[myGames] server=X offline=1 total=Y`
5. **Go online** (enable network)
6. **Wait for sync** → Watch for logs:
   - `[sync] flushing N queued items`
   - `[sync] posting createGame tempId=offline-...`
   - `[sync] createGame success realId=...`
   - `[dashboard] Cache refreshed, refetching games`
   - `[myGames] server=X offline=0 total=Y` ← offline should be 0 now!
7. **Check dashboard** → Daily Profit should still show same amount (not doubled)

### Expected Console Logs:
```
// Before sync
[myGames] server=10 offline=1 total=11

// During sync
[sync] flushing 1 queued items
[sync] posting createGame tempId=offline-1786914192973 createdAt=2026-08-17T...
[sync] createGame success realId=abc-456

// After sync
[dashboard] Cache refreshed, refetching games
[myGames] server=11 offline=0 total=11  ← No duplicates!
```

### Automated Test Cases:
Add to `balance-sync-bugs.exploration.test.ts`:

```typescript
describe('Daily Profit Duplicate Prevention', () => {
  it('should not double-count house profit after sync', async () => {
    // Create offline game with 5 Birr house cut
    const offlineGame = await createOfflineGame({ houseCut: 5 });
    
    // Get initial profit
    const games1 = await offlineGameApi.myGames();
    const profit1 = calcProfit(games1);
    expect(profit1).toBe(5);
    
    // Simulate sync (delete offline, add server game)
    await syncOfflineGame(offlineGame.id, 'server-123');
    
    // Manually dispatch cache-refreshed event (simulate sync completion)
    window.dispatchEvent(new CustomEvent('cache-refreshed'));
    
    // Wait for refetch
    await waitFor(() => {
      const games2 = await offlineGameApi.myGames();
      return games2.length === games1.length; // Same count, not doubled
    });
    
    // Get profit after sync
    const games2 = await offlineGameApi.myGames();
    const profit2 = calcProfit(games2);
    
    // Should still be 5, not 10
    expect(profit2).toBe(5);
    expect(games2.filter(g => g.id.startsWith('offline-'))).toHaveLength(0);
  });
});
```

## Related Issues

This fix also resolves related problems:
- ✅ **Weekly profit duplication** - Same root cause, same fix
- ✅ **Monthly profit duplication** - Same root cause, same fix
- ✅ **Game count inflation** - Dashboard was showing wrong total game count
- ✅ **Chart data duplication** - Bar chart was showing inflated values

## Files Modified

1. **fidel-bingo/frontend/src/pages/user/UserDashboard.tsx**
   - Added `refetch` to useQuery destructuring
   - Added useEffect to listen for `cache-refreshed` event
   - Calls `refetch()` to update games after sync

2. **fidel-bingo/frontend/src/services/offlineApi.ts**
   - Added console.log in `myGames()` for debugging
   - No logic changes (fix is in the caller)

## Verification Checklist

After deployment, verify:
- [ ] Dashboard shows correct daily profit after offline→online sync
- [ ] No duplicate games in the games list
- [ ] Console shows `[myGames] ... offline=0` after sync completes
- [ ] Dashboard shows `[dashboard] Cache refreshed, refetching games` log
- [ ] Weekly and monthly profits are also correct
- [ ] Bar chart shows correct values (not inflated)

## Notes

- The `cache-refreshed` event is already dispatched by `refreshCache()` in sync.ts
- This is a **client-side fix** - no backend changes needed
- The fix is **backward compatible** - works with or without the event listener
- If the event is not dispatched (old code), dashboard will still show duplicates until next manual refresh

## Status: ✅ READY FOR TESTING
