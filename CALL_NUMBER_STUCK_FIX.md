# Call Number Stuck Issue - Fix Summary

## Problem
After calling the first bingo number, the system would get stuck and unable to call subsequent numbers.

## Root Cause
The `callMutation.isPending` state was remaining `true` after the first call, preventing any subsequent calls from executing. This was caused by:

1. **Silent error handling**: The `dbPut` function in `db.ts` was catching and ignoring all errors, which could cause promises to never resolve
2. **No timeout protection**: IndexedDB operations could hang indefinitely without any safeguard
3. **No mutation timeout detection**: The UI had no way to detect when a mutation was stuck

## Changes Made

### 1. Fixed `dbPut` function (`db.ts`)
- Added console logging to track operations
- Changed error handling to **re-throw errors** instead of silently ignoring them
- Added **5-second timeout** to prevent hanging indefinitely
- Now uses `Promise.race()` to timeout if IndexedDB hangs

### 2. Enhanced `callNumber` function (`offlineApi.ts`)
- Added comprehensive console logging at each step
- Better tracking of offline vs online vs prepaid vs postpaid flows
- Logs help identify exactly where the function might be hanging

### 3. Added mutation timeout detection (`PlayBingo.tsx`)
- Added `mutationStartTimeRef` to track when mutation starts
- Added `checkMutationTimeout()` function that alerts user if mutation is stuck for >10 seconds
- Reset timer in onSuccess, onError, and onSettled callbacks
- User gets an alert if the system detects a stuck mutation

## How to Debug
When you test the fix, open browser console and watch for these logs:

1. `[callMutation] Starting call...` - Mutation initiated
2. `[offlineApi.callNumber] Starting for gameId: ...` - API function called
3. `[dbPut] Putting to store: games` - IndexedDB write starting
4. `[dbPut] Success` - IndexedDB write completed
5. `[callMutation] onSuccess triggered` - Mutation completed successfully

If you see the logs stop at step 3 or 4, the IndexedDB operation is hanging. The timeout will kick in after 5 seconds and throw an error.

If the mutation is stuck for >10 seconds, you'll see an alert saying "Number calling stuck. Please try again."

## Testing
1. Create a new game
2. Click "Next ›" button to call the first number
3. Immediately click again to call the second number
4. Watch the console logs to see the flow
5. If it works, you should see numbers being called sequentially
6. If it hangs, you'll get the timeout alert

## Next Steps If Issue Persists
If the issue still occurs after this fix, check:
1. Browser console for the exact log where it stops
2. IndexedDB tab in DevTools to see if transactions are pending
3. Consider adding even more aggressive timeout (currently 5s for dbPut, 10s for mutation)
