# Requirements Document

## Introduction

This feature adds a "sound call mode" setting to the bingo application's user settings page. Users can choose between "Single Sound" (default) and "Double Sound" modes. When a number is called during a game, the system announces the number once in Single Sound mode or twice consecutively in Double Sound mode. This gives users — particularly in noisy environments — the option to hear each called number repeated for clarity.

## Glossary

- **Sound_Call_Mode**: The user preference that controls how many times a called number's audio is announced. Either `single` (once) or `double` (twice).
- **Number_Caller**: The subsystem responsible for playing audio announcements when a bingo number is called, implemented via `playNumberSoundQueued` in `db.ts`.
- **Settings_Page**: The user-facing settings screen located at `src/pages/user/Settings.tsx` where preferences are configured.
- **Game_Settings_Store**: The Zustand persistent store (`gameSettingsStore.ts`) that holds user preferences including voice, volume, auto-call interval, and now Sound_Call_Mode.
- **Audio_Queue**: The sequential playback queue (`AudioQueue` in `db.ts`) that ensures number sounds play one after another without overlap.

---

## Requirements

### Requirement 1: Sound Call Mode Setting in User Settings

**User Story:** As a bingo operator, I want to select a single or double sound mode in my settings, so that the number announcements suit the noise level of my environment.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a "Sound Call Mode" option within the Game Settings card.
2. THE Settings_Page SHALL present exactly two selectable options for Sound_Call_Mode: "Single Sound" and "Double Sound".
3. WHEN a user selects "Single Sound", THE Game_Settings_Store SHALL persist the value `single` as the Sound_Call_Mode.
4. WHEN a user selects "Double Sound", THE Game_Settings_Store SHALL persist the value `double` as the Sound_Call_Mode.
5. THE Game_Settings_Store SHALL use `single` as the default value for Sound_Call_Mode when no prior preference has been saved.
6. WHEN the Settings_Page is loaded, THE Settings_Page SHALL display the currently persisted Sound_Call_Mode as the active selection.

---

### Requirement 2: Single Sound Playback Behavior

**User Story:** As a bingo operator using single sound mode, I want each called number to be announced once, so that the default game pace is maintained.

#### Acceptance Criteria

1. WHILE Sound_Call_Mode is `single`, WHEN a bingo number is called, THE Number_Caller SHALL enqueue exactly one audio playback task for that number.
2. WHILE Sound_Call_Mode is `single`, WHEN the Audio_Queue processes a called number, THE Audio_Queue SHALL play the number's sound file exactly once before moving to the next queued item.

---

### Requirement 3: Double Sound Playback Behavior

**User Story:** As a bingo operator using double sound mode, I want each called number to be announced twice in a row, so that players in noisy environments can clearly hear the number.

#### Acceptance Criteria

1. WHILE Sound_Call_Mode is `double`, WHEN a bingo number is called, THE Number_Caller SHALL enqueue exactly two sequential audio playback tasks for that number.
2. WHILE Sound_Call_Mode is `double`, WHEN the Audio_Queue processes a called number, THE Audio_Queue SHALL play the number's sound file a second time immediately after the first playback completes.
3. WHILE Sound_Call_Mode is `double`, THE Number_Caller SHALL use the same voice and volume settings for both the first and second playback of a called number.

---

### Requirement 4: Persistence of Sound Call Mode Preference

**User Story:** As a bingo operator, I want my sound call mode preference saved automatically, so that I don't have to reconfigure it every session.

#### Acceptance Criteria

1. THE Game_Settings_Store SHALL persist the Sound_Call_Mode value to browser local storage using the existing `game-settings` persistence key.
2. WHEN the application is reloaded, THE Game_Settings_Store SHALL restore the previously saved Sound_Call_Mode value.
3. IF no Sound_Call_Mode value exists in persisted storage, THEN THE Game_Settings_Store SHALL initialize Sound_Call_Mode to `single`.
