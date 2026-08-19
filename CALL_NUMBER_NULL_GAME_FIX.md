# Call Number Null Game Fix

## Problem
The app was crashing with:
```
TypeError: Cannot read properties of null (reading 'id')
at Object.mutationFn (PlayBingo-b330f83d.js:1:2154)
```

This happened when the auto-call feature tried to call a bingo number but the `game` object was null.

## Root Cause
The `callMutation` and `finishMutation` were using `game!.id` with a non-null assertion operator, which doesn't actually prevent runtime errors. When the game data refreshed or changed state (e.g., after syncing offline games), the `game` variable could become null while the auto-call interval was still running.

The component already maintained a `gameRef` that was kept in sync with the `game` state, but the mutations weren't using it.

## Solution
Changed all mutation functions and the auto-call interval to use `gameRef.current` instead of `game`, with proper null guards:

### 1. Fixed `callMutation`
```typescript
const callMutation = useMutation({
  mutationFn: async () => {
    console.log('[callMutation] Starting call...');
    if (!gameRef.current) {
      console.error('[callMutation] Game is null, cannot call number');
      throw new Error('Game is null');
    }
    mutationStartTimeRef.current = Date.now();
    const result = await offlineGameApi.callNumber(gameRef.current.id);
    console.log('[callMutation] Call completed:', result);
    mutationStartTimeRef.current = 0;
    return result;
  },
```

### 2. Fixed `finishMutation`
```typescript
const finishMutation = useMutation({
  mutationFn: () => {
    if (!gameRef.current) throw new Error('Game is null');
    return offlineGameApi.finish(gameRef.current.id);
  },
```

### 3. Fixed `startAuto` interval
Added a guard at the start of each interval tick:
```typescript
autoRef.current = setInterval(() => {
  // Guard against game becoming null during auto-call
  if (!gameRef.current || gameRef.current.status !== 'active') {
    stopAuto(true);
    return;
  }
  // ... rest of the interval logic
}, 500);
```

### 4. Fixed `handleCheck`
Changed to capture `gameRef.current` at the start of the function for consistency:
```typescript
const handleCheck = async () => {
  const num = parseInt(checkId.trim(), 10);
  const currentGame = gameRef.current;
  if (!currentGame || isNaN(num)) return;
  // ... rest uses currentGame
};
```

## Why This Works
- `gameRef.current` always reflects the latest game state
- Explicit null checks prevent the "Cannot read properties of null" error
- Auto-call interval stops gracefully if the game becomes null
- Consistent use of refs prevents race conditions when data refreshes

## Testing
To verify this fix:
1. Create a new game while offline
2. Go online and let it sync
3. Start auto-calling numbers
4. Verify no null reference errors occur
5. Check that the game continues smoothly after sync

## Files Changed
- `fidel-bingo/frontend/src/pages/user/PlayBingo.tsx`
