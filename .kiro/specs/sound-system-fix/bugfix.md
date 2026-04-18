# Bugfix Requirements Document

## Introduction

The fidel-bingo frontend sound system has multiple compounding defects that degrade the audio experience during gameplay. Issues range from sounds overlapping during rapid auto-call, number sounds bypassing the offline cache, the winner sound never playing, missing auto-preload of voice packs, a fragile user-interaction flag, format compatibility gaps, URL encoding failures on some servers, no volume control, auto-call timing mismatches, and duplicated extension logic spread across three files. This document captures all defective behaviors, the correct behaviors that must replace them, and the existing behaviors that must be preserved.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `playNumberSound` is called in rapid succession during auto-call THEN the system creates a new `Audio` instance on every call with no queue, causing multiple sounds to overlap simultaneously.

1.2 WHEN `playNumberSound` is called and the device is offline THEN the system uses `new Audio()` directly without going through `playCachedSound`, so number sounds fail even when the voice pack has been downloaded to cache.

1.3 WHEN a bingo is claimed or a `game_finished` socket event fires THEN the system never calls `playRootSound('winner.wav')`, so the winner sound is never played despite the file existing and being cached.

1.4 WHEN the game page loads or the selected voice changes THEN the system never calls `downloadVoiceSounds`, so the voice pack is not preloaded automatically and offline playback fails until the user manually triggers a download.

1.5 WHEN the page is loaded in a context where no click or keydown event fires before audio is needed (e.g., programmatic navigation, some mobile WebViews) THEN the module-level `_userInteracted` flag remains `false` and all sounds are silently suppressed.

1.6 WHEN `notregisterd.m4a` is played on older Android WebViews THEN the system fails to play the sound because `.m4a` has inconsistent codec support on those platforms.

1.7 WHEN a voice category whose folder name contains a space (e.g., `boy sound`) is used and the asset server runs nginx with strict URL handling THEN `encodeURIComponent` produces `boy%20sound` which some nginx configurations reject, causing all number sounds for that voice to fail.

1.8 WHEN the user wants to adjust audio volume THEN the system provides no volume control — there is no UI element, no store state, and no API to change playback volume.

1.9 WHEN auto-call is active and `autoCallInterval` is set THEN the system schedules the next `call_number` emit purely on wall-clock time without accounting for sound duration, so the next number can be announced before the current number's audio finishes playing.

1.10 WHEN the audio file extension for a voice category is needed THEN the system duplicates the `.wav`/`.mp3` branching logic independently in `playNumberSound` (GamePage.tsx), `playSound` (GamePage.tsx), and `voiceExt` / `getVoiceExt` (gameSettingsStore.ts and db.ts), creating four separate copies that can drift out of sync.

### Expected Behavior (Correct)

2.1 WHEN `playNumberSound` is called in rapid succession THEN the system SHALL queue sounds and play them sequentially so that no two number sounds overlap.

2.2 WHEN `playNumberSound` is called and the device is offline THEN the system SHALL route the request through `playCachedSound` so that cached number sounds play correctly without a network connection.

2.3 WHEN a bingo is claimed or a `game_finished` socket event fires THEN the system SHALL call `playRootSound('winner.wav')` so the winner sound plays at the appropriate moment.

2.4 WHEN the game page loads or the selected voice changes THEN the system SHALL automatically invoke `downloadVoiceSounds` for the active voice so the pack is preloaded into cache without requiring manual user action.

2.5 WHEN audio needs to be played THEN the system SHALL use a reliable interaction-detection mechanism (e.g., listening on `pointerdown`, `touchstart`, and `keydown` on the document with capture, or using the Web Audio API unlock pattern) so that `_userInteracted` is set correctly across all browsers and navigation patterns.

2.6 WHEN `notregisterd.m4a` needs to play THEN the system SHALL provide an `.mp3` fallback (or replace the file with `.mp3`) so the sound plays correctly on older Android WebViews.

2.7 WHEN voice sound URLs are constructed THEN the system SHALL encode folder names using `encodeURIComponent` only for path segments that require it, or SHALL use folder names without spaces (via a server-side alias or rename), so that URLs are accepted by all nginx configurations.

2.8 WHEN the user wants to adjust audio volume THEN the system SHALL provide a volume control in the game settings UI backed by a persisted store value, and all `Audio` instances SHALL respect that volume setting.

2.9 WHEN auto-call is active THEN the system SHALL delay scheduling the next `call_number` emit until the current number's audio has finished playing (or a configurable minimum gap has elapsed), so numbers are never announced before the previous sound completes.

2.10 WHEN the audio file extension for a voice category is needed THEN the system SHALL derive it from a single canonical source (e.g., `getVoiceExt` in `db.ts`) and all call sites SHALL import and use that one function, eliminating duplication.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a number is called while the device is online THEN the system SHALL CONTINUE TO play the corresponding voice sound immediately without perceptible delay.

3.2 WHEN the game status transitions to `active` THEN the system SHALL CONTINUE TO play `start.wav` via `playRootSound`.

3.3 WHEN auto-call is toggled on THEN the system SHALL CONTINUE TO play `aac_resumed.mp3`, and when toggled off SHALL CONTINUE TO play `aac_ended.mp3`.

3.4 WHEN a voice category is selected in settings THEN the system SHALL CONTINUE TO persist the selection across page reloads via the `game-settings` zustand store.

3.5 WHEN the game page is viewed by a non-creator player THEN the system SHALL CONTINUE TO play number sounds received via the `number_called` socket event without exposing call controls.

3.6 WHEN `downloadVoiceSounds` is called with a progress callback THEN the system SHALL CONTINUE TO report incremental progress so that any existing download UI remains functional.

3.7 WHEN `playCachedSound` is called for a root sound that is not yet cached and the device is online THEN the system SHALL CONTINUE TO play the sound directly via the network.
