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
  cellFontSize: string;
  cellCalledFontSize: string;
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
  ctrlBarBg: string;
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
    boardBg: '#1a0a2e',
    boardBorder: '#ef4444',
    letterChipBg: 'linear-gradient(180deg,#fbbf24 0%,#f59e0b 100%)',
    letterChipText: '#1a1a1a',
    cellUncalledBg: 'linear-gradient(180deg,#2d1b69 0%,#1a0a3e 100%)',
    cellUncalledText: '#e2d9f3',
    cellUncalledBorder: 'rgba(109,40,217,0.3)',
    cellCalledBg: 'linear-gradient(180deg,#ca8a04 0%,#a16207 100%)',
    cellCalledText: '#ff0000',
    cellCalledBorder: '#fbbf24',
    cellLastBg: 'linear-gradient(180deg,#ef4444 0%,#b91c1c 100%)',
    cellLastText: '#ffffff',
    cellLastBorder: '#ef4444',
    cellLastGlow: 'rgba(239,68,68,0.8)',
    boardCountText: '#6b7280',
    cellFontSize: 'clamp(13.8px, 3.11vw, 43px)',
    cellCalledFontSize: 'clamp(15.87px, 3.577vw, 49.45px)',
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
    cartelaWinnerBg: '#30AFFF',
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
    ctrlBarBg: '#76C0EC',
  },
  light: {
    name: 'light',
    label: '☀️ Light',
    pageBg: '#8140DC',
    headerBg: '#FFFFFF',
    headerText: '#111827',
    headerSubText: '#6B7280',
    prizeText: '#06B6D4',
    boardBg: '#130202ff',
    boardBorder: '#ef4444',
    letterChipBg: 'linear-gradient(180deg,#4F46E5 0%,#3730a3 100%)',
    letterChipText: '#ffffff',
    cellUncalledBg: '#ffffff',
    cellUncalledText: '#0F172A',
    cellUncalledBorder: '#e2e8f0',
    cellCalledBg: 'linear-gradient(180deg,#06B6D4 0%,#0891b2 100%)',
    cellCalledText: '#ffffff',
    cellCalledBorder: '#060707ff',
    cellLastBg: 'linear-gradient(180deg,#ef4444 0%,#b91c1c 100%)',
    cellLastText: '#ffffff',
    cellLastBorder: '#ef4444',
    cellLastGlow: 'rgba(239,68,68,0.8)',
    
    boardCountText: '#64748B',
    cellFontSize: 'clamp(16.6px, 3.73vw, 51.6px)',
    cellCalledFontSize: 'clamp(19.09px, 4.29vw, 59.34px)',
    cartelaBg: '#FFFFFF',
    cartelaBorder: '#e2e8f0',
    cartelaHeaderText: '#4F46E5',
    cartelaUnmarkedBg: '#F8FAFC',
    cartelaUnmarkedText: '#0F172A',
    cartelaUnmarkedBorder: '#e2e8f0',
    cartelaCalledBg: '#e0f2fe',
    cartelaCalledText: '#0F172A',
    cartelaCalledBorder: '#06B6D4',
    cartelaMarkedBg: '#4F46E5',
    cartelaMarkedText: '#ffffff',
    cartelaFreeBg: '#06B6D4',
    cartelaFreeText: '#ffffff',
    cartelaWinnerBg: '#30AFFF',
    cartelaWinnerBorder: '#4F46E5',
    cartelaWinnerText: '#4F46E5',
    btnPrimaryBg: 'linear-gradient(135deg,#4F46E5,#3730a3)',
    btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#06B6D4',
    btnSecondaryText: '#ffffff',
    btnSecondaryBorder: 'transparent',
    btnClaimBg: 'linear-gradient(135deg,#4F46E5,#06B6D4)',
    btnClaimText: '#ffffff',
    sectionTitle: '#0F172A',
    sectionEmpty: '#64748B',
    autocallPanelBg: '#F8FAFC',
    autocallPanelBorder: '#e2e8f0',
    autocallLabelText: '#0F172A',
    autocallInfoText: '#64748B',
    autocallOnBg: '#4F46E5',
    autocallOffBg: '#cbd5e1',
    ctrlBarBg: '#352f27ff',
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
    { name: 'game-settings', version: 3 }
  )
);
