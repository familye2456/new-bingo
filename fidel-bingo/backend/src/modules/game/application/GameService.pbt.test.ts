/// <reference types="jest" />
/**
 * Property-Based Tests: GameService
 *
 * Property 1 — Validates: Requirements 2.1, 2.2, 2.3
 *   For any active game state (random calledNumbers length 0–74), after resetGame:
 *   calledNumbers = [], numberSequence is a permutation of [1..75],
 *   and callNumber returns numberSequence[0].
 *
 * Property 2 — Validates: Requirements 3.1, 3.5
 *   For any active game state where reset has NOT been called, repeated callNumber
 *   invocations always return sequence[i] for i=0,1,2,… with no duplicates.
 */

import * as fc from 'fast-check';

const mockGameFindOne = jest.fn();
const mockGameSave = jest.fn();

jest.mock('../../../config/database', () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) => {
      if (entity.name === 'Game') {
        return {
          findOne: mockGameFindOne,
          save: mockGameSave,
          find: jest.fn(),
          count: jest.fn(),
        };
      }
      return { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), count: jest.fn() };
    },
    transaction: jest.fn(),
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    setEx: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn(),
  },
}));

jest.mock('../../../shared/infrastructure/metrics', () => ({
  activeGames: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { GameService } from './GameService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick k distinct numbers from [1..75] without repetition */
function sampleDistinct(pool: number[], k: number): number[] {
  const copy = [...pool];
  const result: number[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(Math.random() * (copy.length - i));
    result.push(copy[idx]);
    [copy[idx], copy[copy.length - 1 - i]] = [copy[copy.length - 1 - i], copy[idx]];
  }
  return result;
}

/** Check that an array is a valid permutation of [1..75] */
function isValidPermutation(seq: number[]): boolean {
  if (seq.length !== 75) return false;
  const sorted = [...seq].sort((a, b) => a - b);
  for (let i = 0; i < 75; i++) {
    if (sorted[i] !== i + 1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property 1 — reset always produces a valid fresh sequence
// Validates: Requirements 2.1, 2.2, 2.3
// ---------------------------------------------------------------------------

describe('PBT — Property 1: reset always produces a valid fresh sequence', () => {
  let service: GameService;

  beforeEach(() => {
    mockGameFindOne.mockReset();
    mockGameSave.mockReset();
    service = new GameService();
  });

  it('calledNumbers=[], numberSequence is a fresh permutation, callNumber returns seq[0]', async () => {
    const all75 = Array.from({ length: 75 }, (_, i) => i + 1);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 74 }),
        async (k) => {
          mockGameFindOne.mockReset();
          mockGameSave.mockReset();

          const calledNumbers = sampleDistinct(all75, k);
          const originalSequence = [...all75];

          const game = {
            id: 'game-pbt-001',
            creatorId: 'creator-uuid-001',
            status: 'active' as const,
            calledNumbers: [...calledNumbers],
            numberSequence: [...originalSequence],
            betAmount: 50,
            housePercentage: 20,
            winPattern: 'any',
            winnerIds: [],
          };

          let savedGame: Record<string, unknown> | undefined;
          mockGameFindOne.mockResolvedValueOnce(game);
          mockGameSave.mockImplementation((g: Record<string, unknown>) => {
            savedGame = {
              ...g,
              calledNumbers: Array.isArray(g.calledNumbers) ? [...(g.calledNumbers as number[])] : g.calledNumbers,
              numberSequence: Array.isArray(g.numberSequence) ? [...(g.numberSequence as number[])] : g.numberSequence,
            };
            return Promise.resolve(g);
          });

          await service.resetGame(game.id, 'any-user-uuid');

          expect(savedGame!.calledNumbers).toEqual([]);

          const newSequence = savedGame!.numberSequence as number[];
          expect(newSequence).toHaveLength(75);
          expect(isValidPermutation(newSequence)).toBe(true);

          const postResetGame = {
            ...game,
            calledNumbers: [],
            numberSequence: [...newSequence],
          };

          mockGameFindOne.mockResolvedValueOnce(postResetGame);
          mockGameSave.mockImplementation((g: Record<string, unknown>) => Promise.resolve(g));

          const result = await service.callNumber(game.id, 'creator-uuid-001');

          expect(result.number).toBe(newSequence[0]);
          expect(result.remaining).toBe(74);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — sequential calling is preserved (no reset path)
// Validates: Requirements 3.1, 3.5
// ---------------------------------------------------------------------------

describe('PBT — Property 2: sequential calling is preserved (no reset path)', () => {
  let service: GameService;

  beforeEach(() => {
    mockGameFindOne.mockReset();
    mockGameSave.mockReset();
    service = new GameService();
  });

  /**
   * For any active game state where reset has NOT been called:
   * repeated callNumber invocations always return sequence[i] for i=0,1,2,…
   * with no duplicates.
   *
   * Validates: Requirements 3.1, 3.5
   */
  it('repeated callNumber calls return sequence[i] in order with no duplicates', async () => {
    const all75 = Array.from({ length: 75 }, (_, i) => i + 1);

    await fc.assert(
      fc.asyncProperty(
        // k: how many numbers already called (0–70), n: how many more to call (1–5)
        fc.integer({ min: 0, max: 70 }),
        fc.integer({ min: 1, max: 5 }),
        async (k, n) => {
          mockGameFindOne.mockReset();
          mockGameSave.mockReset();

          // Build a shuffled sequence (use a known shuffle for determinism in test)
          const sequence = sampleDistinct(all75, 75); // full random permutation
          const alreadyCalled = sequence.slice(0, k);

          // The game state: k numbers already called, sequence in place
          const baseGame = {
            id: 'game-pbt-002',
            creatorId: 'creator-uuid-001',
            status: 'active' as const,
            calledNumbers: [...alreadyCalled],
            numberSequence: [...sequence],
            betAmount: 50,
            housePercentage: 20,
            winPattern: 'any',
            winnerIds: [],
          };

          const calledDuringTest: number[] = [];

          // For each of the n calls, mock findOne to return current game state
          for (let i = 0; i < n; i++) {
            const currentGame = {
              ...baseGame,
              calledNumbers: [...alreadyCalled, ...calledDuringTest],
            };

            mockGameFindOne.mockResolvedValueOnce(currentGame);
            mockGameSave.mockImplementation((g: Record<string, unknown>) => {
              // Track what was saved
              if (Array.isArray(g.calledNumbers)) {
                const saved = g.calledNumbers as number[];
                calledDuringTest.push(saved[saved.length - 1]);
              }
              return Promise.resolve(g);
            });

            const result = await service.callNumber(baseGame.id, 'creator-uuid-001');
            const expectedNumber = sequence[k + i];

            // Each call must return the next number in the sequence
            expect(result.number).toBe(expectedNumber);
            // Remaining count decreases by 1 each time
            expect(result.remaining).toBe(75 - k - i - 1);
          }

          // No duplicates among called numbers
          const allCalled = [...alreadyCalled, ...calledDuringTest];
          const uniqueCalled = new Set(allCalled);
          expect(uniqueCalled.size).toBe(allCalled.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});
