# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Sound System Ten-Defect Exploration
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples that demonstrate each of the ten defects
  - **Scoped PBT Approach**: Scope each property to the concrete failing case(s) for reproducibility
  - Test 1.1 — Overlap: call `playNumberSound(1, 'boy sound')` then `playNumberSound(2, 'boy sound')` immediately; assert second `Audio.play()` is NOT called until first `audio.onended` fires. Will FAIL — both play at once.
  - Test 1.2 — Cache bypass: mock `navigator.onLine = false`; call `playNumberSound(7, 'boy sound')`; assert `playCachedSound` was called. Will FAIL — raw `new Audio()` is used.
  - Test 1.3 — Missing winner sound: simulate `game_finished` socket event and `handleClaimBingo`; assert `playCachedSound` called with `/sounds/winner.wav`. Will FAIL — no such call exists.
  - Test 1.4 — No auto-preload: mount `GamePage`; assert `downloadVoiceSounds` called with active voice. Will FAIL — no `useEffect` triggers it.
  - Test 1.5 — Fragile flag: mount `GamePage` without click; dispatch `pointerdown`; assert audio unlock flag is `true`. Will FAIL — only `click` is listened to.
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Correct Audio Behaviour
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs first
  - Observe: single online `playNumberSound` call plays immediately (Req 3.1)
  - Observe: `game_state` with status `active` triggers `playCachedSound('/sounds/start.wav')` (Req 3.2)
  - Observe: auto-call toggle plays `aac_resumed.mp3` / `aac_ended.mp3` (Req 3.3)
  - Observe: `voice` and `autoCallInterval` persist across store rehydration (Req 3.4)
  - Observe: non-creator player receives `number_called` and sound plays (Req 3.5)
  - Observe: `downloadVoiceSounds` fires `onProgress` incrementally (Req 3.6)
  - Observe: `playCachedSound` falls back to network for uncached root sounds (Req 3.7)
  - Write property-based tests: for all non-buggy inputs (single call, root sounds, store ops), fixed behaviour matches observed baseline
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behaviour to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix sound system — ten-defect remediation

  - [x] 3.1 Add `AudioQueue` class and `playNumberSoundQueued` to `db.ts`
    - Implement `AudioQueue` class with `enqueue(task: () => Promise<void>)` and private `drain()` method
    - `drain()` sets `playing = true`, shifts next task, awaits it, then recurses; sets `playing = false` when queue empty
    - Export singleton `audioQueue` instance
    - Add `playNumberSoundQueued(number: number, voice: string, volume?: number): void` that builds the URL via `getVoiceExt` and enqueues a `playCachedSound` call
    - _Bug_Condition: isBugCondition where trigger = RAPID_NUMBER_CALL AND no AudioQueue exists (1.1); trigger = NUMBER_CALL AND NOT routedThroughPlayCachedSound (1.2)_
    - _Expected_Behavior: sequential non-overlapping playback; cache-routed number sounds_
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Update `playCachedSound` to accept optional `volume` parameter
    - Add `volume?: number` parameter (default `1`) to `playCachedSound(path, volume?)`
    - Apply `audio.volume = volume` before every `audio.play()` call (both direct and cache-fallback paths)
    - Return `HTMLAudioElement` so callers can attach `onended` if needed
    - _Bug_Condition: isBugCondition where trigger = VOLUME_CHANGE AND no_volume_state_exists (1.8)_
    - _Expected_Behavior: all Audio instances respect the passed volume value_
    - _Requirements: 2.8_

  - [x] 3.3 Add `volume` state to `gameSettingsStore.ts`
    - Add `volume: number` (default `1`, range 0–1) and `setVolume: (v: number) => void` to `GameSettingsState`
    - Include `volume` in the `persist` config so it survives reloads
    - _Bug_Condition: isBugCondition where trigger = VOLUME_CHANGE AND no_volume_state_exists (1.8)_
    - _Expected_Behavior: volume persists across reloads; all playback respects it_
    - _Requirements: 2.8, 3.4_

  - [x] 3.4 Consolidate extension logic — remove duplicates, use single `getVoiceExt` from `db.ts`
    - Remove `voiceExt` export from `gameSettingsStore.ts`
    - Remove the two inline `category === 'boy sound' ? '.wav' : '.mp3'` ternaries from `GamePage.tsx` (`playNumberSound` and `playSound`)
    - Update any remaining call sites in `gameSettingsStore.ts` to import `getVoiceExt` from `db.ts`
    - `getVoiceExt` in `db.ts` is already correct — no change needed there
    - _Bug_Condition: isBugCondition where trigger = GET_EXTENSION AND called_from_GamePage_or_store (1.10)_
    - _Expected_Behavior: single canonical `getVoiceExt` in db.ts; zero duplicate implementations_
    - _Requirements: 2.10_

  - [x] 3.5 Replace `_userInteracted` with robust unlock pattern in `GamePage.tsx`
    - Remove module-level `_userInteracted` flag and `click`/`keydown` listeners
    - Add document-level `pointerdown`, `touchstart`, and `keydown` listeners with `{ capture: true, once: true }` that set a module-level `_unlocked` flag
    - Call `new AudioContext().resume()` inside the unlock handler to satisfy iOS Web Audio API requirement
    - Update all `if (!_userInteracted)` guards to `if (!_unlocked)`
    - _Bug_Condition: isBugCondition where trigger = AUDIO_NEEDED AND _userInteracted = false AND no_prior_pointer_or_touch (1.5)_
    - _Expected_Behavior: first pointerdown/touchstart/keydown anywhere unlocks audio across all browsers and navigation patterns_
    - _Requirements: 2.5_

  - [x] 3.6 Replace `playNumberSound` with `playNumberSoundQueued` in `GamePage.tsx`
    - Delete the `playNumberSound` function from `GamePage.tsx`
    - Delete the `playSound` function from `GamePage.tsx`
    - Import `playNumberSoundQueued` and `playCachedSound` from `../services/db`
    - Replace `playNumberSound(number, voiceRef.current)` call in `number_called` handler with `playNumberSoundQueued(number, voiceRef.current, volumeRef.current)`
    - Add `volumeRef` that tracks `volume` from `useGameSettings()` (same pattern as `voiceRef`)
    - Replace any remaining `playSound(...)` call sites with direct `playCachedSound(url, volumeRef.current)` calls
    - _Bug_Condition: isBugCondition 1.1 (overlap) and 1.2 (cache bypass)_
    - _Expected_Behavior: all number sounds go through AudioQueue and playCachedSound_
    - _Preservation: online single-call playback remains immediate (Req 3.1); non-creator players still hear sounds (Req 3.5)_
    - _Requirements: 2.1, 2.2, 3.1, 3.5_

  - [x] 3.7 Add winner sound calls in `handleClaimBingo` and `game_finished` handler
    - In `handleClaimBingo`, after the successful `await gameApi.claimBingo(gameId, cartelaId)`, call `playRootSound('winner.wav')`
    - In the `game_finished` socket handler, call `playRootSound('winner.wav')` before `setAutoCall(false)`
    - _Bug_Condition: isBugCondition where trigger IN [BINGO_CLAIMED, GAME_FINISHED] AND winner_sound_not_called (1.3)_
    - _Expected_Behavior: winner.wav plays exactly once on bingo claim and on game_finished_
    - _Requirements: 2.3_

  - [x] 3.8 Add auto-preload `useEffect` for voice pack in `GamePage.tsx`
    - Add a `useEffect` that depends on `[voice]` and calls `downloadVoiceSounds(voice)` (fire-and-forget)
    - Import `downloadVoiceSounds` from `../services/db`
    - _Bug_Condition: isBugCondition where trigger IN [PAGE_LOAD, VOICE_CHANGED] AND downloadVoiceSounds_not_called (1.4)_
    - _Expected_Behavior: voice pack is preloaded on mount and on voice change; downloadVoiceSounds onProgress still fires (Req 3.6)_
    - _Requirements: 2.4, 3.6_

  - [x] 3.9 Fix auto-call timing to wait for audio completion
    - Replace the `setInterval`-based auto-call loop with a recursive `setTimeout` approach
    - After `doCallNumber()` emits `call_number`, wait for the `AudioQueue` to drain (or a minimum of `autoCallInterval` seconds, whichever is later) before scheduling the next call
    - Expose an `onDrained` callback or a `Promise` from `AudioQueue` / `playNumberSoundQueued` to signal completion
    - Ensure auto-call still stops immediately when `autoCall` is set to `false` or game ends
    - _Bug_Condition: isBugCondition where trigger = AUTO_CALL_TICK AND next_call_before_audio_ends (1.9)_
    - _Expected_Behavior: next call_number emit is delayed until current audio ends or interval elapses_
    - _Preservation: aac_resumed/aac_ended sounds still play on toggle (Req 3.3)_
    - _Requirements: 2.9, 3.3_

  - [x] 3.10 Add `notregisterd.mp3` fallback
    - Add `/sounds/notregisterd.mp3` to `ROOT_SOUND_FILES` in `db.ts` alongside the existing `.m4a` entry
    - Where `notregisterd.m4a` is referenced in playback, try `.mp3` first via `playCachedSound`; fall back to `.m4a` on error
    - _Bug_Condition: isBugCondition where trigger = PLAY_NOTREGISTERED AND platform = OLD_ANDROID_WEBVIEW (1.6)_
    - _Expected_Behavior: notregisterd sound plays on older Android WebViews via mp3 fallback_
    - _Requirements: 2.6_

  - [x] 3.11 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Sound System Ten-Defect Verification
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior for all ten defects
    - When these tests pass, it confirms the expected behavior is satisfied
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms all ten bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10_

  - [x] 3.12 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Correct Audio Behaviour
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all baseline behaviours (Req 3.1–3.7) are intact after the fix

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite; ensure all property tests and unit tests pass
  - Verify no TypeScript diagnostics errors in modified files (`db.ts`, `gameSettingsStore.ts`, `GamePage.tsx`)
  - Ask the user if any questions arise
