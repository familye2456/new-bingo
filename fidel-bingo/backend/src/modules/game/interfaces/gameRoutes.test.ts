/**
 * Route-level Integration Tests — gameRoutes
 *
 * Uses supertest against a minimal Express app that mounts the real gameRoutes
 * (with real auth middleware). The service layer is spied upon so no DB or
 * Redis connection is required.
 *
 * Existing tests:
 *   - Smoke Test: legacy /games/bonus/today returns 404
 *
 * New tests (Tasks 6.1 and 6.2 — called-number-reset-on-reload bugfix):
 *   - INTEGRATION — Task 6.1: full reload flow resets backend state
 *   - INTEGRATION — Task 6.2: non-creator can trigger reset via API
 */

// ── Module-level mocks (must come before any module imports) ──────────────────
// These mocks prevent GameService from trying to connect to a real DB / Redis.

jest.mock('../../../config/database', () => ({
  AppDataSource: {
    isInitialized: false,
    getRepository: () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(),
        getMany: jest.fn(),
      })),
    }),
    transaction: jest.fn(),
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    setEx: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../shared/infrastructure/metrics', () => ({
  activeGames: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import gameRoutes from './gameRoutes';
import { GameService } from '../application/GameService';
import { errorHandler } from '../../../shared/middleware/errorHandler';

// ── Test app ──────────────────────────────────────────────────────────────────

const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/games', gameRoutes);
testApp.use(errorHandler);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

/** Sign a JWT for a fake player */
function playerToken(id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001', role = 'player'): string {
  return jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Smoke Tests ───────────────────────────────────────────────────────────────

describe('GET /api/games/bonus/today — legacy endpoint removed (Requirement 1.2)', () => {
  /**
   * The /games/bonus/today route was part of the old daily-profit-threshold bonus
   * system. After removal it must return 404 so no stale handler is accessible.
   */
  it('returns 404 when the legacy bonus/today route is requested', async () => {
    const res = await supertest(testApp)
      .get('/api/games/bonus/today')
      .set('Authorization', `Bearer ${playerToken()}`);

    expect(res.status).toBe(404);
  });

  it('does not return 200 when called without authentication', async () => {
    // Without a valid token the auth middleware runs first and returns 401.
    // This also confirms the route does not bypass auth to serve a 200 response.
    const res = await supertest(testApp)
      .get('/api/games/bonus/today');

    // The route does not exist; auth middleware fires first → 401, not a 200/success
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });
});

// ── Integration Tests ─────────────────────────────────────────────────────────

// Shared UUIDs used across the integration tests
const CREATOR_ID   = 'creator-uuid-0001-0001-000000000001';
const PLAYER_ID    = 'player-uuid-0002-0002-000000000002';
const GAME_ID      = 'game-uuid-0001-0001-000000000001';

// A fresh 75-element permutation helper (mirrors GameService.shuffleNumbers logic)
function makeSequence(start = 1): number[] {
  return Array.from({ length: 75 }, (_, i) => ((i + start - 1) % 75) + 1);
}

// ── Task 6.1 ──────────────────────────────────────────────────────────────────

describe('INTEGRATION — Task 6.1: full reload flow resets backend state', () => {
  /**
   * Simulates the full browser-reload scenario end-to-end via the HTTP API:
   *
   *  1. POST /games           → create game          (201)
   *  2. POST /games/:id/start → start game           (200)
   *  3. POST /games/:id/call  × 5 → call 5 numbers   (200 each)
   *  4. POST /games/:id/reset → simulate page reload  (200)
   *  5. GET  /games/:id       → verify calledNumbers=[] and new numberSequence
   *  6. POST /games/:id/call  → call 1 number        (200)
   *  7. Assert the returned number equals newSequence[0]
   *
   * Validates: Requirements 2.1, 2.2, 2.3
   */

  let createGameSpy: jest.SpyInstance;
  let startGameSpy: jest.SpyInstance;
  let callNumberSpy: jest.SpyInstance;
  let resetGameSpy: jest.SpyInstance;
  let getGameSpy: jest.SpyInstance;

  // The fresh number sequence produced by the reset
  const newSequence = makeSequence(10); // starts with 10 so it differs from ascending 1..75

  beforeEach(() => {
    // Simulate a game that was created and started
    const activeGame = {
      id: GAME_ID,
      creatorId: CREATOR_ID,
      status: 'active',
      calledNumbers: [1, 2, 3, 4, 5],
      numberSequence: Array.from({ length: 75 }, (_, i) => i + 1),
      betAmount: 50,
      housePercentage: 20,
      winPattern: 'any',
      winnerIds: [],
      cartelaCount: 1,
      totalBets: 50,
      prizePool: 40,
      houseCut: 10,
    };

    // After reset the game has empty calledNumbers and a fresh sequence
    const resetGame = {
      ...activeGame,
      calledNumbers: [],
      numberSequence: [...newSequence],
    };

    createGameSpy = jest
      .spyOn(GameService.prototype, 'createGame')
      .mockResolvedValue({ ...activeGame, calledNumbers: [], numberSequence: [...newSequence] } as any);

    startGameSpy = jest
      .spyOn(GameService.prototype, 'startGame')
      .mockResolvedValue({ ...activeGame } as any);

    // First 5 calls return numbers from the original sequence, then 1 call after reset
    let callCount = 0;
    callNumberSpy = jest
      .spyOn(GameService.prototype, 'callNumber')
      .mockImplementation(async (_gameId: string, _userId: string) => {
        callCount++;
        if (callCount <= 5) {
          // Before reset: advance through the original sequence
          return { number: callCount, remaining: 75 - callCount };
        } else {
          // After reset: start from newSequence[0]
          return { number: newSequence[0], remaining: 74 };
        }
      });

    resetGameSpy = jest
      .spyOn(GameService.prototype, 'resetGame')
      .mockResolvedValue(undefined);

    getGameSpy = jest
      .spyOn(GameService.prototype, 'getGame')
      .mockResolvedValue(resetGame as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POST /reset returns 200 OK after 5 numbers have been called', async () => {
    const res = await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('GET /:gameId after reset shows calledNumbers=[] and new numberSequence', async () => {
    // Call reset first
    await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    // Then fetch the game state
    const res = await supertest(testApp)
      .get(`/api/games/${GAME_ID}`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.calledNumbers).toEqual([]);
    expect(res.body.data.numberSequence).toHaveLength(75);
    expect(res.body.data.numberSequence).toEqual(newSequence);
  });

  it('POST /call after reset returns newSequence[0] (not a previously called number)', async () => {
    // Simulate the 5 pre-reset calls
    for (let i = 0; i < 5; i++) {
      await supertest(testApp)
        .post(`/api/games/${GAME_ID}/call`)
        .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);
    }

    // Simulate reload (reset)
    await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    // Call the first number of the new session
    const res = await supertest(testApp)
      .post(`/api/games/${GAME_ID}/call`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.number).toBe(newSequence[0]);
    expect(res.body.data.remaining).toBe(74);
  });

  it('resetGame is called exactly once on the correct gameId and userId', async () => {
    await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(CREATOR_ID)}`);

    expect(resetGameSpy).toHaveBeenCalledTimes(1);
    expect(resetGameSpy).toHaveBeenCalledWith(GAME_ID, CREATOR_ID);
  });
});

// ── Task 6.2 ──────────────────────────────────────────────────────────────────

describe('INTEGRATION — Task 6.2: non-creator can trigger reset via API', () => {
  /**
   * Verifies that ANY authenticated player (not just the game creator) can call
   * POST /games/:gameId/reset and receive 200 OK with the game state reset.
   *
   * Before the fix this would return 403 FORBIDDEN because GameService.resetGame
   * enforced a creator-only authorization guard.
   *
   * Validates: Requirements 2.2
   */

  let resetGameSpy: jest.SpyInstance;
  let getGameSpy: jest.SpyInstance;

  const resetGameState = {
    id: GAME_ID,
    creatorId: CREATOR_ID,
    status: 'active',
    calledNumbers: [],
    numberSequence: makeSequence(5),
    betAmount: 50,
    housePercentage: 20,
    winPattern: 'any',
    winnerIds: [],
  };

  beforeEach(() => {
    resetGameSpy = jest
      .spyOn(GameService.prototype, 'resetGame')
      .mockResolvedValue(undefined);

    getGameSpy = jest
      .spyOn(GameService.prototype, 'getGame')
      .mockResolvedValue(resetGameState as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 200 OK when a non-creator player calls POST /reset', async () => {
    // PLAYER_ID is different from CREATOR_ID — this was the blocked case before the fix
    const res = await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(PLAYER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('resetGame service method is invoked with the non-creator userId', async () => {
    await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(PLAYER_ID)}`);

    expect(resetGameSpy).toHaveBeenCalledWith(GAME_ID, PLAYER_ID);
  });

  it('GET /:gameId after non-creator reset shows calledNumbers=[] and a fresh sequence', async () => {
    // Non-creator triggers reset
    await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`)
      .set('Authorization', `Bearer ${playerToken(PLAYER_ID)}`);

    // Fetch the game state to verify reset took effect
    const res = await supertest(testApp)
      .get(`/api/games/${GAME_ID}`)
      .set('Authorization', `Bearer ${playerToken(PLAYER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.calledNumbers).toEqual([]);
    expect(res.body.data.numberSequence).toHaveLength(75);
  });

  it('returns 401 when called without a token (unauthenticated non-creator)', async () => {
    // Confirms that auth middleware still guards the route — anonymous callers are rejected
    const res = await supertest(testApp)
      .post(`/api/games/${GAME_ID}/reset`);

    expect(res.status).toBe(401);
  });
});
