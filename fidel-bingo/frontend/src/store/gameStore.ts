import { create } from 'zustand';

export interface Cartela {
  id: string;
  numbers: number[];
  patternMask: boolean[];
  isWinner: boolean;
  winPattern?: string;
}

export interface Game {
  id: string;
  status: 'pending' | 'active' | 'finished' | 'cancelled';
  betAmount: number;
  prizePool: number;
  calledNumbers: number[];
  cartelas: Cartela[];
  winnerIds: string[];
  creatorId: string;
}

interface GameState {
  currentGame: Game | null;
  lastCalledNumber: number | null;
  setGame: (game: Game) => void;
  addCalledNumber: (number: number) => void;
  updateCartela: (cartelaId: string, mask: boolean[]) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  currentGame: null,
  lastCalledNumber: null,

  setGame: (game) => set({ currentGame: game }),

  addCalledNumber: (number) =>
    set((state) => ({
      lastCalledNumber: number,
      currentGame: state.currentGame
        ? { ...state.currentGame, calledNumbers: [...state.currentGame.calledNumbers, number] }
        : null,
    })),

  updateCartela: (cartelaId, mask) =>
    set((state) => ({
      currentGame: state.currentGame
        ? {
            ...state.currentGame,
            cartelas: state.currentGame.cartelas.map((c) =>
              c.id === cartelaId ? { ...c, patternMask: mask } : c
            ),
          }
        : null,
    })),

  clearGame: () => set({ currentGame: null, lastCalledNumber: null }),
}));
