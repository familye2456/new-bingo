# Tasks

## Task List

- [x] 1. Extend gameSettingsStore with soundCallMode
  - [x] 1.1 Add `SoundCallMode` type (`'single' | 'double'`) and export it from `gameSettingsStore.ts`
  - [x] 1.2 Add `soundCallMode: SoundCallMode` field with default `'single'` to the store state
  - [x] 1.3 Add `setSoundCallMode` action to the store
  - [x] 1.4 Verify the field is covered by the existing `persist` middleware (no extra config needed)

- [x] 2. Update playNumberSoundQueued to support double mode
  - [x] 2.1 Import `SoundCallMode` from `gameSettingsStore` in `services/db.ts`
  - [x] 2.2 Add optional `mode: SoundCallMode = 'single'` parameter to `playNumberSoundQueued`
  - [x] 2.3 When `mode === 'double'`, enqueue the same task a second time immediately after the first

- [x] 3. Add Sound Call Mode UI to Settings page
  - [x] 3.1 Import `SoundCallMode` and `setSoundCallMode` from the store in `Settings.tsx`
  - [x] 3.2 Add a Sound Call Mode section inside the Game Settings card with two toggle buttons ("🔔 Single Sound" / "🔔🔔 Double Sound")
  - [x] 3.3 Apply active/inactive styles consistent with the existing Caller Voice buttons
  - [x] 3.4 Verify the selected button reflects the current store value on page load

- [x] 4. Wire soundCallMode into caller logic
  - [x] 4.1 Find all call sites of `playNumberSoundQueued` in the game pages/components
  - [x] 4.2 Pass the current `soundCallMode` from the store as the `mode` argument at each call site

- [x] 5. Write tests
  - [x] 5.1 Unit test: `playNumberSoundQueued` with `mode='single'` enqueues exactly one task
  - [x] 5.2 Unit test: `playNumberSoundQueued` with `mode='double'` enqueues exactly two tasks with identical path and volume
  - [x] 5.3 Unit test: store default value is `'single'` when localStorage is empty
  - [x] 5.4 Unit test: clicking each Settings button calls `setSoundCallMode` with the correct value
  - [x] 5.5 PBT: For any `(number 1–75, voice, volume)`, single mode → queue receives exactly 1 task — Feature: sound-call-mode, Property 1: Single mode enqueues exactly one task
  - [x] 5.6 PBT: For any `(number 1–75, voice, volume)`, double mode → queue receives exactly 2 tasks — Feature: sound-call-mode, Property 2: Double mode enqueues exactly two tasks
  - [x] 5.7 PBT: For any `(number 1–75, voice, volume)`, both tasks in double mode reference the same path and volume — Feature: sound-call-mode, Property 3: Double mode uses identical tasks for both enqueues
  - [x] 5.8 PBT: For any valid mode value, set → read round-trip returns same value; simulate reload → still same value — Feature: sound-call-mode, Property 5: Store persistence round-trip
