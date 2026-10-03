# Bugfix Requirements Document

## Introduction

When auto-call is paused while a number's audio is still playing (mid-sound), resuming replays
the wrong number. Instead of re-announcing the number that was being played at the time of
pause, the system announces the last number that was fully committed to the board — which is one
number behind the paused one. This confuses players who hear a number repeated that was already
fully called, while the number that was interrupted is silently skipped.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN auto-call is paused while number N's audio is still playing (mid-sound) AND the system
    is resumed THEN the system replays the number before N (the last fully-committed board
    number) instead of replaying N.

1.2 WHEN auto-call is paused mid-sound AND `stopAuto` clears `pendingNumberRef.current` to null
    THEN the resume path in `startAuto` sees `pendingNumberRef.current === null` and falls back
    to `sessionCalledNumbers[last]`, which does not include the interrupted number N, so N is
    replayed from the wrong position.

1.3 WHEN the replay from the wrong position completes THEN the system schedules the next NEW
    number call immediately after, meaning number N (the one that was mid-sound at pause time)
    is never announced and is effectively skipped from the session.

### Expected Behavior (Correct)

2.1 WHEN auto-call is paused while number N's audio is still playing (mid-sound) THEN the
    system SHALL preserve N so that on resume it replays N before scheduling any new calls.

2.2 WHEN auto-call is resumed after a mid-sound pause THEN the system SHALL replay number N
    (the number that was being announced at pause time) exactly once before proceeding to new
    calls.

2.3 WHEN the replay of number N completes after a mid-sound-pause resume THEN the system SHALL
    mark N on the board (if not already marked) before scheduling the next new number call.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN auto-call is paused after a number's audio has fully completed (not mid-sound) AND
    resumed THEN the system SHALL CONTINUE TO skip the replay step and proceed directly to
    scheduling the next new number call (no replay of an already-finished sound).

3.2 WHEN auto-call is started on a fresh game (no numbers called yet) THEN the system SHALL
    CONTINUE TO skip the replay step and begin calling new numbers immediately.

3.3 WHEN `stopAuto` is called while a server call is in-flight (not mid-sound) THEN the system
    SHALL CONTINUE TO discard the in-flight result via the `callGen` guard so the number is
    not added to the board.

3.4 WHEN auto-call is paused and resumed multiple times in sequence THEN the system SHALL
    CONTINUE TO replay the correct most-recent number each time and never skip or duplicate
    numbers on the board.

3.5 WHEN `callMutation` returns `null` (all 75 numbers exhausted) THEN the system SHALL
    CONTINUE TO stop auto-call without announcing any number.
