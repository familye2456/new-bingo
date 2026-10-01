/**
 * Unit Tests: GameService - free cartela bonus logic
 *
 * Mocked DB/transaction objects so no real DB connection is needed.
 */

import { AppError } from '../../../shared/middleware/errorHandler';

const mockUserFindOne = jest.fn();
const mockUCFind = jest.fn();
const mockGameCount = jest.fn();
const mockGameFindOne = jest.fn();
const mockGameSave = jest.fn();
const mockTransactionFn = jest.fn();

jest.mock('../../../config/database', () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) => {
      if (entity.name === 'User')        return { findOne: mockUserFindOne };
      if (entity.name === 'UserCartela') return { find: mockUCFind };
      if (entity.name === 'Game')        return { count: mockGameCount, findOne: mockGameFindOne, find: jest.fn(), save: mockGameSave };
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

function buildManager() {
  const incCalls: Array<{ field: string; amount: number; where: Record<string, unknown> }> = [];
  const savCalls: unknown[] = [];
  return {
    get incrementCalls() { return incCalls; },
    get saveCalls() { return savCalls; },
    increment(_e: unknown, where: Record<string, unknown>, field: string, amount: number) {
      incCalls.push({ field, amount, where });
      return Promise.resolve();
    },
    decrement(_e: unknown, _w: unknown, _f: string, _a: number) { return Promise.resolve(); },
    create(_e: unknown, data: Record<string, unknown>) { return { ...data }; },
    save(entity: unknown): Promise<unknown> {
      if (Array.isArray(entity)) { entity.forEach((e) => savCalls.push(e)); return Promise.resolve(entity); }
      const e = entity as Record<string, unknown>;
      if (!e.id && !e.transactionType) e.id = 'game-uuid-1234';
      savCalls.push(e);
      return Promise.resolve(e);
    },
    findOne(_e: unknown, _o: unknown) { return Promise.resolve(null); },
  };
}

function buildUser(overrides = {}) {
  return { id: 'user-uuid-0001', balance: 500, paymentType: 'prepaid', creditLimit: 0, status: 'active', cartelaBonusEnabled: false, ...overrides };
}

function buildDTO(overrides: Partial<CreateGameDTO> = {}): CreateGameDTO {
  return { cartelaIds: ['uc-uuid-0001'], betAmountPerCartela: 50, winPattern: 'any', ...overrides };
}

let service: GameService;

beforeEach(() => {
  mockUserFindOne.mockReset();
  mockUCFind.mockReset();
  mockGameCount.mockReset();
  mockGameFindOne.mockReset();
  mockGameSave.mockReset();
  mockTransactionFn.mockReset();
  service = new GameService();
});

describe('createGame - eligible user (cartelaBonusEnabled=true, betAmount>0)', () => {
  it('calls manager.increment with betAmount for user balance', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 50 }));
    const bonusIncs = mgr.incrementCalls.filter((c) => c.field === 'balance');
    expect(bonusIncs).toHaveLength(1);
    expect(bonusIncs[0].amount).toBe(50);
    expect(bonusIncs[0].where).toMatchObject({ id: 'user-uuid-0001' });
  });

  it('saves bonus Transaction with type bonus, correct amount, status completed, description with gameId', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 75 }));
    const bonusTxs = mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus');
    expect(bonusTxs).toHaveLength(1);
    const tx = bonusTxs[0] as any;
    expect(tx.transactionType).toBe('bonus');
    expect(tx.amount).toBe(75);
    expect(tx.status).toBe('completed');
    expect(tx.userId).toBe('user-uuid-0001');
    const gameObj = mgr.saveCalls.find((s: any) => !s.transactionType) as any;
    expect(tx.description).toContain(gameObj.id);
  });

  it('both increment and bonus save are called atomically', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 100 }));
    expect(mgr.incrementCalls.some((c: any) => c.field === 'balance' && c.amount === 100)).toBe(true);
    expect(mgr.saveCalls.some((s: any) => s.transactionType === 'bonus')).toBe(true);
  });
});

describe('createGame - non-eligible user (cartelaBonusEnabled=false)', () => {
  it('does NOT call manager.increment', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: false }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO());
    expect(mgr.incrementCalls).toHaveLength(0);
  });

  it('does NOT save a bonus Transaction', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: false }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO());
    const bonusTxs = mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus');
    expect(bonusTxs).toHaveLength(0);
  });
});

describe('createGame - zero bet edge case (betAmountPerCartela=0)', () => {
  it('throws AppError INVALID_BET before any DB interaction', async () => {
    let caught: AppError | undefined;
    try {
      await service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 0 }));
    } catch (err) { caught = err as AppError; }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.statusCode).toBe(400);
    expect(caught!.code).toBe('INVALID_BET');
    expect(mockTransactionFn).not.toHaveBeenCalled();
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  it('manager.increment and bonus save are never called for a zero-bet game', async () => {
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await expect(service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 0 }))).rejects.toBeInstanceOf(AppError);
    expect(mgr.incrementCalls).toHaveLength(0);
    expect(mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus')).toHaveLength(0);
  });

  it('eligible user with betAmount=0 still gets INVALID_BET (bonus never reached)', async () => {
    await expect(service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 0 }))).rejects.toMatchObject({ code: 'INVALID_BET', statusCode: 400 });
    expect(mockTransactionFn).not.toHaveBeenCalled();
  });
});

describe('createGame - bonus atomicity', () => {
  it('if bonus save fails the error propagates (simulates transaction rollback)', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    let incReached = false;
    let bonusSaveReached = false;
    const faultyMgr = {
      ...buildManager(),
      increment(_e: unknown, _w: unknown, field: string, _a: number) {
        if (field === 'balance') incReached = true;
        return Promise.resolve();
      },
      save(entity: unknown): Promise<unknown> {
        if (Array.isArray(entity)) return Promise.resolve(entity);
        const e = entity as Record<string, unknown>;
        if (!e.id && !e.transactionType) e.id = 'game-uuid-1234';
        if (e.transactionType === 'bonus') { bonusSaveReached = true; return Promise.reject(new Error('DB constraint error')); }
        return Promise.resolve(e);
      },
    };
    mockTransactionFn.mockImplementation((cb: Function) => cb(faultyMgr));
    await expect(service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 50 }))).rejects.toThrow('DB constraint error');
    expect(incReached).toBe(true);
    expect(bonusSaveReached).toBe(true);
  });

  it('increment and bonus save both target the same manager instance', async () => {
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: true }));
    mockUCFind.mockResolvedValue([{ id: 'uc-uuid-0001', userId: 'user-uuid-0001' }]);
    mockGameCount.mockResolvedValue(0);
    const mgr = buildManager();
    mockTransactionFn.mockImplementation((cb: Function) => cb(mgr));
    await service.createGame('user-uuid-0001', buildDTO({ betAmountPerCartela: 50 }));
    expect(mgr.incrementCalls.filter((c: any) => c.field === 'balance')).toHaveLength(1);
    expect(mgr.saveCalls.filter((s: any) => s.transactionType === 'bonus')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// EXPLORATORY BUG CONDITION TESTS
// These tests run against the UNFIXED code to confirm the root cause.
// Task 1.1: Non-creator reset is blocked with 403
// ---------------------------------------------------------------------------

function buildActiveGame(overrides: Record<string, unknown> = {}) {
  return {
    id: 'game-uuid-active',
    creatorId: 'creator-uuid-001',
    status: 'active',
    calledNumbers: [5, 12, 33],
    numberSequence: Array.from({ length: 75 }, (_, i) => i + 1),
    betAmount: 50,
    housePercentage: 20,
    winPattern: 'any',
    winnerIds: [],
    ...overrides,
  };
}

describe('EXPLORATORY — Task 1.1: Non-creator reset is blocked (403)', () => {
  /**
   * Bug condition: resetGame is called by any user who is NOT the game creator.
   *
   * Current (unfixed) code has:
   *   if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can reset the game')
   *
   * This test confirms the bug EXISTS by asserting the 403 IS thrown.
   * NOTE: This test is EXPECTED TO FAIL after the fix is applied (that is correct).
   */
  it('throws 403 FORBIDDEN when resetGame is called by a non-creator user', async () => {
    const game = buildActiveGame();
    mockGameFindOne.mockResolvedValue(game);

    const nonCreatorId = 'player-uuid-999'; // different from game.creatorId

    let caught: AppError | undefined;
    try {
      await service.resetGame(game.id, nonCreatorId);
    } catch (err) {
      caught = err as AppError;
    }

    // The bug: non-creator cannot reset — the authorization guard blocks them
    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.statusCode).toBe(403);
    expect(caught!.code).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// EXPLORATORY BUG CONDITION TESTS
// Task 1.2: Creator reset leaves numberSequence intact
// ---------------------------------------------------------------------------

describe('EXPLORATORY — Task 1.2: Creator reset leaves numberSequence intact', () => {
  /**
   * Bug condition: resetGame is called by the creator on an active game.
   *
   * Current (unfixed) code only sets game.calledNumbers = [] and saves.
   * It does NOT regenerate or clear game.numberSequence.
   *
   * This test confirms the bug EXISTS by asserting numberSequence is NOT cleared/regenerated.
   * NOTE: This test is EXPECTED TO FAIL after the fix is applied (that is correct).
   *
   * Validates: Design section "Backend — incomplete reset"
   */
  it('does NOT regenerate numberSequence after creator-triggered resetGame', async () => {
    const originalSequence = Array.from({ length: 75 }, (_, i) => i + 1);
    const game = buildActiveGame({
      calledNumbers: [5, 12, 33, 47, 61],
      numberSequence: [...originalSequence],
    });

    // The mock captures whatever object is passed to save()
    let savedGame: Record<string, unknown> | undefined;
    mockGameFindOne.mockResolvedValue(game);
    mockGameSave.mockImplementation((g: Record<string, unknown>) => {
      savedGame = { ...g, numberSequence: Array.isArray(g.numberSequence) ? [...(g.numberSequence as number[])] : g.numberSequence };
      return Promise.resolve(g);
    });

    // Call resetGame as the CREATOR — this currently succeeds
    await service.resetGame(game.id, 'creator-uuid-001');

    // The saved game should have calledNumbers cleared (this part works)
    expect(savedGame!.calledNumbers).toEqual([]);

    // BUG CONFIRMATION: numberSequence is unchanged — it was NOT regenerated
    // On unfixed code this passes (sequence is identical to original).
    // After the fix this should fail (sequence will be a new shuffle).
    expect(savedGame!.numberSequence).toEqual(originalSequence);
  });
});

// ---------------------------------------------------------------------------
// EXPLORATORY BUG CONDITION TESTS
// Task 1.3: callNumber after creator reset uses old sequence
// ---------------------------------------------------------------------------

describe('EXPLORATORY — Task 1.3: callNumber after creator reset uses old sequence', () => {
  /**
   * Bug condition: after resetGame (by creator), calledNumbers becomes [].
   * callNumber then uses calledNumbers.length (=0) as the index into numberSequence.
   * Since numberSequence is NOT regenerated, sequence[0] of the OLD sequence is returned.
   *
   * This test confirms the bug EXISTS: the old sequence is reused instead of a fresh one.
   * NOTE: This test is EXPECTED TO FAIL after the fix is applied (fresh sequence means
   * callNumber returns newSequence[0] which will differ from oldSequence[0] in general).
   *
   * Validates: Design section "Backend — incomplete reset"
   */
  it('callNumber returns oldSequence[0] after creator-triggered resetGame (old sequence reused)', async () => {
    // Build a known numberSequence so we can assert against it exactly
    const oldSequence = [42, 7, 55, 13, 30, ...Array.from({ length: 70 }, (_, i) => i + 1)];
    // Ensure it is exactly 75 elements
    const knownSequence = oldSequence.slice(0, 75);

    // Game has already had some numbers called (index has advanced past 0)
    const game = buildActiveGame({
      calledNumbers: [42, 7, 55], // 3 numbers called — next index would be 3 WITHOUT reset
      numberSequence: [...knownSequence],
    });

    // After resetGame mutates the game object, findOne for callNumber must return
    // the mutated (post-reset) state: calledNumbers=[], numberSequence unchanged.
    const postResetGame = {
      ...game,
      calledNumbers: [],
      numberSequence: [...knownSequence], // same old sequence — NOT regenerated (the bug)
    };

    // First call: resetGame fetches the game
    // Second call: callNumber fetches the (now-reset) game
    mockGameFindOne
      .mockResolvedValueOnce(game)         // resetGame's findOne
      .mockResolvedValueOnce(postResetGame); // callNumber's findOne

    mockGameSave.mockImplementation((g: Record<string, unknown>) => Promise.resolve(g));

    // Step 1: reset as creator (succeeds on unfixed code since creatorId matches)
    await service.resetGame(game.id, 'creator-uuid-001');

    // Step 2: call the next number
    const result = await service.callNumber(game.id, 'creator-uuid-001');

    // BUG CONFIRMATION: callNumber returns oldSequence[0] because:
    // - calledNumbers.length = 0  → nextIndex = 0
    // - numberSequence = oldSequence (NOT regenerated)
    // → number = oldSequence[0] = 42
    expect(result.number).toBe(knownSequence[0]); // 42 — the first element of the OLD sequence
    expect(result.remaining).toBe(74);
  });
});

// ---------------------------------------------------------------------------
// FIX CHECK — Task 3.1: Any-user reset now succeeds
// After the fix: the creator-only auth guard has been removed from resetGame.
// Any authenticated user can now trigger a reset without receiving a 403.
// ---------------------------------------------------------------------------

describe('FIX CHECK — Task 3.1: Any-user reset now succeeds', () => {
  /**
   * Fix check: resetGame called by a non-creator user MUST resolve without error.
   * Before the fix this would throw AppError(403, 'FORBIDDEN').
   * After the fix (creator-only guard removed) it MUST complete successfully.
   *
   * Validates: Requirements 2.2
   */
  it('resolves without error when resetGame is called by a non-creator user', async () => {
    const game = buildActiveGame(); // creatorId = 'creator-uuid-001'
    mockGameFindOne.mockResolvedValue(game);
    mockGameSave.mockResolvedValue(game);

    const nonCreatorId = 'player-uuid-999'; // different from game.creatorId

    // This MUST NOT throw — the fix removed the 403 guard
    await expect(service.resetGame(game.id, nonCreatorId)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FIX CHECK — Task 3.2: Reset clears both fields
// After the fix: resetGame must clear calledNumbers AND regenerate numberSequence.
// ---------------------------------------------------------------------------

describe('FIX CHECK — Task 3.2: Reset clears both fields', () => {
  /**
   * Fix check: after resetGame, the saved game must have:
   *   1. calledNumbers === []
   *   2. numberSequence.length === 75
   *   3. numberSequence is a valid permutation of 1–75 (each number exactly once)
   *   4. numberSequence is NOT the same as the original sequence (freshly regenerated)
   *
   * Validates: Requirements 2.1, 2.3
   */
  it('saves calledNumbers=[] and a fresh 75-element permutation of 1–75 after reset', async () => {
    // Known original sequence: simple ascending order 1..75
    const originalSequence = Array.from({ length: 75 }, (_, i) => i + 1);

    const game = buildActiveGame({
      calledNumbers: [10, 22, 45, 67, 3],
      numberSequence: [...originalSequence],
    });

    // Capture the object passed to save()
    let savedGame: Record<string, unknown> | undefined;
    mockGameFindOne.mockResolvedValue(game);
    mockGameSave.mockImplementation((g: Record<string, unknown>) => {
      savedGame = {
        ...g,
        calledNumbers: Array.isArray(g.calledNumbers) ? [...(g.calledNumbers as number[])] : g.calledNumbers,
        numberSequence: Array.isArray(g.numberSequence) ? [...(g.numberSequence as number[])] : g.numberSequence,
      };
      return Promise.resolve(g);
    });

    // Call resetGame as a non-creator user (any authenticated user should work after fix)
    await service.resetGame(game.id, 'player-uuid-999');

    // 1. calledNumbers must be cleared
    expect(savedGame!.calledNumbers).toEqual([]);

    const newSequence = savedGame!.numberSequence as number[];

    // 2. numberSequence must have exactly 75 elements
    expect(newSequence).toHaveLength(75);

    // 3. numberSequence must be a valid permutation of 1–75
    //    (sorted copy must equal [1, 2, ..., 75])
    const sorted = [...newSequence].sort((a, b) => a - b);
    expect(sorted).toEqual(originalSequence);

    // 4. numberSequence must have been regenerated (not the same as the original ascending order)
    //    The original is a trivially sorted array; shuffleNumbers() will almost certainly differ.
    //    We check it is not reference-equal AND not deeply equal to the sorted original.
    //    (The probability of a random shuffle producing 1..75 in order is 1/75! ≈ 0)
    expect(newSequence).not.toEqual(originalSequence);
  });
});

// ---------------------------------------------------------------------------
// FIX CHECK — Task 3.3: callNumber after reset uses new sequence index 0
// After the fix: resetGame regenerates numberSequence with shuffleNumbers().
// calledNumbers becomes []. callNumber then uses calledNumbers.length (=0)
// as index into the NEW numberSequence.
// ---------------------------------------------------------------------------

describe('FIX CHECK — Task 3.3: callNumber after reset uses new sequence index 0', () => {
  /**
   * Fix check: after resetGame, calling callNumber must return the FIRST element
   * of the NEW (regenerated) numberSequence — not the old sequence.
   *
   * Approach:
   *  1. Set up game with known calledNumbers and old numberSequence.
   *  2. Capture the new numberSequence from mockGameSave during resetGame.
   *  3. Mock findOne to return the post-reset game state for callNumber.
   *  4. Assert result.number === capturedNewSequence[0] and remaining === 74.
   *
   * Validates: Requirements 2.1, 2.3
   */
  it('returns newSequence[0] and remaining=74 when callNumber is invoked after resetGame', async () => {
    // Build a game that has had some numbers called already
    const oldSequence = Array.from({ length: 75 }, (_, i) => i + 1); // ascending 1..75
    const game = buildActiveGame({
      calledNumbers: [1, 2, 3, 4, 5],  // 5 numbers called — next index would be 5 without reset
      numberSequence: [...oldSequence],
    });

    // Step 1: capture the new numberSequence written by resetGame
    let capturedNewSequence: number[] | undefined;

    mockGameFindOne.mockResolvedValueOnce(game); // resetGame's findOne
    mockGameSave.mockImplementation((g: Record<string, unknown>) => {
      // Capture the sequence saved during resetGame
      if (Array.isArray(g.numberSequence)) {
        capturedNewSequence = [...(g.numberSequence as number[])];
      }
      return Promise.resolve(g);
    });

    // Step 2: perform the reset (any authenticated user — fix removed the creator-only guard)
    await service.resetGame(game.id, 'player-uuid-999');

    // Sanity: verify the capture worked
    expect(capturedNewSequence).toBeDefined();
    expect(capturedNewSequence).toHaveLength(75);

    // Step 3: build the post-reset game state using the captured new sequence
    const postResetGame = {
      ...game,
      calledNumbers: [],                          // reset cleared this
      numberSequence: [...capturedNewSequence!],  // new sequence from shuffleNumbers()
    };

    // Mock findOne for the subsequent callNumber call
    mockGameFindOne.mockResolvedValueOnce(postResetGame);
    // Reset save mock for callNumber's save
    mockGameSave.mockImplementation((g: Record<string, unknown>) => Promise.resolve(g));

    // Step 4: call the next number
    const result = await service.callNumber(game.id, 'creator-uuid-001');

    // Assert: the returned number is the FIRST element of the NEW sequence
    expect(result.number).toBe(capturedNewSequence![0]);

    // Assert: 74 numbers remain (75 total - 1 just called)
    expect(result.remaining).toBe(74);

    // Extra guard: the returned number must NOT be oldSequence[0] if the new
    // sequence differs from the old one. Since oldSequence[0] = 1 (ascending),
    // and shuffleNumbers() almost never returns [1,2,...,75] in order, this
    // assertion catches the case where the old sequence was reused accidentally.
    // (We skip this probabilistic check to avoid flakiness; the primary assertions above are sufficient.)
  });
});

// ---------------------------------------------------------------------------
// FIX CHECK — Task 3.4: Reset on non-active game still throws 400
// The fix only removed the creator-only auth guard and added numberSequence
// regeneration. The status check must remain: non-active games cannot be reset.
// ---------------------------------------------------------------------------

describe('FIX CHECK — Task 3.4: Reset on non-active game still throws 400', () => {
  /**
   * Fix check: `resetGame` called on a `pending` game must still throw
   * AppError with statusCode=400 and code='INVALID_STATE'.
   *
   * The fix did NOT remove the status guard — it only removed the creator-only
   * authorization check. This test ensures that guard remains intact.
   *
   * Validates: Requirements 3.1 (preservation — status guard unchanged)
   */
  it('throws 400 INVALID_STATE when resetGame is called on a pending game', async () => {
    const pendingGame = {
      id: 'game-uuid-pending',
      creatorId: 'creator-uuid-001',
      status: 'pending',
      calledNumbers: [],
      numberSequence: [],
      betAmount: 50,
      housePercentage: 20,
      winPattern: 'any',
      winnerIds: [],
    };

    mockGameFindOne.mockResolvedValue(pendingGame);

    let caught: AppError | undefined;
    try {
      await service.resetGame(pendingGame.id, 'any-user-uuid-001');
    } catch (err) {
      caught = err as AppError;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.statusCode).toBe(400);
    expect(caught!.code).toBe('INVALID_STATE');
  });

  /**
   * Fix check: `resetGame` called on a `finished` game must still throw
   * AppError with statusCode=400 and code='INVALID_STATE'.
   *
   * Validates: Requirements 3.4 (preservation — finished game record kept intact)
   */
  it('throws 400 INVALID_STATE when resetGame is called on a finished game', async () => {
    const finishedGame = {
      id: 'game-uuid-finished',
      creatorId: 'creator-uuid-001',
      status: 'finished',
      calledNumbers: [1, 15, 30, 45, 60, 75],
      numberSequence: Array.from({ length: 75 }, (_, i) => i + 1),
      betAmount: 50,
      housePercentage: 20,
      winPattern: 'any',
      winnerIds: ['winner-uuid-001'],
    };

    mockGameFindOne.mockResolvedValue(finishedGame);

    let caught: AppError | undefined;
    try {
      await service.resetGame(finishedGame.id, 'any-user-uuid-001');
    } catch (err) {
      caught = err as AppError;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.statusCode).toBe(400);
    expect(caught!.code).toBe('INVALID_STATE');
  });
});

// ---------------------------------------------------------------------------
// PRESERVATION — Task 5.1: pending→active transition still starts fresh
// Verify that startGame followed by callNumber returns sequence[0].
// The fix (removed creator-only guard, added numberSequence regen in resetGame)
// must NOT affect the normal pending→active game start path.
// ---------------------------------------------------------------------------

describe('PRESERVATION — Task 5.1: pending→active transition still starts fresh', () => {
  /**
   * Preservation check: when a game transitions from pending to active via
   * startGame() and the creator immediately calls the first number, the
   * returned number must be sequence[0] of the game's numberSequence.
   *
   * This verifies that the fix to resetGame has no side-effect on the
   * normal start-then-call flow.
   *
   * Validates: Requirements 3.2 (preservation — pending→active unchanged)
   */
  it('callNumber returns sequence[0] and remaining=74 on first call after startGame', async () => {
    // A pending game with a known numberSequence so we can assert the exact first number
    const knownSequence = [37, 4, 68, 21, 55, ...Array.from({ length: 70 }, (_, i) => i + 1)].slice(0, 75);

    const pendingGame = {
      id: 'game-uuid-pending-5-1',
      creatorId: 'creator-uuid-001',
      status: 'pending',
      calledNumbers: [],
      numberSequence: [...knownSequence],
      betAmount: 50,
      housePercentage: 20,
      winPattern: 'any',
      winnerIds: [],
    };

    // After startGame the game becomes active (same id/sequence)
    const activeGame = { ...pendingGame, status: 'active', startedAt: new Date() };

    // startGame fetches the pending game, saves it as active
    // callNumber then fetches the active game
    mockGameFindOne
      .mockResolvedValueOnce(pendingGame)   // startGame's findOne
      .mockResolvedValueOnce(activeGame);   // callNumber's findOne

    mockGameSave.mockImplementation((g: Record<string, unknown>) => Promise.resolve(g));

    // Step 1: transition to active
    const startedGame = await service.startGame(pendingGame.id, 'creator-uuid-001');
    expect(startedGame.status).toBe('active');

    // Step 2: call the first number
    const result = await service.callNumber(pendingGame.id, 'creator-uuid-001');

    // The first called number must be sequence[0] (calledNumbers was [] before this call)
    expect(result.number).toBe(knownSequence[0]); // 37
    expect(result.remaining).toBe(74);
  });
});

// ---------------------------------------------------------------------------
// PRESERVATION — Task 5.2: cartela marking unaffected
// Verify that markNumber on an active game produces correct outcomes and
// is completely unaffected by the resetGame fix.
// ---------------------------------------------------------------------------

// Additional mocks needed for UserCartela repository (findOne + save)
const mockUCFindOne = jest.fn();
const mockUCSave = jest.fn();

// Patch the UserCartela repo to also expose findOne and save.
// We reach into the already-mocked AppDataSource and override the UserCartela repo
// returned by getRepository for tests that need it.
// NOTE: The module-level mock factory returns { find: mockUCFind } for UserCartela;
// here we supply findOne/save by monkey-patching after the service is constructed.
// The simplest approach: spy on the private ucRepo via Object.defineProperty.

describe('PRESERVATION — Task 5.2: cartela marking unaffected', () => {
  /**
   * Preservation check: markNumber validates and persists a number mark on a
   * UserCartela. This path touches only ucRepo (not gameRepo / resetGame), so
   * the bugfix must leave it completely intact.
   *
   * We spy on the private ucRepo to inject a controlled cartela and capture the
   * saved state, then verify the returned outcome matches expectations.
   *
   * Validates: Requirements 3.3 (preservation — cartela marking unchanged)
   */
  it('markNumber returns isWinner=false and null pattern when the mark does not complete a winning pattern', async () => {
    // Build a UserCartela with numbers 1–25 (no free-space set up yet)
    // patternMask all false except centre (index 12) which is always true
    const patternMask = Array(25).fill(false);
    patternMask[12] = true;
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25

    const cartela = {
      id: 'uc-uuid-mark-01',
      userId: 'user-uuid-0001',
      numbers,
      patternMask: [...patternMask],
      isWinner: false,
      winPattern: null,
    };

    // Spy on the private ucRepo used by the service instance
    const ucRepoSpy = {
      findOne: jest.fn().mockResolvedValue({ ...cartela }),
      save: jest.fn().mockImplementation((uc: Record<string, unknown>) => Promise.resolve(uc)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).ucRepo = ucRepoSpy;

    // Mark number 5 (index 4 in numbers array) — does not complete any pattern
    const result = await service.markNumber('uc-uuid-mark-01', 'user-uuid-0001', 5);

    expect(result.isWinner).toBe(false);
    expect(result.pattern).toBeNull();

    // Verify save was called — the persistence path executed
    expect(ucRepoSpy.save).toHaveBeenCalledTimes(1);
    const savedCartela = ucRepoSpy.save.mock.calls[0][0] as Record<string, unknown>;
    // The marked number's index (4) should now be true in patternMask
    expect((savedCartela.patternMask as boolean[])[4]).toBe(true);
  });

  it('markNumber returns isWinner=true when the mark completes a full row (row 0: indices 0–4)', async () => {
    // Pre-mark indices 1,2,3 so that marking number at index 0 completes row 0
    const patternMask = Array(25).fill(false);
    patternMask[12] = true; // free space
    // Row 0: positions 0,1,2,3,4 — pre-mark 1,2,3,4
    patternMask[1] = true;
    patternMask[2] = true;
    patternMask[3] = true;
    patternMask[4] = true;

    const numbers = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25 (row 0 = 1,2,3,4,5)

    const cartela = {
      id: 'uc-uuid-mark-02',
      userId: 'user-uuid-0001',
      numbers,
      patternMask: [...patternMask],
      isWinner: false,
      winPattern: null,
    };

    const ucRepoSpy = {
      findOne: jest.fn().mockResolvedValue({ ...cartela }),
      save: jest.fn().mockImplementation((uc: Record<string, unknown>) => Promise.resolve(uc)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).ucRepo = ucRepoSpy;

    // Mark number 1 (index 0) — this completes row 0
    const result = await service.markNumber('uc-uuid-mark-02', 'user-uuid-0001', 1);

    // The marking completes a row, so isWinner must be true
    expect(result.isWinner).toBe(true);
    expect(result.pattern).not.toBeNull();
    expect(ucRepoSpy.save).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PRESERVATION — Task 5.3: finished game preserves calledNumbers
// Verify that finishGame retains the calledNumbers list in the saved game record.
// ---------------------------------------------------------------------------

describe('PRESERVATION — Task 5.3: finished game preserves calledNumbers', () => {
  /**
   * Preservation check: finishGame must set game.status = 'finished' while
   * leaving game.calledNumbers untouched. The fix only modifies resetGame;
   * finishGame must be completely unaffected.
   *
   * Validates: Requirements 3.4 (preservation — finished game record kept intact)
   */
  it('finishGame preserves calledNumbers in the final saved game record', async () => {
    const calledNumbers = [7, 14, 21, 38, 55, 62, 3, 44];

    const game = buildActiveGame({
      id: 'game-uuid-finish-5-3',
      creatorId: 'creator-uuid-001',
      calledNumbers: [...calledNumbers],
      numberSequence: Array.from({ length: 75 }, (_, i) => i + 1),
      betAmount: 50,
      prizePool: 200,
      winnerIds: [],
    });

    // User with cartelaBonusEnabled=false to skip the bonus path (no gcRepo needed)
    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: false }));
    mockGameFindOne.mockResolvedValue(game);

    // Capture what gets saved in the transaction
    let savedGame: Record<string, unknown> | undefined;
    mockTransactionFn.mockImplementation(async (cb: Function) => {
      const mgr = {
        save: jest.fn().mockImplementation((entity: unknown) => {
          if (!Array.isArray(entity)) {
            const e = entity as Record<string, unknown>;
            if (e.status === 'finished') {
              savedGame = {
                ...e,
                calledNumbers: Array.isArray(e.calledNumbers) ? [...(e.calledNumbers as number[])] : e.calledNumbers,
              };
            }
          }
          return Promise.resolve(entity);
        }),
        increment: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      };
      return cb(mgr);
    });

    const result = await service.finishGame(game.id, 'creator-uuid-001');

    // The game returned in the result must retain calledNumbers
    expect(result.game.calledNumbers).toEqual(calledNumbers);

    // The game saved inside the transaction must also retain calledNumbers
    expect(savedGame).toBeDefined();
    expect(savedGame!.calledNumbers).toEqual(calledNumbers);

    // And status must be finished
    expect(savedGame!.status).toBe('finished');
  });

  it('finishGame does not call resetGame and leaves numberSequence unchanged', async () => {
    const originalSequence = Array.from({ length: 75 }, (_, i) => i + 1);
    const game = buildActiveGame({
      id: 'game-uuid-finish-seq-5-3',
      creatorId: 'creator-uuid-001',
      calledNumbers: [1, 2, 3],
      numberSequence: [...originalSequence],
      betAmount: 50,
      prizePool: 200,
      winnerIds: [],
    });

    mockUserFindOne.mockResolvedValue(buildUser({ cartelaBonusEnabled: false }));
    mockGameFindOne.mockResolvedValue(game);

    let savedGame: Record<string, unknown> | undefined;
    mockTransactionFn.mockImplementation(async (cb: Function) => {
      const mgr = {
        save: jest.fn().mockImplementation((entity: unknown) => {
          if (!Array.isArray(entity)) {
            const e = entity as Record<string, unknown>;
            if (e.status === 'finished') {
              savedGame = {
                ...e,
                numberSequence: Array.isArray(e.numberSequence) ? [...(e.numberSequence as number[])] : e.numberSequence,
              };
            }
          }
          return Promise.resolve(entity);
        }),
        increment: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      };
      return cb(mgr);
    });

    await service.finishGame(game.id, 'creator-uuid-001');

    // numberSequence must be untouched by finishGame — it is not resetGame
    expect(savedGame).toBeDefined();
    expect(savedGame!.numberSequence).toEqual(originalSequence);
  });
});
