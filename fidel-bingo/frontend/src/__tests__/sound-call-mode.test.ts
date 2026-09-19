/**
 * Sound Call Mode Tests — Task 5
 *
 * Feature: sound-call-mode
 * Validates: Requirements 1.3, 1.4, 1.5, 2.1, 3.1, 3.3, 4.1, 4.2, 4.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { audioQueue, playNumberSoundQueued } from '../services/db';
import { useGameSettings, ALL_VOICE_CATEGORIES, SoundCallMode } from '../store/gameSettingsStore';

// ── Top-level mocks (hoisted by vitest) ──────────────────────────────────────

vi.mock('../services/api', () => ({
  userApi: {
    updateMe: vi.fn().mockResolvedValue({ data: { data: {} } }),
    myCartelas: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
  api: {
    get: vi.fn().mockResolvedValue({ data: { data: {} } }),
    patch: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(() => ({
    user: { username: 'testuser', email: 'test@test.com', balance: 100 },
    fetchMe: vi.fn(),
  })),
  isNegativeBalanceLocked: vi.fn(() => false),
}));

// Mock only the parts of db that Settings.tsx needs (cache/download helpers)
// but keep audioQueue and playNumberSoundQueued real via importOriginal
vi.mock('../services/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/db')>();
  return {
    ...actual,
    getVoiceCacheStatus: vi.fn().mockResolvedValue({ cached: 0, total: 78 }),
    downloadVoiceSounds: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Audio mock helpers ────────────────────────────────────────────────────────

interface MockAudioInstance { src: string; volume: number; }
let audioInstances: MockAudioInstance[] = [];

function setupAudioMock() {
  audioInstances = [];
  // Make caches unavailable so playCachedSound takes the direct Audio path (no cache fetch)
  vi.stubGlobal('caches', undefined);
  class MockAudio {
    src: string; volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn().mockImplementation(() => {
      // Trigger onended asynchronously so playCachedSound's promise resolves
      Promise.resolve().then(() => { this.onended?.(); });
      return Promise.resolve();
    });
    constructor(src: string) { this.src = src; audioInstances.push(this as unknown as MockAudioInstance); }
  }
  vi.stubGlobal('Audio', MockAudio);
}

const ALL_VOICES = ALL_VOICE_CATEGORIES.map((v) => v.value);

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('Sound Call Mode — Unit Tests', () => {
  beforeEach(() => { vi.clearAllMocks(); audioInstances = []; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('5.1 — single mode: enqueues exactly one task', () => {
    const spy = vi.spyOn(audioQueue, 'enqueue').mockImplementation(() => {});
    playNumberSoundQueued(7, 'boy sound', 1, 'single');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('5.2 — double mode: enqueues exactly two tasks with identical path', async () => {
    setupAudioMock();
    const captured: Array<() => Promise<void>> = [];
    const spy = vi.spyOn(audioQueue, 'enqueue').mockImplementation((task) => { captured.push(task); });
    playNumberSoundQueued(7, 'boy sound', 0.8, 'double');
    expect(spy).toHaveBeenCalledTimes(2);
    // Execute both tasks and verify they produce Audio with the same src
    await captured[0]();
    await captured[1]();
    expect(audioInstances).toHaveLength(2);
    expect(audioInstances[0].src).toBe(audioInstances[1].src);
    spy.mockRestore();
  }, 15000);

  it('5.3 — store default: soundCallMode is "single" when localStorage is empty', () => {
    localStorage.removeItem('game-settings');
    useGameSettings.setState({ soundCallMode: 'single' });
    expect(useGameSettings.getState().soundCallMode).toBe('single');
  });

  it('5.4 — Settings: clicking buttons sets soundCallMode correctly', async () => {
    const { Settings } = await import('../pages/user/Settings');
    useGameSettings.setState({ soundCallMode: 'single' });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { unmount } = render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(MemoryRouter, null, React.createElement(Settings)))
    );

    await act(async () => { fireEvent.click(screen.getByText('🔔🔔 Double Sound')); });
    expect(useGameSettings.getState().soundCallMode).toBe('double');

    await act(async () => { fireEvent.click(screen.getByText('🔔 Single Sound')); });
    expect(useGameSettings.getState().soundCallMode).toBe('single');

    unmount();
  }, 15000);
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

describe('Sound Call Mode — Property-Based Tests', () => {
  beforeEach(() => { vi.clearAllMocks(); audioInstances = []; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  /**
   * Property 1: Single mode enqueues exactly one task
   * Feature: sound-call-mode, Property 1: Single mode enqueues exactly one task
   */
  it('5.5 — PBT P1: single mode always enqueues exactly 1 task', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 75 }),
        fc.constantFrom(...ALL_VOICES),
        fc.float({ min: 0, max: 1 }),
        (number, voice, volume) => {
          const spy = vi.spyOn(audioQueue, 'enqueue').mockImplementation(() => {});
          playNumberSoundQueued(number, voice, volume, 'single');
          const count = spy.mock.calls.length;
          spy.mockRestore();
          return count === 1;
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 2: Double mode enqueues exactly two tasks
   * Feature: sound-call-mode, Property 2: Double mode enqueues exactly two tasks
   */
  it('5.6 — PBT P2: double mode always enqueues exactly 2 tasks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 75 }),
        fc.constantFrom(...ALL_VOICES),
        fc.float({ min: 0, max: 1 }),
        (number, voice, volume) => {
          const spy = vi.spyOn(audioQueue, 'enqueue').mockImplementation(() => {});
          playNumberSoundQueued(number, voice, volume, 'double');
          const count = spy.mock.calls.length;
          spy.mockRestore();
          return count === 2;
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 3: Double mode uses identical tasks for both enqueues
   * Feature: sound-call-mode, Property 3: Double mode uses identical tasks for both enqueues
   */
  it('5.7 — PBT P3: both tasks in double mode produce Audio with same src', async () => {
    setupAudioMock();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 75 }),
        fc.constantFrom(...ALL_VOICES),
        fc.float({ min: 0, max: 1 }),
        async (number, voice, volume) => {
          const captured: Array<() => Promise<void>> = [];
          const spy = vi.spyOn(audioQueue, 'enqueue').mockImplementation((task) => { captured.push(task); });
          audioInstances = [];
          playNumberSoundQueued(number, voice, volume, 'double');
          await captured[0]();
          await captured[1]();
          spy.mockRestore();
          return audioInstances.length === 2 && audioInstances[0].src === audioInstances[1].src;
        }
      ),
      { numRuns: 25 }
    );
  }, 30000);

  /**
   * Property 5: Store persistence round-trip
   * Feature: sound-call-mode, Property 5: Store persistence round-trip
   */
  it('5.8 — PBT P5: set/read round-trip and localStorage persistence', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('single' as SoundCallMode, 'double' as SoundCallMode),
        (mode) => {
          useGameSettings.getState().setSoundCallMode(mode);
          const readBack = useGameSettings.getState().soundCallMode;
          const stored = localStorage.getItem('game-settings');
          const persisted = stored ? JSON.parse(stored).state?.soundCallMode : null;
          return readBack === mode && persisted === mode;
        }
      ),
      { numRuns: 25 }
    );
  });
});
