/**
 * Unit Tests: GameService - free cartela bonus logic
 *
 * Mocked DB/transaction objects so no real DB connection is needed.
 */

import { AppError } from '../../../shared/middleware/errorHandler';

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
