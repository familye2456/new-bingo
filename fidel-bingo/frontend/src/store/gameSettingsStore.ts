import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type VoiceCategory = 'boy sound' | 'girl sound';

interface GameSettingsState {
  voice: VoiceCategory;
  autoCallInterval: number; // seconds
  setVoice: (v: VoiceCategory) => void;
  setAutoCallInterval: (s: number) => void;
}

export const useGameSettings = create<GameSettingsState>()(
  persist(
    (set) => ({
      voice: 'boy sound',
      autoCallInterval: 5,
      setVoice: (voice) => set({ voice }),
      setAutoCallInterval: (autoCallInterval) => set({ autoCallInterval }),
    }),
    { name: 'game-settings' }
  )
);
