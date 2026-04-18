# Sound System Fix — Bugfix Design

## Overview

The fidel-bingo frontend audio system has ten compounding defects: sounds overlap during
rapid auto-call, number sounds bypass the offline cache, the winner sound is never played,
voice packs are never auto-preloaded, the user-interaction flag is unreliable on mobile,
`notregisterd.m4a` fails on older Android WebViews, URL encoding breaks some nginx
configurations, there is no volume control, auto-call timing ignores sound duration, and
extension logic is duplicated across three files.

The fix introduces a centralized `AudioQueue` class in `db.ts`, routes all playback through
`playCachedSound`, adds winner-sound calls, auto-preloads voice packs, hardens the
interaction-unlock pattern, adds an `.mp3` fallback for the notification sound, normalises
URL encoding, adds a persisted volume setting, gates the next auto-call on `audio.onended`,
and consolidates extension logic into a single `getVoiceExt` in `db.ts`.

---

## Glossary

- **Bug_Condition (C)**: Any of the ten defective input/state combinations described in
  requirements 1.1–1.10 that produce incorrect audio behaviour.
- **Property (P)**: The correct audio behaviour that must hold for each bug condition
  (requirements 2.1–2.10).
- **Preservation**: All existing correct behaviours listed in requirements 3.1–3.7 that
  must remain unchanged after the fix.
- **AudioQueue**: A new class in `db.ts` that serialises sound playback so no two sounds
  overlap.
- **playCachedSound**: The existing function in `db.ts` that plays a sound from network or
  Cache Storage; all playback will be routed through it.
- **getVoiceExt**: The single canonical function in `db.ts` that returns `.wav` or `.mp3`
  for a given voice category.
- **isBugCondition**: Pseudocode predicate that returns `true` when any of the ten defects
  would manifest.
- **_userInteracted**: Module-level flag in `GamePage.tsx` that gates audio; to be replaced
  by a robust capture-phase unlock pattern.

---

## Bug Details

### Bug Condition

The bug manifests across ten distinct conditions in the audio pipeline. The `playNumberSound`
function creates raw `Audio` instances with no queue, bypasses the cache, and uses duplicated
extension logic. The `game_finished` and bingo-claim paths never call `playRootSound('winner.wav')`.
The page never auto-preloads voice packs. The `_userInteracted` flag misses programmatic
navigation and mobile WebViews. `notregisterd.m4a` has codec gaps. URL encoding is
inconsistent. There is no volume API. Auto-call ignores sound duration. Extension logic
exists in four places.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input — { trigger, number?, voice?, context }
  OUTPUT: boolean

  IF trigger = RAPID_NUMBER_CALL AND no AudioQueue exists
    RETURN true   // 1.1 overlap

  IF trigger = NUMBER_CALL AND NOT routedThroughPlayCachedSound
    RETURN true   // 1.2 cache bypass

  IF trigger IN [BINGO_CLAIMED, GAME_FINISHED] AND winner_sound_not_called
    RETURN true   // 1.3 missing winner sound

  IF trigger IN [PAGE_LOAD, VOICE_CHANGED] AND downloadVoiceSounds_not_called
    RETURN true   // 1.4 no auto-preload

  IF trigger = AUDIO_NEEDED AND _userInteracted = false AND no_prior_pointer_or_touch
    RETURN true   // 1.5 fragile flag

  IF trigger = PLAY_NOTREGISTERED AND platform = OLD_ANDROID_WEBVIEW
    RETURN true   // 1.6 m4a codec gap

  IF trigger = BUILD_VOICE_URL AND voice_folder_contains_space
         AND nginx_strict_mode
    RETURN true   // 1.7 URL encoding failure

  IF trigger = VOLUME_CHANGE AND no_volume_state_exists
    RETURN true   // 1.8 no volume control

  IF trigger = AUTO_CALL_TICK AND next_call_before_audio_ends
    RETURN true   // 1.9 timing mismatch

  IF trigger = GET_EXTENSION AND called_from_GamePage_or_store
    RETURN true   // 1.10 duplicated extension logic

  RETURN false
END FUNCTION
```

### Examples

- **1.1** Auto-call fires every 3 s; each `playNumberSound` creates a new `Audio` immediately,
  so numbers 42 and 17 play simultaneously. Expected: 42 finishes, then 17 starts.
- **1.2** Device goes offline; `playNumberSound` calls `new Audio('/sounds/boy sound/7.wav').play()`
  which fails with a network error even though the file is in Cache Storage. Expected: plays
  from cache.
- **1.3** Player clicks "Claim BINGO!" — no winner sound plays. Expected: `winner.wav` plays.
- **1.4** User opens the game page on a fresh install; first number is called before the voice
  pack is cached, so the sound fails. Expected: pack is preloaded on page load.
- **1.5** User navigates to the game page via `router.push` (no click); `_userInteracted`
  stays `false`; all sounds are silently suppressed. Expected: first `pointerdown` or
  `touchstart` anywhere unlocks audio.
- **1.9** `autoCallInterval` = 3 s; sound is 4 s long; next number is announced 1 s before
  the current one finishes. Expected: next call waits for `audio.onended`.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Online number-sound playback must remain immediate and perceptible (Req 3.1).
- `start.wav` must still play when game status transitions to `active` (Req 3.2).
- `aac_resumed.mp3` / `aac_ended.mp3` must still play on auto-call toggle (Req 3.3).
- Voice selection must still persist across reloads via the `game-settings` zustand store (Req 3.4).
- Non-creator players must still hear number sounds via the `number_called` socket event (Req 3.5).
- `downloadVoiceSounds` progress callback must still fire incrementally (Req 3.6).
- `playCachedSound` must still fall back to network for uncached root sounds (Req 3.7).

**Scope:**
All inputs that do NOT match any of the ten bug conditions must be completely unaffected.
This includes:
- Mouse/touch clicks on game buttons.
- Non-number keyboard inputs.
- All socket events other than `game_finished`.
- All store state other than the new `volume` field.

---

## Hypothesized Root Cause

1. **No playback serialisation**: `playNumberSound` calls `new Audio().play()` directly with
   no queue, so concurrent calls produce overlapping audio.

2. **Cache bypass in number sounds**: `playNumberSound` never calls `playCachedSound`; it
   constructs a raw `Audio` URL that requires a live network connection.

3. **Missing winner-sound call sites**: Neither `handleClaimBingo` nor the `game_finished`
   socket handler calls `playRootSound('winner.wav')`.

4. **No auto-preload trigger**: There is no `useEffect` that calls `downloadVoiceSounds` on
   mount or when `voice` changes.

5. **Narrow interaction listeners**: The module-level listeners use `click` and `keydown`
   without `capture: true` and miss `pointerdown` / `touchstart`, so programmatic navigation
   and some mobile WebViews never set `_userInteracted = true`.

6. **Single-format notification sound**: `notregisterd.m4a` has no `.mp3` fallback; older
   Android WebViews lack M4A/AAC codec support.

7. **Inconsistent URL encoding**: `encodeURIComponent` encodes spaces as `%20`; some nginx
   configurations are configured to reject `%20` in path segments and require `+` or a
   server-side alias.

8. **No volume state or API**: Neither `gameSettingsStore` nor any `Audio` instance exposes
   a volume property; there is no UI control.

9. **Wall-clock auto-call timer**: The `setInterval` in the auto-call `useEffect` fires on
   wall-clock time with no reference to `audio.onended`, so the next call can overlap the
   current sound.

10. **Duplicated extension logic**: `voiceExt` in `gameSettingsStore.ts`, `getVoiceExt` in
    `db.ts`, and two inline ternaries in `GamePage.tsx` all independently implement the same
    `'boy sound' ? '.wav' : '.mp3'` branch.

---

## Correctness Properties

Property 1: Bug Condition — Sequential Non-Overlapping Playback

_For any_ sequence of `playNumberSound` calls where the bug condition holds (rapid successive
calls with no queue), the fixed `AudioQueue` SHALL play each sound only after the previous
one has ended, so that no two number sounds overlap simultaneously.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Existing Non-Buggy Audio Behaviour

_For any_ input where the bug condition does NOT hold (online single-call playback, root
sounds, auto-call toggle sounds, start sound), the fixed code SHALL produce exactly the same
audible result as the original code, preserving all existing correct audio behaviour.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7**

---

## Fix Implementation

### Changes Required

**File: `fidel-bingo/frontend/src/services/db.ts`**

1. **Add `AudioQueue` class**: A simple FIFO queue that holds `() => Promise<void>` tasks.
   Each task plays one sound; the queue starts the next task only in the `audio.onended`
   (or `audio.onerror`) callback. Expose a singleton `audioQueue` instance.

   ```
   CLASS AudioQueue
     PRIVATE queue: Array<() => Promise<void>> = []
     PRIVATE playing: boolean = false

     FUNCTION enqueue(task: () => Promise<void>): void
       queue.push(task)
       IF NOT playing THEN drain()

     PRIVATE ASYNC FUNCTION drain(): void
       IF queue.isEmpty() THEN playing = false; RETURN
       playing = true
       task = queue.shift()
       AWAIT task()
       drain()
   END CLASS
   ```

2. **Update `playCachedSound`**: Accept an optional `volume` parameter (0–1, default 1).
   Apply `audio.volume = volume` before `audio.play()`. Return the `HTMLAudioElement` so
   callers can attach `onended`.

3. **Export `getVoiceExt`** (already exists — no change needed). Remove `voiceExt` from
   `gameSettingsStore.ts` and the two inline ternaries from `GamePage.tsx`; all call sites
   import `getVoiceExt` from `db.ts`.

4. **Add `playNumberSoundQueued(number, voice, volume)`**: A new exported function that
   enqueues a `playCachedSound` call via `audioQueue`. This replaces the bare `new Audio()`
   in `GamePage.tsx`.

**File: `fidel-bingo/frontend/src/store/gameSettingsStore.ts`**

5. **Add `volume` state** (number, 0–1, default 1) and `setVolume` action to
   `GameSettingsState`. Include `volume` in the `persist` config so it survives reloads.

6. **Remove `voiceExt`** function; import `getVoiceExt` from `db.ts` at any remaining call
   site.

**File: `fidel-bingo/frontend/src/pages/GamePage.tsx`**

7. **Replace `_userInteracted` unlock pattern**: Remove the module-level `click`/`keydown`
   listeners. Add document-level `pointerdown`, `touchstart`, and `keydown` listeners with
   `{ capture: true, once: true }` that set a module-level `_unlocked` flag and also call
   `new AudioContext().resume()` to satisfy the Web Audio API unlock requirement on iOS.

8. **Replace `playNumberSound`**: Delete the function. Replace all call sites with
   `playNumberSoundQueued(number, voiceRef.current, volumeRef.current)` imported from
   `db.ts`.

9. **Replace `playSound`**: Delete the function. Replace call sites with
   `playCachedSound(url, volumeRef.current)` directly.

10. **Add winner-sound calls**:
    - In `handleClaimBingo`, after the successful `await gameApi.claimBingo(...)`, call
      `playRootSound('winner.wav')`.
    - In the `game_finished` socket handler, call `playRootSound('winner.wav')` before
      `setAutoCall(false)`.

11. **Add auto-preload `useEffect`**: A `useEffect` that depends on `[voice]` and calls
    `downloadVoiceSounds(voice)` (fire-and-forget, no progress needed here).

12. **Fix auto-call timing**: Replace the `setInterval`-based auto-call with a recursive
    `setTimeout` that schedules the next `doCallNumber` only after `audio.onended` fires (or
    after a minimum gap of `autoCallInterval` seconds, whichever is later). The
    `AudioQueue.onDrained` callback or a shared `Promise` from `playNumberSoundQueued` can
    signal completion.

13. **Add `notregisterd` fallback**: Where `notregisterd.m4a` is referenced, use an
    `<audio>` element with `<source src="notregisterd.mp3" type="audio/mpeg">` and
    `<source src="notregisterd.m4a" type="audio/mp4">` as a fallback chain, or supply both
    formats and try `.mp3` first in `playCachedSound`.

14. **Apply volume to all `Audio` instances**: Read `volume` from the store ref and pass it
    to every `playCachedSound` call.

---

## Testing Strategy

### Validation Approach

Testing follows a two-phase approach: first surface counterexamples on the unfixed code to
confirm root-cause hypotheses, then verify the fix and preservation on the fixed code.

### Exploratory Bug Condition Checking

**Goal**: Demonstrate each bug on the unfixed code before implementing the fix. Confirm or
refute the root-cause analysis.

**Test Plan**: Write unit tests that mock `Audio`, `caches`, and socket events, then run
them against the current (unfixed) source to observe failures.

**Test Cases**:
1. **Overlap test**: Call `playNumberSound(1, 'boy sound')` and `playNumberSound(2, 'boy sound')`
   in immediate succession; assert that the second `Audio.play()` is NOT called until the
   first `audio.onended` fires. (Will fail on unfixed code — both play immediately.)
2. **Cache bypass test**: Mock `navigator.onLine = false`; call `playNumberSound(7, 'boy sound')`;
   assert `playCachedSound` was called. (Will fail — raw `new Audio()` is used.)
3. **Winner sound test**: Simulate `game_finished` socket event; assert `playCachedSound`
   was called with `/sounds/winner.wav`. (Will fail — no such call exists.)
4. **Auto-preload test**: Mount `GamePage`; assert `downloadVoiceSounds` was called with the
   active voice. (Will fail — no `useEffect` triggers it.)
5. **Interaction flag test**: Mount `GamePage` without firing any click; dispatch a
   `pointerdown` event; assert `_unlocked` is `true`. (Will fail — only `click` is listened
   to.)

**Expected Counterexamples**:
- Multiple `Audio` instances playing simultaneously (test 1).
- `playCachedSound` never called for number sounds (test 2).
- `winner.wav` never played (test 3).

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces
the correct behaviour.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedAudioPipeline(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Specific assertions after fix**:
- Rapid calls → only one `Audio` active at a time; queue length decreases as sounds end.
- Offline call → `playCachedSound` resolves from Cache Storage blob URL.
- `game_finished` / bingo claim → `playCachedSound('/sounds/winner.wav')` called exactly once.
- Page mount → `downloadVoiceSounds(voice)` called once.
- `pointerdown` → `_unlocked = true`.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code
produces the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalBehaviour(input) = fixedBehaviour(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended because it generates many
random game states and voice configurations automatically, catching edge cases that manual
tests miss.

**Test Cases**:
1. **Online single-call preservation**: For any single `playNumberSound` call while online,
   the fixed code plays the sound with no perceptible delay (same as original).
2. **Root-sound preservation**: `start.wav`, `aac_resumed.mp3`, `aac_ended.mp3` still play
   via `playRootSound` unchanged.
3. **Store persistence preservation**: `voice` and `autoCallInterval` still persist across
   reloads; new `volume` field also persists.
4. **Progress callback preservation**: `downloadVoiceSounds` still fires `onProgress` for
   each file downloaded.

### Unit Tests

- `AudioQueue`: enqueue two tasks; assert second starts only after first resolves.
- `playCachedSound` with volume: assert `audio.volume` equals the passed value.
- `getVoiceExt`: assert returns `.wav` for `'boy sound'` and `.mp3` for all others.
- `playNumberSoundQueued`: assert it calls `audioQueue.enqueue` with a task that calls
  `playCachedSound` with the correct URL.
- Winner-sound call sites: mock `playCachedSound`; trigger bingo claim and `game_finished`;
  assert called with `/sounds/winner.wav`.

### Property-Based Tests

- Generate random sequences of 1–20 number calls; assert the `AudioQueue` plays them in
  order with no overlap (Property 1).
- Generate random non-buggy inputs (single calls, root sounds); assert fixed behaviour
  matches original behaviour (Property 2).
- Generate random volume values (0–1); assert all `Audio` instances receive the correct
  `volume` attribute.

### Integration Tests

- Full game flow: start game → auto-call 5 numbers → claim bingo → assert `winner.wav`
  played after claim.
- Voice change: change voice in settings → assert `downloadVoiceSounds` called with new
  voice.
- Offline flow: preload voice pack → go offline → call number → assert sound plays from
  cache.
- Volume control: set volume to 0.5 → call number → assert `audio.volume === 0.5`.
