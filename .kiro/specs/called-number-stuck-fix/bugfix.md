# Bugfix Requirements Document

## Introduction

During an active bingo game, the auto-call loop permanently freezes mid-game — no new numbers are announced and the game cannot progress without a manual page refresh. The freeze has three distinct root causes, all inside the `startAuto` interval in `PlayBingo.tsx`:

1. The audio queue gate (`audioQueue.playing`) never clears when a sound fails silently, blocking every future tick.
2. The mutation pending flag (`isMutationPendingRef.current`) is never cleared when a server call hangs with an unexpected error, so every tick is skipped indefinitely.
3. The mutation start timestamp is set in two places (inside the interval callback AND inside `mutationFn`), causing the 10-second stuck-detection clock to start before the mutation actually begins — producing false-positive "stuck" alerts that hard-stop the game instead of recovering.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a number sound fails to load (network error, corrupt cache entry) and the `AudioQueue` does not properly clear its `playing` flag THEN the system blocks all subsequent auto-call ticks indefinitely, freezing number progression.

1.2 WHEN a server `callNumber` request hangs or errors with a code other than `429`, `NO_NUMBERS_LEFT`, or `INVALID_STATE` THEN the system leaves `isMutationPendingRef.current` as `true` permanently, causing every future interval tick to be skipped.

1.3 WHEN the interval sets `mutationStartTimeRef.current = Date.now()` before the mutation is actually dispatched (due to React's asynchronous mutation scheduling) THEN the system starts the 10-second timeout clock too early, triggering a false-positive "stuck" alert and hard-stopping the game even though the mutation was not truly stuck.

### Expected Behavior (Correct)

2.1 WHEN a number sound fails to load or the `AudioQueue` encounters any error THEN the system SHALL clear `audioQueue.playing` and allow the auto-call interval to proceed to the next number without freezing.

2.2 WHEN a server `callNumber` request errors with any code not explicitly handled (not `429`, `NO_NUMBERS_LEFT`, or `INVALID_STATE`) THEN the system SHALL clear `isMutationPendingRef.current` so the interval can resume calling numbers on the next tick.

2.3 WHEN the mutation start timestamp is recorded THEN the system SHALL set `mutationStartTimeRef.current` only inside `mutationFn` (where the server call actually begins), not in the interval callback, so the stuck-detection timeout reflects actual mutation duration.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a number sound loads and plays successfully THEN the system SHALL CONTINUE TO wait for the sound to finish before calling the next number.

3.2 WHEN a server `callNumber` request returns `429` (rate limited) THEN the system SHALL CONTINUE TO skip that tick and retry on the next interval without stopping auto-call.

3.3 WHEN a server `callNumber` request returns `NO_NUMBERS_LEFT` or `INVALID_STATE` THEN the system SHALL CONTINUE TO stop auto-call silently without displaying an error.

3.4 WHEN a mutation is genuinely pending (in-flight) THEN the system SHALL CONTINUE TO skip interval ticks until the mutation resolves, preventing duplicate calls.

3.5 WHEN the stuck-detection timeout fires after a genuine hang of 10 seconds THEN the system SHALL CONTINUE TO stop auto-call and alert the user.

3.6 WHEN auto-call is paused or stopped by the user THEN the system SHALL CONTINUE TO halt number progression immediately and play the end sound.
