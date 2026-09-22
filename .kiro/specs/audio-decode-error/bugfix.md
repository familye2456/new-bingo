# Bugfix Requirements Document

## Introduction

During bingo game playback, audio files for the "boy sound" voice (WAV format, e.g. `40.wav`, `47.wav`, `67.wav`) fail to decode when played through the `audioQueue` in `db.ts`. The browser's `decodeAudioData` throws `EncodingError: Unable to decode audio data`, causing numbers to be called silently. The bug is triggered when `playCachedSound` retrieves a cached `ArrayBuffer` and passes it directly to `playDecodedAudio`, which calls `ctx.decodeAudioData(arrayBuffer)`. Because `decodeAudioData` transfers (detaches) the `ArrayBuffer`, any subsequent attempt to decode the same buffer — or any buffer that was already consumed — results in the `EncodingError`. Additionally, certain WAV files may be in a format the browser cannot decode natively, and there is no fallback path from `playDecodedAudio` to `playHtmlAudio` when decoding fails.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a cached WAV sound file is retrieved and its `ArrayBuffer` is passed to `ctx.decodeAudioData()` THEN the system throws `EncodingError: Unable to decode audio data` and the audio is silently skipped.

1.2 WHEN `decodeAudioData` fails for any reason inside `playDecodedAudio` THEN the system only logs a warning and does not attempt to play the sound via any fallback mechanism.

1.3 WHEN the same sound path is played twice in quick succession via the `audioQueue` (e.g. double-sound mode) THEN the system may attempt to decode a detached (already-consumed) `ArrayBuffer`, causing a second `EncodingError`.

1.4 WHEN `playCachedSound` encounters a decode error from the cache path THEN the system silently returns without retrying via the network/public fallback path.

### Expected Behavior (Correct)

2.1 WHEN a cached WAV sound file is retrieved and its `ArrayBuffer` is passed to `ctx.decodeAudioData()` THEN the system SHALL successfully decode and play the audio, or fall back gracefully if the format is unsupported.

2.2 WHEN `decodeAudioData` fails for any reason inside `playDecodedAudio` THEN the system SHALL fall back to `playHtmlAudio` using a blob URL created from the original `ArrayBuffer` so the sound is still played.

2.3 WHEN the same sound path is played twice via the `audioQueue` THEN the system SHALL obtain a fresh `ArrayBuffer` for each playback attempt so no detached buffer is ever passed to `decodeAudioData`.

2.4 WHEN `playCachedSound` encounters a decode error from the cache path THEN the system SHALL retry playback via the network/public fallback (`playAudioBuffer`) before giving up.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a cached MP3 sound file is retrieved and decoded THEN the system SHALL CONTINUE TO decode and play it successfully via `decodeAudioData` without error.

3.2 WHEN a sound file is not in the cache THEN the system SHALL CONTINUE TO fetch it from the network and play it via `playAudioBuffer`.

3.3 WHEN the `AudioContext` is unavailable or suspended THEN the system SHALL CONTINUE TO fall back to `playHtmlAudio` for all audio playback.

3.4 WHEN a postpaid user triggers audio playback THEN the system SHALL CONTINUE TO bypass the cache and fetch sounds directly from the network.

3.5 WHEN numbers are played in double-sound mode via the `audioQueue` THEN the system SHALL CONTINUE TO play each number twice with the 1-second gap between plays.

---

## Bug Condition

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type AudioPlaybackRequest
         X.arrayBuffer — the ArrayBuffer retrieved from cache
         X.format      — the audio file format (e.g. 'wav', 'mp3')
  OUTPUT: boolean

  // Bug triggers when the buffer is detached OR the format cannot be decoded
  RETURN X.arrayBuffer.byteLength = 0       // buffer already detached
      OR ctx.decodeAudioData(X.arrayBuffer) throws EncodingError
END FUNCTION
```

### Fix Checking Property

```pascal
// Property: Fix Checking — decodeAudioData failure is handled
FOR ALL X WHERE isBugCondition(X) DO
  result ← playDecodedAudio'(X.arrayBuffer, X.volume)
  ASSERT audio_was_played(result)    // sound played via fallback
      OR error_was_logged(result)    // or logged if all paths fail
  ASSERT no_silent_skip(result)      // never silently discards the sound
END FOR
```

### Preservation Checking Property

```pascal
// Property: Preservation Checking — non-buggy inputs unaffected
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT playDecodedAudio(X) = playDecodedAudio'(X)
END FOR
```
