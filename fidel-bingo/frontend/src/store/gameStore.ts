import { create } from 'zustand';

export interface Cartela {
  id: string;
  cardNumber?: number;
  numbers: number[];
  patternMask: boolean[];
  isWinner: boolean;
  winPattern?: string;
}

/** Returns true if 15+ numbers have been called and none appear on this cartela (free center excluded) */
export function isZeroMatchWin(cartela: Cartela, calledNumbers: number[]): boolean {
  if (calledNumbers.length < 15) return false;
  const calledSet = new Set(calledNumbers);
  return cartela.numbers.every((n, i) => i === 12 || !calledSet.has(n));
}

export interface Game {
  id: string;
  gameNumber?: number;
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

  setGame: (game) => set((state) => ({
    currentGame: {
      ...game,
      cartelas: game.cartelas?.length ? game.cartelas : (state.currentGame?.cartelas ?? []),
      calledNumbers: game.calledNumbers ?? [],
    },
    lastCalledNumber: (game.calledNumbers?.length ?? 0) > 0
      ? game.calledNumbers[game.calledNumbers.length - 1]
      : state.lastCalledNumber,
  })),

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
