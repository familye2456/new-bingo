# Requirements Document

## Introduction

This feature ensures that cartela (bingo card) display and sound playback work fully offline for both prepaid and postpaid users in the Fidel Bingo PWA. Currently, offline support is limited to prepaid users only — postpaid users lose cartela access and sound when connectivity drops. Additionally, sound files are not guaranteed to be cached by the service worker, causing silent failures mid-game. This feature extends offline capability to postpaid users for cartela and sound, and hardens the service worker caching strategy so all sound assets are reliably available without a network connection.

## Glossary

- **Cartela**: A 5×5 bingo card containing 25 numbers (with a free center space) used during a game session.
- **Sound_Player**: The frontend module responsible for loading and playing `.wav` audio files for called numbers and game events.
- **Service_Worker**: The Workbox-based PWA service worker that pre-caches static assets and handles runtime caching.
- **Offline_API**: The `offlineApi.ts` service layer that falls back to IndexedDB when the server is unreachable.
- **IndexedDB_Cache**: The browser-side persistent storage (`fidel-bingo` IDB database) used to store user data, cartelas, games, and transactions for offline use.
- **Prepaid_User**: A user whose `paymentType` is `"prepaid"`. Currently the only user type with offline fallback support.
- **Postpaid_User**: A user whose `paymentType` is `"postpaid"`. Currently excluded from offline fallback.
- **Sync_Queue**: The `syncQueue` IndexedDB store that holds mutations to be replayed against the server when connectivity is restored.
- **Voice_Category**: The selected sound pack (`"boy sound"` or `"girl sound"`) stored in `gameSettingsStore`.
- **Number_Sound**: A `.wav` file named `{number}.wav` (1–75) inside a Voice_Category folder under `/sounds/`.
- **Event_Sound**: A named `.wav` file (e.g. `start.wav`) inside a Voice_Category folder used for game lifecycle events.
- **PWA**: Progressive Web App — the Fidel Bingo frontend built with Vite + vite-plugin-pwa.

---

## Requirements

### Requirement 1: Offline Cartela Access for Postpaid Users

**User Story:** As a postpaid user, I want to view my cartelas during a game even when I lose internet connectivity, so that I can continue playing without interruption.

#### Acceptance Criteria

1. WHEN a postpaid user's cartelas are successfully fetched from the server, THE Offline_API SHALL store each cartela in the IndexedDB_Cache under the `cartelas` store.
2. WHEN the server is unreachable and the user is a postpaid user, THE Offline_API SHALL return cartelas from the IndexedDB_Cache for the `myCartelas` function.
3. WHEN the server is unreachable and the user is a postpaid user, THE Offline_API SHALL return the cached game record from IndexedDB_Cache for the `get` function.
4. WHEN a postpaid user logs in successfully, THE Offline_API SHALL cache the user's cartelas, active games, and profile in IndexedDB_Cache before the session ends.
5. WHEN connectivity is restored for a postpaid user, THE Offline_API SHALL refresh the IndexedDB_Cache with the latest server data.

---

### Requirement 2: Offline Game State for Postpaid Users

**User Story:** As a postpaid user, I want the game state (called numbers, cartela marks) to remain visible and interactive when I go offline mid-game, so that I don't lose my progress.

#### Acceptance Criteria

1. WHEN the server is unreachable and the user is a postpaid user, THE Offline_API SHALL return the cached game state from IndexedDB_Cache for the `getCartelas` function.
2. WHEN a postpaid user marks a number while offline, THE Offline_API SHALL record the mark action in the Sync_Queue and apply it locally to the IndexedDB_Cache.
3. WHEN connectivity is restored after a postpaid user has queued mark actions, THE Offline_API SHALL replay all queued mark actions against the server via `flushQueue`.
4. WHEN the server is unreachable and the user is a postpaid user, THE Offline_API SHALL evaluate the `checkCartela` function using the locally cached game and cartela data.

---

### Requirement 3: Sound File Pre-Caching

**User Story:** As a player, I want number call sounds and game event sounds to play without a network connection, so that the audio experience is uninterrupted during offline gameplay.

#### Acceptance Criteria

1. THE Service_Worker SHALL pre-cache all `.wav` files located under `/sounds/boy sound/` and `/sounds/girl sound/` during the PWA installation phase.
2. WHEN a sound file is requested and the device is offline, THE Service_Worker SHALL serve the sound file from the pre-cache without making a network request.
3. THE Service_Worker SHALL include all Number_Sound files (1.wav through 75.wav) for both Voice_Category options in the pre-cache manifest.
4. THE Service_Worker SHALL include all Event_Sound files (e.g. `start.wav`) for both Voice_Category options in the pre-cache manifest.
5. WHEN the PWA is updated and a new service worker activates, THE Service_Worker SHALL update the pre-cached sound files to match the new build.

---

### Requirement 4: Resilient Sound Playback

**User Story:** As a player, I want the Sound_Player to reliably play sounds regardless of network state, so that I always hear number calls and game events.

#### Acceptance Criteria

1. WHEN a number is called and the device is offline, THE Sound_Player SHALL play the corresponding Number_Sound from the service worker cache.
2. WHEN a game event occurs (e.g. game start) and the device is offline, THE Sound_Player SHALL play the corresponding Event_Sound from the service worker cache.
3. WHEN a sound file is not found in the cache and the device is offline, THE Sound_Player SHALL fail silently without throwing an unhandled error or blocking game interaction.
4. WHEN the user has not yet interacted with the page, THE Sound_Player SHALL defer sound playback until a user interaction event is detected, regardless of network state.
5. WHEN a sound is already playing for the same number, THE Sound_Player SHALL allow the new sound to play without waiting for the previous one to finish.

---

### Requirement 5: Offline Indicator

**User Story:** As a player, I want to know when I am playing in offline mode, so that I understand why certain features (like real-time sync) may be unavailable.

#### Acceptance Criteria

1. WHEN the device loses network connectivity during a game session, THE Game_UI SHALL display a visible offline status indicator within 2 seconds of the connectivity change.
2. WHEN the device regains network connectivity, THE Game_UI SHALL remove the offline status indicator and display a reconnecting status within 2 seconds.
3. WHILE the device is offline, THE Game_UI SHALL display the offline indicator persistently on the game screen.
4. THE offline status indicator SHALL be visible to the user without requiring any interaction to reveal it.

---

### Requirement 6: Login Cache for Both User Types

**User Story:** As either a prepaid or postpaid user, I want my cartelas and game data to be cached at login, so that I can access them if I go offline during a session.

#### Acceptance Criteria

1. WHEN a prepaid user logs in successfully, THE Auth_Module SHALL cache the user profile, cartelas, active games, and transactions in IndexedDB_Cache.
2. WHEN a postpaid user logs in successfully, THE Auth_Module SHALL cache the user profile and cartelas in IndexedDB_Cache.
3. WHEN a postpaid user logs in successfully, THE Auth_Module SHALL cache the user's active and recent games in IndexedDB_Cache.
4. IF a cache fetch fails during login for any user type, THEN THE Auth_Module SHALL mark that cache step as skipped and continue without blocking the login flow.
5. WHEN a user logs out, THE Auth_Module SHALL clear all IndexedDB_Cache stores for that user regardless of payment type.
