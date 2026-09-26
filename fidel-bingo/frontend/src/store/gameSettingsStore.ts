import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Theme ──────────────────────────────────────────────────────────────────────
export type ThemeName = 'dark' | 'light';

export interface AppTheme {
  name: ThemeName;
  label: string;
  // page
  pageBg: string;
  // header bar
  headerBg: string;
  headerText: string;
  headerSubText: string;
  // prize
  prizeText: string;
  // number board
  boardBg: string;
  boardBorder: string;
  letterChipBg: string;
  letterChipText: string;
  cellUncalledBg: string;
  cellUncalledText: string;
  cellUncalledBorder: string;
  cellCalledBg: string;
  cellCalledText: string;
  cellCalledBorder: string;
  cellLastBg: string;
  cellLastText: string;
  cellLastBorder: string;
  cellLastGlow: string;
  boardCountText: string;
  // cartela
  cartelaBg: string;
  cartelaBorder: string;
  cartelaHeaderText: string;
  cartelaUnmarkedBg: string;
  cartelaUnmarkedText: string;
  cartelaUnmarkedBorder: string;
  cartelaCalledBg: string;
  cartelaCalledText: string;
  cartelaCalledBorder: string;
  cartelaMarkedBg: string;
  cartelaMarkedText: string;
  cartelaFreeBg: string;
  cartelaFreeText: string;
  cartelaWinnerBg: string;
  cartelaWinnerBorder: string;
  cartelaWinnerText: string;
  // buttons
  btnPrimaryBg: string;
  btnPrimaryText: string;
  btnSecondaryBg: string;
  btnSecondaryText: string;
  btnSecondaryBorder: string;
  btnClaimBg: string;
  btnClaimText: string;
  // section title
  sectionTitle: string;
  sectionEmpty: string;
  // autocall panel
  autocallPanelBg: string;
  autocallPanelBorder: string;
  autocallLabelText: string;
  autocallInfoText: string;
  autocallOnBg: string;
  autocallOffBg: string;
}

export const THEMES: Record<ThemeName, AppTheme> = {
  dark: {
    name: 'dark',
    label: '🌙 Dark',
    pageBg: '#0e1a35',
    headerBg: '#1e2235',
    headerText: '#ffffff',
    headerSubText: '#9ca3af',
    prizeText: '#fbbf24',
    boardBg: '#0d0d0d',
    boardBorder: '#1a1a2e',
    letterChipBg: 'linear-gradient(180deg,#fbbf24 0%,#f59e0b 100%)',
    letterChipText: '#1a1a1a',
    cellUncalledBg: 'linear-gradient(180deg,#991b1b 0%,#7f1d1d 100%)',
    cellUncalledText: '#ffffff',
    cellUncalledBorder: 'rgba(0,0,0,0.3)',
    cellCalledBg: 'linear-gradient(180deg,#ca8a04 0%,#a16207 100%)',
    cellCalledText: '#1a1a1a',
    cellCalledBorder: '#fbbf24',
    cellLastBg: 'linear-gradient(180deg,#fbbf24 0%,#f59e0b 100%)',
    cellLastText: '#1a1a1a',
    cellLastBorder: '#fbbf24',
    cellLastGlow: 'rgba(251,191,36,0.7)',
    boardCountText: '#6b7280',
    cartelaBg: '#1e2235',
    cartelaBorder: 'rgba(255,255,255,0.08)',
    cartelaHeaderText: '#fbbf24',
    cartelaUnmarkedBg: '#0e1a35',
    cartelaUnmarkedText: '#9ca3af',
    cartelaUnmarkedBorder: 'rgba(255,255,255,0.06)',
    cartelaCalledBg: 'rgba(251,191,36,0.15)',
    cartelaCalledText: '#fbbf24',
    cartelaCalledBorder: 'rgba(251,191,36,0.4)',
    cartelaMarkedBg: '#16a34a',
    cartelaMarkedText: '#ffffff',
    cartelaFreeBg: '#7c3aed',
    cartelaFreeText: '#ffffff',
    cartelaWinnerBg: 'rgba(251,191,36,0.06)',
    cartelaWinnerBorder: '#f59e0b',
    cartelaWinnerText: '#fbbf24',
    btnPrimaryBg: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
    btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#16a34a',
    btnSecondaryText: '#ffffff',
    btnSecondaryBorder: 'transparent',
    btnClaimBg: 'linear-gradient(135deg,#f59e0b,#d97706)',
    btnClaimText: '#ffffff',
    sectionTitle: '#fbbf24',
    sectionEmpty: '#6b7280',
    autocallPanelBg: '#0e1a35',
    autocallPanelBorder: 'rgba(255,255,255,0.06)',
    autocallLabelText: '#e5e7eb',
    autocallInfoText: '#9ca3af',
    autocallOnBg: '#16a34a',
    autocallOffBg: '#374151',
  },
  light: {
    name: 'light',
    label: '☀️ Light',
    pageBg: '#ffffff',
    headerBg: '#7c3aed',
    headerText: '#ffffff',
    headerSubText: '#ddd6fe',
    prizeText: '#f59e0b',
    boardBg: '#f5f0ff',
    boardBorder: '#ddd6fe',
    letterChipBg: 'linear-gradient(180deg,#7c3aed 0%,#5b21b6 100%)',
    letterChipText: '#ffffff',
    cellUncalledBg: '#ffffff',
    cellUncalledText: '#5b21b6',
    cellUncalledBorder: '#ddd6fe',
    cellCalledBg: 'linear-gradient(180deg,#16a34a 0%,#15803d 100%)',
    cellCalledText: '#ffffff',
    cellCalledBorder: '#16a34a',
    cellLastBg: 'linear-gradient(180deg,#f59e0b 0%,#d97706 100%)',
    cellLastText: '#ffffff',
    cellLastBorder: '#f59e0b',
    cellLastGlow: 'rgba(245,158,11,0.6)',
    boardCountText: '#7c3aed',
    cartelaBg: '#ffffff',
    cartelaBorder: '#ddd6fe',
    cartelaHeaderText: '#7c3aed',
    cartelaUnmarkedBg: '#f5f0ff',
    cartelaUnmarkedText: '#5b21b6',
    cartelaUnmarkedBorder: '#ddd6fe',
    cartelaCalledBg: '#ede9fe',
    cartelaCalledText: '#5b21b6',
    cartelaCalledBorder: '#7c3aed',
    cartelaMarkedBg: '#16a34a',
    cartelaMarkedText: '#ffffff',
    cartelaFreeBg: '#7c3aed',
    cartelaFreeText: '#ffffff',
    cartelaWinnerBg: '#fffbeb',
    cartelaWinnerBorder: '#f59e0b',
    cartelaWinnerText: '#d97706',
    btnPrimaryBg: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
    btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#16a34a',
    btnSecondaryText: '#ffffff',
    btnSecondaryBorder: 'transparent',
    btnClaimBg: 'linear-gradient(135deg,#f59e0b,#d97706)',
    btnClaimText: '#ffffff',
    sectionTitle: '#5b21b6',
    sectionEmpty: '#7c3aed',
    autocallPanelBg: '#f5f0ff',
    autocallPanelBorder: '#ddd6fe',
    autocallLabelText: '#5b21b6',
    autocallInfoText: '#7c3aed',
    autocallOnBg: '#16a34a',
    autocallOffBg: '#d1d5db',
  },
};

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
  | 'men tigrina'
  | 'hp sound'
  | 'double sound';

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
  { value: 'hp sound',        label: '🎵 HP' },
  { value: 'double sound',    label: '🎵 Double' },
];

interface GameSettingsState {
  voice: VoiceCategory;
  autoCallInterval: number;
  volume: number;
  theme: ThemeName;
  setVoice: (v: VoiceCategory) => void;
  setAutoCallInterval: (s: number) => void;
  setVolume: (v: number) => void;
  setTheme: (t: ThemeName) => void;
}

export const useGameSettings = create<GameSettingsState>()(
  persist(
    (set) => ({
      voice: 'boy sound',
      autoCallInterval: 5,
      volume: 1,
      theme: 'light',
      setVoice: (voice) => set({ voice }),
      setAutoCallInterval: (autoCallInterval) => set({ autoCallInterval }),
      setVolume: (volume) => set({ volume }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'game-settings' }
  )
);
