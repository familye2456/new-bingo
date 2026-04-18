import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type VoiceCategory =
  | 'boy sound'
  | 'boy simpol'
  | 'boy with symbol'
  | 'boy1 sound'
  | 'girl sound'
  | 'girl 1'
  | 'girl oro'
  | 'men arada'
  | 'men gold'
  | 'men tigrina';

export const ALL_VOICE_CATEGORIES: { value: VoiceCategory; label: string }[] = [
  { value: 'boy sound',       label: '👦 Boy' },
  { value: 'boy simpol',      label: '👦 Boy Simpol' },
  { value: 'boy with symbol', label: '👦 Boy Symbol' },
  { value: 'boy1 sound',      label: '👦 Boy 1' },
  { value: 'girl sound',      label: '👧 Girl' },
  { value: 'girl 1',          label: '👧 Girl 1' },
  { value: 'girl oro',        label: '👧 Girl Oro' },
  { value: 'men arada',       label: '🎙 Men Arada' },
  { value: 'men gold',        label: '🎙 Men Gold' },
  { value: 'men tigrina',     label: '🎙 Men Tigrina' },
];


interface GameSettingsState {
  voice: VoiceCategory;
  autoCallInterval: number;
  volume: number;
  setVoice: (v: VoiceCategory) => void;
  setAutoCallInterval: (s: number) => void;
  setVolume: (v: number) => void;
}

export const useGameSettings = create<GameSettingsState>()(
  persist(
    (set) => ({
      voice: 'boy sound',
      autoCallInterval: 5,
      volume: 1,
      setVoice: (voice) => set({ voice }),
      setAutoCallInterval: (autoCallInterval) => set({ autoCallInterval }),
      setVolume: (volume) => set({ volume }),
    }),
    { name: 'game-settings' }
  )
);
