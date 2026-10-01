# Bugfix Requirements Document

## Introduction

When a user refreshes or reloads the browser page during an active Bingo game, the called number sequence should reset and restart from the beginning. Currently, the sequence does not reset — the previously called numbers persist, so the game continues mid-sequence after reload instead of starting fresh. This affects the `GamePage` (creator/host view) which calls `gameApi.resetGame()` on mount but the backend `resetGame` enforces creator-only authorization, causing the reset to silently fail for non-creator users; and the backend itself clears `calledNumbers` in the DB but does not regenerate or clear the `numberSequence`, so the next call resumes from the old position in the pre-shuffled sequence.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user reloads the game page for an active game THEN the system continues the called number sequence from where it left off, not from the beginning

1.2 WHEN a non-creator user reloads the game page THEN the system ignores the reset request (403 Forbidden) and retains all previously called numbers

1.3 WHEN the creator reloads the game page and `resetGame` succeeds THEN the system clears `calledNumbers` in the database but retains the existing `numberSequence`, causing the next call to resume at the same index in the shuffled sequence (producing numbers that were already called)

### Expected Behavior (Correct)

2.1 WHEN a user reloads the game page for an active game THEN the system SHALL reset the called number sequence to empty and present a fresh board with no called numbers

2.2 WHEN any user (creator or non-creator) reloads the game page THEN the system SHALL reset the displayed called numbers to an empty state for that session

2.3 WHEN the called number sequence is reset THEN the system SHALL also clear or regenerate the `numberSequence` so that subsequent calls start from index 0 of a fresh shuffled sequence

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user calls the next number during an active game (without a reload) THEN the system SHALL CONTINUE TO add numbers sequentially from the current position in the sequence

3.2 WHEN a game transitions from `pending` to `active` status THEN the system SHALL CONTINUE TO start with an empty `calledNumbers` list and a freshly shuffled sequence

3.3 WHEN a user marks a number on their cartela during an active game THEN the system SHALL CONTINUE TO validate and persist the mark correctly regardless of any prior reload

3.4 WHEN a game is finished THEN the system SHALL CONTINUE TO preserve the final `calledNumbers` list for record-keeping

3.5 WHEN the page is reloaded mid-game and the sequence resets THEN the system SHALL CONTINUE TO allow the creator to call numbers starting from the first position of a new sequence

---

## Bug Condition Derivation

**Bug Condition Function:**
```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type GamePageLoadEvent
  OUTPUT: boolean

  RETURN X.isPageReload = true AND X.game.status = 'active'
END FUNCTION
```

**Property: Fix Checking**
```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result ← loadGamePage'(X)
  ASSERT result.displayedCalledNumbers = []
    AND result.game.calledNumbers = []
END FOR
```

**Property: Preservation Checking**
```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
