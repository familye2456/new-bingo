# Daily Profit Incorrect After Sync - Root Cause & Fix

## Problem
When the system syncs offline games to the server, the daily profit shown in the dashboard is incorrect. Games created offline are being recorded with the wrong timestamp on the server.

## Root Cause

### How It Currently Works:
1. **Offline game creation** (`offlineApi.ts` line ~303):
   ```typescript
   const now = new Date().toISOString();
   const game = {
     id: tempId,
     status: 'active',
     betAmount: data.betAmountPerCartela,
     createdAt: now, // ← Offline timestamp recorded
     // ...
   };
   ```

2. **Sync to server** (`sync.ts` line ~175):
   ```typescript
   const res = await api.post('/games', {
     cartelaIds: p.cartelaIds,
     betAmountPerCartela: p.betAmountPerCartela,
     winPattern: p.winPattern,
     housePercentage: p.housePercentage,
     // ❌ createdAt NOT sent to server!
   });
   ```

3. **Server creates game** (backend):
   - Server receives the POST without `createdAt`
   - Server generates `createdAt = new Date()` ← **Current server time, not original offline time**
   - This means a game created offline on Monday might get recorded as Tuesday's game if synced after midnight

4. **Dashboard calculation** (`UserDashboard.tsx` line ~25):
   ```typescript
   function calcStats(games: Game[], days: number) {
     const cutoff = new Date();
     if (days === 1) cutoff.setHours(0, 0, 0, 0); // Midnight today
     // ...
     const f = games.filter((g) => new Date(g.createdAt) >= cutoff);
     const houseCut = f.reduce((s, g) => /* calculate profit */, 0);
     return { totalBet, houseCut, count: f.length };
   }
   ```

### Example Scenario:
- User creates game offline at 11:00 PM Monday
- User comes online and syncs at 12:30 AM Tuesday
- Server creates game with Tuesday's timestamp
- Dashboard shows Monday's profit as 0 Birr (should show the house cut)
- Dashboard shows Tuesday's profit incorrectly (includes Monday's game)

## Solution

### Option 1: Send Original Timestamp to Server (Recommended)
Modify the sync process to preserve the original offline creation timestamp.

**Frontend Changes:**

1. **Store original timestamp in queue payload** (`offlineApi.ts`):
```typescript
// Around line 330 - when enqueueing createGame
await enqueue({
  type: 'createGame',
  payload: {
    cartelaIds: data.cartelaIds,
    betAmountPerCartela: data.betAmountPerCartela,
    winPattern: data.winPattern || 'full',
    housePercentage: HOUSE_PCT,
    tempId,
    createdAt: now, // ← Add this field
  },
});
```

2. **Send timestamp during sync** (`sync.ts` line ~175):
```typescript
const res = await api.post('/games', {
  cartelaIds: p.cartelaIds,
  betAmountPerCartela: p.betAmountPerCartela,
  winPattern: p.winPattern,
  housePercentage: p.housePercentage,
  createdAt: p.createdAt, // ← Add this field
});
```

**Backend Changes:**

3. **Accept and use provided timestamp** (game creation endpoint):
```typescript
// In your game creation handler
const gameData = {
  // ... other fields
  createdAt: req.body.createdAt ? new Date(req.body.createdAt) : new Date(),
  // Use provided timestamp if present, otherwise use current time
};
```

### Option 2: Client-Side Adjustment (Workaround)
If backend changes are not feasible, adjust the dashboard calculation to use offline timestamps from IndexedDB.

**Changes to `UserDashboard.tsx`:**
```typescript
function calcStats(games: Game[], days: number) {
  const cutoff = new Date();
  if (days === 1) cutoff.setHours(0, 0, 0, 0);
  else { cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0); }
  
  const f = games.filter((g) => {
    // Use the original offline createdAt if available from IDB
    const gameDate = new Date(g.createdAt || g.originalCreatedAt);
    return gameDate >= cutoff;
  });
  // ... rest of calculation
}
```

This requires storing `originalCreatedAt` separately in the offline game object and preserving it through sync.

## Recommendation

**Use Option 1** (send original timestamp to server) because:
1. ✅ Maintains data integrity across frontend and backend
2. ✅ All reports and analytics will be accurate
3. ✅ No discrepancy between client and server views
4. ✅ Simpler long-term maintenance

**Avoid Option 2** because:
- ❌ Creates data inconsistency (frontend shows different dates than backend)
- ❌ Backend reports won't match frontend
- ❌ More complex state management
- ❌ Harder to debug issues

## Implementation Steps

1. **Frontend**: Update `offlineApi.ts` to include `createdAt` in queue payload
2. **Frontend**: Update `sync.ts` to send `createdAt` to server
3. **Backend**: Update game creation endpoint to accept and use `createdAt` field
4. **Backend**: Add validation to ensure `createdAt` is not in the future
5. **Testing**: Create offline game, sync after day change, verify dashboard shows correct day's profit

## Testing Checklist

- [ ] Create offline game on Day 1 at 11:59 PM
- [ ] Sync on Day 2 at 12:01 AM
- [ ] Verify dashboard shows profit on Day 1, not Day 2
- [ ] Verify backend database has correct createdAt timestamp
- [ ] Verify daily breakdown table shows game on correct day
- [ ] Test with multiple offline games created at different times
