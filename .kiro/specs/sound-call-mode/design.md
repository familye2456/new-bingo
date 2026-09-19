# Design Document: Sound Call Mode

## Overview

This feature adds a `soundCallMode` preference (`single` | `double`) to the bingo app's user settings. When set to `double`, each called number's audio is enqueued twice via the existing `AudioQueue`, causing the sound to play back-to-back before the next number is announced. The change touches three files:

1. `gameSettingsStore.ts` — adds the new state field and setter
2. `Settings.tsx` — renders a two-button toggle inside the existing Game Settings card
3. `services/db.ts` — `playNumberSoundQueued` receives the mode and enqueues once or twice

No new libraries, no API calls, and no schema migrations are needed. The feature is entirely client-side and persists through the existing Zustand `game-settings` localStorage key.

---

## Architecture

```mermaid
flowchart LR
    A[Settings.tsx] -->|setSound\nCallMode| B[gameSettingsStore\n(Zustand + persist)]
    B -->|localStorage\ngame-settings| C[(Browser\nlocalStorage)]
    D[Game Page / caller logic] -->|reads soundCallMode\nfrom store| B
    D -->|playNumberSoundQueued\n(number, voice, volume, mode)| E[services/db.ts]
    E -->|enqueue ×1 or ×2| F[AudioQueue\nsingleton]
    F -->|playCachedSound| G[Audio output]
```

The store is the single source of truth. Every component that calls `playNumberSoundQueued` passes the current `soundCallMode` from the store.

---

## Components and Interfaces

### 1. `gameSettingsStore.ts`

Add a `SoundCallMode` type, a `soundCallMode` field, and a `setSoundCallMode` action.

```ts
export type SoundCallMode = 'single' | 'double';

interface GameSettingsState {
  // ...existing fields...
  soundCallMode: SoundCallMode;
  setSoundCallMode: (m: SoundCallMode) => void;
}
```

Default value: `'single'`. Persistence key unchanged (`'game-settings'`).

### 2. `Settings.tsx`

Inside the existing **Game Settings** `<Card>`, add a new section below the Caller Voice buttons and above the Auto Call Interval slider:

```tsx
<div>
  <div className="text-xs font-medium mb-2.5" style={{ color: '#6b7280' }}>Sound Call Mode</div>
  <div className="grid grid-cols-2 gap-2">
    {(['single', 'double'] as SoundCallMode[]).map((mode) => (
      <button key={mode} onClick={() => setSoundCallMode(mode)}
        className="py-3 rounded-xl text-sm font-medium transition-all"
        style={soundCallMode === mode ? activeStyle : inactiveStyle}>
        {mode === 'single' ? '🔔 Single Sound' : '🔔🔔 Double Sound'}
      </button>
    ))}
  </div>
</div>
```

No new state needed in the component; everything comes from the store.

### 3. `services/db.ts` — `playNumberSoundQueued`

Extend the function signature to accept `mode`:

```ts
export function playNumberSoundQueued(
  number: number,
  voice: string,
  volume?: number,
  mode: SoundCallMode = 'single'
): void {
  const ext = getVoiceExt(voice);
  const path = `/sounds/${encodeURIComponent(voice)}/${number}${ext}`;
  const task = () => playCachedSound(path, volume).then(() => {});
  audioQueue.enqueue(task);
  if (mode === 'double') audioQueue.enqueue(task);
}
```

The `SoundCallMode` type is imported from `gameSettingsStore`. The default keeps all existing call sites unchanged.

---

## Data Models

### Store shape (after change)

```ts
{
  voice: VoiceCategory;           // existing
  autoCallInterval: number;       // existing
  volume: number;                 // existing
  soundCallMode: SoundCallMode;   // NEW — 'single' | 'double'
}
```

Persisted to `localStorage` under the key `"game-settings"` as JSON. No migration required: if `soundCallMode` is absent in a stored snapshot, Zustand's `persist` middleware leaves the field at its store default (`'single'`).

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Single mode enqueues exactly one task

*For any* number, voice, and volume, calling `playNumberSoundQueued` with `mode = 'single'` should result in the `AudioQueue` receiving exactly one new task.

**Validates: Requirements 2.1**

### Property 2: Double mode enqueues exactly two tasks

*For any* number, voice, and volume, calling `playNumberSoundQueued` with `mode = 'double'` should result in the `AudioQueue` receiving exactly two new tasks.

**Validates: Requirements 3.1**

### Property 3: Double mode uses identical tasks for both enqueues

*For any* number, voice, and volume, both tasks enqueued by `playNumberSoundQueued` in `double` mode should reference the same audio path and volume — i.e., the voice and volume settings are the same for the first and second playback.

**Validates: Requirements 3.3**

### Property 4: Default mode is single

*For any* fresh store state (no prior persisted value), the `soundCallMode` field should equal `'single'`.

**Validates: Requirements 1.5, 4.3**

### Property 5: Store persistence round-trip

*For any* `soundCallMode` value (`'single'` or `'double'`), after calling `setSoundCallMode(value)` the value read back from the store should equal `value`. After simulating a page reload (re-hydrating from `localStorage`), the value should still equal `value`.

**Validates: Requirements 1.3, 1.4, 4.1, 4.2**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `localStorage` is unavailable (private browsing) | Zustand `persist` silently falls back to in-memory state. `soundCallMode` defaults to `'single'` for the session. |
| Audio playback fails for either enqueued task | `playCachedSound` catches errors internally and resolves; the queue continues to the next item. No user-visible error. |
| Invalid `soundCallMode` value in storage | The store initialiser will receive `undefined`; Zustand keep the default `'single'`. |
| Caller passes unknown mode to `playNumberSoundQueued` | TypeScript prevents this at compile time. The runtime default parameter `'single'` guards legacy call sites. |

---

## Testing Strategy

### Unit tests

Target the pure logic paths:

- `playNumberSoundQueued` with `mode = 'single'` → spy on `audioQueue.enqueue`, assert called once.
- `playNumberSoundQueued` with `mode = 'double'` → assert called twice with identical path/volume.
- Store default value equals `'single'` when no prior state exists.
- `setSoundCallMode('double')` updates store; `setSoundCallMode('single')` reverts it.
- Settings component renders both buttons; clicking each calls `setSoundCallMode` with the correct value.

### Property-based tests

Use **fast-check** (already a common choice in TypeScript/React projects; add as dev dependency if absent).

Each property test runs a minimum of **100 iterations**.

**Tag format:** `Feature: sound-call-mode, Property N: <property_text>`

| Property | Test description |
|---|---|
| P1 | For randomly generated `(number 1–75, voice, volume)`, single mode → queue length +1 |
| P2 | For randomly generated `(number 1–75, voice, volume)`, double mode → queue length +2 |
| P3 | For randomly generated inputs, both tasks in double mode use the same path & volume |
| P4 | Fresh store (no localStorage) → `soundCallMode === 'single'` |
| P5 | For any of the two valid mode values, set then read round-trip returns same value |

Properties P1 and P2 can be tested by replacing `audioQueue` with a lightweight mock that records `enqueue` calls, then asserting on `enqueueCalls.length`.
