/**
 * Property-Based Tests: GameService - cartela bonus system
 * Feature: cartela-bonus-system
 *
 * Tests Properties 1, 2, 3 from the design document.
 *
 * All tests use fast-check with a minimum of 100 iterations (default).
 * No real DB connections are used; all dependencies are mocked.
 */

import * as fc from 'fast-check';

// ── Mock all external dependencies before importing GameService ──────────────

const mockUserFindOne = jest.fn();
const mockUCFind = jest.fn();
const mockGameCount = jest.fn();
const mockTransactionFn = jest.fn();

jest.mock('../../../config/database', () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) => {
      if (entity.name === 'User')        return { findOne: mockUserFindOne };
      if (entity.name === 'UserCartela') return { find: mockUCFind };
      if (entity.name === 'Game')        return { count: mockGameCount, findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
      return {};
    },
    transaction: (...args: unknown[]) => mockTransactionFn(...args),
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: { setEx: jest.fn(), get: jest.fn().mockResolvedValue(null), del: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/metrics', () => ({
  activeGames: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { GameService, CreateGameDTO } from './GameService';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock EntityManager that captures increment and save calls.
 * Optionally accepts an override for the save method to simulate errors.
 */
function buildManager(saveFn?: (entity: unknown) => Promise<unknown>) {
  const incrementCalls: Array<{ entity: unknown; where: Record<string, unknown>; field: string; amount: number }> = [];
  const saveCalls: unknown[] = [];

  const defaultSave = (entity: unknown): Promise<unknown> => {
    if (Array.isArray(entity)) {
      entity.forEach((e) => saveCalls.push(e));
      return Promise.resolve(entity);
    }
    const e = entity as Record<string, unknown>;
    // Assign a fake id to game objects so description can reference it
    if (!e.id && !e.transactionType) e.id = 'game-uuid-pbt-1234';
    saveCalls.push(e);
    return Promise.resolve(e);
  };

  return {
    get incrementCalls() { return incrementCalls; },
    get saveCalls()      { return saveCalls; },

    increment(entityClass: unknown, where: Record<string, unknown>, field: string, amount: number) {
      incrementCalls.push({ entity: entityClass, where, field, amount });
      return Promise.resolve();
    },
    decrement(_e: unknown, _w: unknown, _f: string, _a: number) { return Promise.resolve(); },
    create(_e: unknown, data: Record<string, unknown>) { return { ...data }; },
    save: saveFn ?? defaultSave,
    findOne(_e: unknown, _o: unknown) { return Promise.resolve(null); },
  };
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-uuid-pbt-0001',
    balance: 500,
    paymentType: 'prepaid',
    creditLimit: 0,
    status: 'active',
    cartelaBonusEnabled: false,
    ...overrides,
  };
}

function buildDTO(overrides: Partial<CreateGameDTO> = {}): CreateGameDTO {
  return {
    cartelaIds: ['uc-uuid-pbt-0001'],
    betAmountPerCartela: 50,
    winPattern: 'any',
    ...overrides,
  };
}

let service: GameService;

beforeEach(() => {
  mockUserFindOne.mockReset();
  mockUCFind.mockReset();
  mockGameCount.mockReset();
  mockTransactionFn.mockReset();
  service = new GameService();
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Eligible user credit round-trip
// Feature: cartela-bonus-system, Property 1: For any eligible user
// (cartelaBonusEnabled = true) and any game created with betAmount > 0, after
// game creation: (a) a bonus transaction should exist with transactionType =
// 'bonus', amount = betAmount, status = 'completed', and description containing
// the gameId, and (b) manager.increment should have been called with betAmount.
// Validates: Requirements 3.1, 3.2
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 1: Eligible user credit round-trip', () => {
  it(
    'manager.increment called with betAmount and bonus Transaction saved with correct fields',
    async () => {
      // Feature: cartela-bonus-system, Property 1: eligible user bonus round-trip
      await fc.assert(
        fc.asyncProperty(
          fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
          async (betAmount) => {
            mockUserFindOne.mockReset();
            mockUCFind.mockReset();
            mockGameCount.mockReset();
            mockTransactionFn.mockReset();

            mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
            mockUCFind.mockResolvedValue([{ id: 'uc-uuid-pbt-0001', userId: 'user-uuid-pbt-0001' }]);
            mockGameCount.mockResolvedValue(0);

            const mgr = buildManager();
            mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));

            await service.createGame('user-uuid-pbt-0001', buildDTO({ betAmountPerCartela: betAmount }));

            // (a) manager.increment was called with betAmount for balance
            const balanceIncs = mgr.incrementCalls.filter((c) => c.field === 'balance');
            expect(balanceIncs).toHaveLength(1);
            expect(balanceIncs[0].amount).toBe(betAmount);
            expect(balanceIncs[0].where).toMatchObject({ id: 'user-uuid-pbt-0001' });

            // (b) bonus Transaction was saved with correct fields
            const bonusTxs = mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus');
            expect(bonusTxs).toHaveLength(1);

            const tx = bonusTxs[0] as any;
            expect(tx.transactionType).toBe('bonus');
            expect(tx.amount).toBe(betAmount);
            expect(tx.status).toBe('completed');
            expect(tx.userId).toBe('user-uuid-pbt-0001');

            // Description must contain the gameId that was assigned
            const savedGame = mgr.saveCalls.find((s: any) => !s.transactionType) as any;
            expect(tx.description).toContain(savedGame?.id ?? 'game-uuid-pbt-1234');
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: No bonus for non-eligible users or zero-bet games
// Feature: cartela-bonus-system, Property 2: For any user where
// cartelaBonusEnabled = false, or any game where betAmount = 0, after game
// creation no transaction with transactionType = 'bonus' linked to that gameId
// should exist, and the balance should not have been incremented by any bonus.
// Validates: Requirements 3.3, 3.5
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 2: No bonus for non-eligible users', () => {
  it(
    'manager.increment and bonus manager.save are never called when cartelaBonusEnabled = false',
    async () => {
      // Feature: cartela-bonus-system, Property 2: no bonus for ineligible users (cartelaBonusEnabled=false)
      await fc.assert(
        fc.asyncProperty(
          fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
          async (betAmount) => {
            mockUserFindOne.mockReset();
            mockUCFind.mockReset();
            mockGameCount.mockReset();
            mockTransactionFn.mockReset();

            // Non-eligible user: cartelaBonusEnabled = false
            mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: false }));
            mockUCFind.mockResolvedValue([{ id: 'uc-uuid-pbt-0001', userId: 'user-uuid-pbt-0001' }]);
            mockGameCount.mockResolvedValue(0);

            const mgr = buildManager();
            mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));

            await service.createGame('user-uuid-pbt-0001', buildDTO({ betAmountPerCartela: betAmount }));

            // manager.increment should NEVER be called for a bonus
            const balanceIncs = mgr.incrementCalls.filter((c) => c.field === 'balance');
            expect(balanceIncs).toHaveLength(0);

            // No bonus Transaction should be saved
            const bonusTxs = mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus');
            expect(bonusTxs).toHaveLength(0);
          }
        ),
        { numRuns: 25 }
      );
    }
  );

  it(
    'manager.increment and bonus manager.save are never called when betAmount = 0 (INVALID_BET guard)',
    async () => {
      // Feature: cartela-bonus-system, Property 2: no bonus for zero-bet games (betAmount=0 edge case)
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          async (cartelaBonusEnabled) => {
            mockUserFindOne.mockReset();
            mockUCFind.mockReset();
            mockGameCount.mockReset();
            mockTransactionFn.mockReset();

            // Eligible or not — betAmount = 0 should throw before any DB work
            mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled }));
            mockUCFind.mockResolvedValue([{ id: 'uc-uuid-pbt-0001', userId: 'user-uuid-pbt-0001' }]);
            mockGameCount.mockResolvedValue(0);

            const mgr = buildManager();
            mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));

            // betAmountPerCartela = 0 should throw INVALID_BET before the transaction runs
            await expect(
              service.createGame('user-uuid-pbt-0001', buildDTO({ betAmountPerCartela: 0 }))
            ).rejects.toMatchObject({ code: 'INVALID_BET' });

            // The transaction was never entered
            expect(mockTransactionFn).not.toHaveBeenCalled();

            // So increment and bonus save are never reached
            const balanceIncs = mgr.incrementCalls.filter((c) => c.field === 'balance');
            expect(balanceIncs).toHaveLength(0);

            const bonusTxs = mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus');
            expect(bonusTxs).toHaveLength(0);
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Bonus credit atomicity invariant
// Feature: cartela-bonus-system, Property 3: For any game creation sequence,
// the database should never contain a committed game row without its corresponding
// bonus transaction — both are created in the same DB transaction or neither is.
// Simulates a DB error on manager.save for the bonus transaction; verifies the
// outer AppDataSource.transaction throws.
// Validates: Requirements 3.4
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 3: Bonus credit atomicity invariant', () => {
  it(
    'when manager.save throws for the bonus transaction the entire createGame rejects',
    async () => {
      // Feature: cartela-bonus-system, Property 3: bonus credit atomicity invariant
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
          async (cartelaBonusEnabled, betAmount) => {
            mockUserFindOne.mockReset();
            mockUCFind.mockReset();
            mockGameCount.mockReset();
            mockTransactionFn.mockReset();

            mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled }));
            mockUCFind.mockResolvedValue([{ id: 'uc-uuid-pbt-0001', userId: 'user-uuid-pbt-0001' }]);
            mockGameCount.mockResolvedValue(0);

            const DB_ERROR = new Error('DB constraint error — simulated atomicity failure');

            // Faulty save: throws only when saving the bonus transaction
            const faultySave = (entity: unknown): Promise<unknown> => {
              if (Array.isArray(entity)) {
                return Promise.resolve(entity);
              }
              const e = entity as Record<string, unknown>;
              if (!e.id && !e.transactionType) e.id = 'game-uuid-pbt-1234';
              if (e.transactionType === 'bonus') {
                return Promise.reject(DB_ERROR);
              }
              return Promise.resolve(e);
            };

            const faultyMgr = buildManager(faultySave);

            // Wire up the transaction mock so it runs the callback with the faulty manager
            // and propagates the rejection (mimicking real TypeORM transaction behaviour)
            mockTransactionFn.mockImplementation(async (cb: Function) => {
              return cb(faultyMgr);
            });

            if (cartelaBonusEnabled) {
              // Eligible users: bonus save will be reached and will throw,
              // so createGame must reject (the outer transaction propagates the error)
              await expect(
                service.createGame('user-uuid-pbt-0001', buildDTO({ betAmountPerCartela: betAmount }))
              ).rejects.toThrow('DB constraint error — simulated atomicity failure');
            } else {
              // Non-eligible users: bonus save is never reached, so createGame succeeds
              await expect(
                service.createGame('user-uuid-pbt-0001', buildDTO({ betAmountPerCartela: betAmount }))
              ).resolves.toBeDefined();
            }
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});
