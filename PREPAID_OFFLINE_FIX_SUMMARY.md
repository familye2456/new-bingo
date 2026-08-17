# Prepaid User Offline Behavior Fix

## Problem Summary

### Original Issue
- Frontend was making API calls to fetch cartelas for offline games (gameId starting with `offline-`)
- Server returned 500 Internal Server Error because offline games don't exist on the server
- Error: `GET https://fidel-bingo.onrender.com/api/games/offline-1786914192973/cartelas 500`

### Additional Requirements
- Prepaid users should ALWAYS fetch cartelas and sounds from IndexedDB, even when online
- Prepaid users should use their locally-generated `numberSequence` even after games sync to server
- Only postpaid users with online games should use server API

## Changes Made

### 1. Fixed `getCartelas` in `offlineApi.ts` (Lines 507-524)

**Before:**
```typescript
getCartelas: async (gameId: string) => {
  const result = await tryApi(() => api.get(`/games/${gameId}/cartelas`));
  // Always tried server first, even for offline games
}
```

**After:**
```typescript
getCartelas: async (gameId: string) => {
  // Prepaid users always fetch from IDB (even when online)
  // Offline games (when system is offline) also use IDB
  const prepaid = await isPrepaid();
  const isOfflineGame = String(gameId).startsWith('offline-');
  
  if (prepaid || isOfflineGame) {
    const cartelaIds = await dbGet<string[]>('gameCartelas', gameId);
    if (!cartelaIds || cartelaIds.length === 0) {
      return { data: { data: [] } };
    }
    const cartelas = await Promise.all(
      cartelaIds.map(id => dbGet('cartelas', id))
    );
    return { data: { data: cartelas.filter(Boolean) } };
  }

  // Postpaid users with online games - fetch from server
  const result = await tryApi(() => api.get(`/games/${gameId}/cartelas`));
  // ... rest of server logic
}
```

### 2. Enhanced `callNumber` in `offlineApi.ts` (Lines 370-390)

**Existing Logic (Already Correct):**
```typescript
callNumber: async (gameId: string) => {
  // Offline games always use local logic
  if (String(gameId).startsWith('offline-')) {
    // Use IDB
  }

  // Online games from server → check if user is prepaid
  const user = await dbGet<any>('user', 'me');
  const isPrepaidUser = !user || user.paymentType !== 'postpaid';

  // Prepaid users → ALWAYS use local cached game (no server call needed)
  if (isPrepaidUser) {
    // Use IDB with local numberSequence
  }

  // Postpaid users → use server (for audit trail / billing)
  const result = await tryApi(() => api.post(`/games/${gameId}/call`));
}
```

This logic was already correct - prepaid users use IDB for calling numbers.

### 3. Fixed Sync to Preserve Local NumberSequence in `sync.ts` (Lines 220-268)

**Problem:**
- When prepaid users create games online, games are synced to server
- Server generates its own `numberSequence`
- Sync was overwriting the local `numberSequence` with server's version
- Prepaid users would then use server's sequence instead of their local one

**Solution:**
```typescript
if (p.tempId) {
  // Preserve the local numberSequence for prepaid users before deleting
  const { dbGet: getFromDb } = await import('./db');
  const user = await getFromDb<any>('user', 'me');
  const isPrepaidUser = !user || user.paymentType !== 'postpaid';
  let localNumberSequence: number[] | undefined;
  
  if (isPrepaidUser) {
    const offlineGame = await getFromDb<any>('games', p.tempId);
    localNumberSequence = offlineGame?.numberSequence;
  }
  
  // Remove offline game from IDB
  await dbDelete('games', p.tempId);

  // ... migrate IDs, transactions, etc ...
  
  // Store local numberSequence back into realGame for prepaid users
  if (isPrepaidUser && localNumberSequence) {
    realGame.numberSequence = localNumberSequence;
  }
}
// Store the real server game (with preserved local sequence for prepaid)
const wasFinished = _justFinishedIds.has(String(realGame.id));
await dbPut('games', wasFinished ? { ...realGame, status: 'finished' } : realGame);
```

## Behavior Matrix

| User Type | Game Type | Cartelas Source | NumberSequence Source | Notes |
|-----------|-----------|----------------|---------------------|-------|
| Prepaid | Online | IDB | IDB (local) | Game created on server, but client uses local data |
| Prepaid | Offline | IDB | IDB (local) | Fully offline, syncs later |
| Postpaid | Online | Server API | Server API | Real-time billing required |
| Postpaid | Offline | IDB | IDB (local) | Falls back to IDB when offline |

## Testing

Created `prepaid-offline-behavior.test.ts` with logic tests covering:

1. ✅ Prepaid users fetch cartelas from IDB (even for online games)
2. ✅ Offline games fetch cartelas from IDB (regardless of user type)
3. ✅ Postpaid users fetch cartelas from server (for online games)
4. ✅ Prepaid users use IDB for calling numbers (even for online games)
5. ✅ Postpaid users use server API for calling numbers (for online games)
6. ✅ Sync preserves local numberSequence for prepaid users
7. ✅ Sync uses server numberSequence for postpaid users

## Impact

### Fixed Issues
- ✅ No more 500 errors when fetching cartelas for offline games
- ✅ Prepaid users always use IDB for cartelas (consistent offline-first behavior)
- ✅ Prepaid users maintain consistent numberSequence across game lifecycle

### No Breaking Changes
- ✅ Postpaid users still use server API as expected
- ✅ Offline games work for all user types
- ✅ Sync process continues to work correctly

## Files Modified

1. `fidel-bingo/frontend/src/services/offlineApi.ts` - Fixed `getCartelas` logic
2. `fidel-bingo/frontend/src/services/sync.ts` - Preserved local numberSequence for prepaid users
3. `fidel-bingo/frontend/src/services/__tests__/prepaid-offline-behavior.test.ts` - Added tests

## Verification Steps

1. **Prepaid user creates game while online:**
   - Game should be created on server ✅
   - Cartelas should be fetched from IDB ✅
   - NumberSequence should be locally generated and preserved after sync ✅

2. **Offline game (any user):**
   - Should not attempt server API call ✅
   - Should use IDB for all operations ✅

3. **Postpaid user with online game:**
   - Should use server API for cartelas ✅
   - Should use server API for calling numbers ✅
