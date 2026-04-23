/**
 * Preservation Integration Tests — Task 4.3
 *
 * Validates: Requirements 3.2, 3.3, 3.4
 *
 * These tests verify that the fix to GET /games/:gameId/cartelas did NOT break
 * any other endpoints:
 *   - GET /games/mine  (Requirement 3.2)
 *   - GET /games       (Requirement 3.3)
 *   - POST /games/:gameId/join, /start, /finish  (Requirement 3.4)
 *
 * All tests run against the FIXED code and confirm the unchanged endpoints
 * continue to behave correctly.
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../../config/database';
import { errorHandler } from '../../../shared/middleware/errorHandler';
import gameRoutes from './gameRoutes';

// ── Minimal test app ──────────────────────────────────────────────────────────
const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/games', gameRoutes);
testApp.use(errorHandler);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// ── Stable UUIDs for this test file ──────────────────────────────────────────
// Use a distinct namespace (e9…) to avoid collisions with other test files.
const INT_CREATOR_ID = 'e9000001-e900-e900-e900-e90000000001';
const INT_PLAYER_ID  = 'e9000002-e900-e900-e900-e90000000002';
const INT_OTHER_ID   = 'e9000003-e900-e900-e900-e90000000003';

// Games seeded directly in DB (no join flow needed for some tests)
const INT_GAME_MINE_ID  = 'e9000010-e900-e900-e900-e90000000010'; // game where PLAYER joined
const INT_GAME_OTHER_ID = 'e9000011-e900-e900-e900-e90000000011'; // game created by OTHER user

// Game used for mutation tests (join / start / finish)
const INT_GAME_MUT_ID   = 'e9000020-e900-e900-e900-e90000000020';

// Tracked IDs for cleanup
let minePLayerUcId: string;
let mineGcId: string;

function token(userId: string, role: 'player' | 'admin' = 'player'): string {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '1h' });
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  jest.setTimeout(120000);
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Seed users
  for (const [id, username, email, role] of [
    [INT_CREATOR_ID, 'int_creator', 'int_creator@example.com', 'player'],
    [INT_PLAYER_ID,  'int_player',  'int_player@example.com',  'player'],
    [INT_OTHER_ID,   'int_other',   'int_other@example.com',   'player'],
  ] as const) {
    await AppDataSource.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'hash', $4, 'active', 1000, 'prepaid', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, username, email, role],
    );
  }

  // Seed INT_GAME_MINE_ID — created by CREATOR, PLAYER has joined (has a game_cartela row)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 9901, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0, '{}', 1, 1, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [INT_GAME_MINE_ID, INT_CREATOR_ID],
  );

  // Seed a UserCartela for PLAYER and link it to INT_GAME_MINE_ID
  const ucResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 9901,
             '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [INT_PLAYER_ID],
  );
  minePLayerUcId = ucResult[0].id;

  const gcResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [INT_GAME_MINE_ID, minePLayerUcId, INT_PLAYER_ID],
  );
  mineGcId = gcResult[0].id;

  // Seed INT_GAME_OTHER_ID — created by OTHER user (CREATOR should NOT see it in GET /games)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 9902, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0, '{}', 0, 0, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [INT_GAME_OTHER_ID, INT_OTHER_ID],
  );

  // Seed INT_GAME_MUT_ID — created by CREATOR, used for mutation tests
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 9903, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0, '{}', 0, 0, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [INT_GAME_MUT_ID, INT_CREATOR_ID],
  );
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    // Clean up in reverse FK order
    await AppDataSource.query(`DELETE FROM game_cartelas WHERE game_id IN ($1, $2, $3)`,
      [INT_GAME_MINE_ID, INT_GAME_OTHER_ID, INT_GAME_MUT_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM user_cartelas WHERE id = $1`, [minePLayerUcId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM transactions WHERE game_id IN ($1, $2, $3)`,
      [INT_GAME_MINE_ID, INT_GAME_OTHER_ID, INT_GAME_MUT_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM games WHERE id IN ($1, $2, $3)`,
      [INT_GAME_MINE_ID, INT_GAME_OTHER_ID, INT_GAME_MUT_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`,
      [INT_CREATOR_ID, INT_PLAYER_ID, INT_OTHER_ID]).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── GET /games/mine — Requirement 3.2 ────────────────────────────────────────
describe('GET /api/games/mine — preservation: filters by userId in game_cartelas (Requirement 3.2)', () => {
  jest.setTimeout(120000);

  /**
   * PLAYER joined INT_GAME_MINE_ID (has a game_cartela row).
   * GET /games/mine as PLAYER must include that game.
   *
   * Validates: Requirement 3.2
   */
  it('returns games where the requesting user has a game_cartela entry', async () => {
    const res = await supertest(testApp)
      .get('/api/games/mine')
      .set('Authorization', `Bearer ${token(INT_PLAYER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const ids: string[] = res.body.data.map((g: { id: string }) => g.id);
    expect(ids).toContain(INT_GAME_MINE_ID);
  });

  /**
   * CREATOR did NOT join INT_GAME_MINE_ID as a player (no game_cartela row for CREATOR).
   * GET /games/mine as CREATOR must NOT include INT_GAME_MINE_ID.
   *
   * Validates: Requirement 3.2
   */
  it('does NOT return games where the requesting user has no game_cartela entry', async () => {
    const res = await supertest(testApp)
      .get('/api/games/mine')
      .set('Authorization', `Bearer ${token(INT_CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const ids: string[] = res.body.data.map((g: { id: string }) => g.id);
    expect(ids).not.toContain(INT_GAME_MINE_ID);
  });
});

// ── GET /games — Requirement 3.3 ─────────────────────────────────────────────
describe('GET /api/games — preservation: non-admin scoped by creatorId (Requirement 3.3)', () => {
  jest.setTimeout(120000);

  /**
   * CREATOR calls GET /games.
   * listGames passes creatorId = CREATOR for non-admin users, so only games
   * where creatorId = CREATOR are returned.
   * INT_GAME_MUT_ID (creatorId = CREATOR) must be present.
   * INT_GAME_OTHER_ID (creatorId = OTHER) must NOT be present.
   *
   * Validates: Requirement 3.3
   */
  it('non-admin user sees only their own games (scoped by creatorId)', async () => {
    const res = await supertest(testApp)
      .get('/api/games')
      .set('Authorization', `Bearer ${token(INT_CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const ids: string[] = res.body.data.map((g: { id: string }) => g.id);
    expect(ids).toContain(INT_GAME_MUT_ID);
    expect(ids).not.toContain(INT_GAME_OTHER_ID);
  });

  /**
   * Admin calls GET /games — must see ALL games (no creatorId filter).
   *
   * Validates: Requirement 3.3 (admin path unchanged)
   */
  it('admin user sees all games (no creatorId filter)', async () => {
    // Seed a temporary admin user for this test
    const ADMIN_ID = 'e9000099-e900-e900-e900-e90000000099';
    await AppDataSource.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES ($1, 'int_admin', 'int_admin@example.com', 'hash', 'admin', 'active', 0, 'prepaid', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID],
    );

    try {
      const res = await supertest(testApp)
        .get('/api/games')
        .set('Authorization', `Bearer ${token(ADMIN_ID, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids: string[] = res.body.data.map((g: { id: string }) => g.id);
      // Admin must see both CREATOR's game and OTHER's game
      expect(ids).toContain(INT_GAME_MUT_ID);
      expect(ids).toContain(INT_GAME_OTHER_ID);
    } finally {
      await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [ADMIN_ID]).catch(() => {});
    }
  });
});

// ── Mutation endpoints — Requirement 3.4 ─────────────────────────────────────
describe('Mutation endpoints — preservation: creatorId ownership checks unchanged (Requirement 3.4)', () => {
  jest.setTimeout(120000);

  /**
   * POST /games/:gameId/start — only the creator can start the game.
   * PLAYER (not the creator) must receive 403.
   *
   * Validates: Requirement 3.4
   */
  it('POST /start — non-creator receives 403', async () => {
    const res = await supertest(testApp)
      .post(`/api/games/${INT_GAME_MUT_ID}/start`)
      .set('Authorization', `Bearer ${token(INT_PLAYER_ID)}`);

    expect(res.status).toBe(403);
  });

  /**
   * POST /games/:gameId/start — creator can start the game.
   *
   * Validates: Requirement 3.4
   */
  it('POST /start — creator can start the game', async () => {
    const res = await supertest(testApp)
      .post(`/api/games/${INT_GAME_MUT_ID}/start`)
      .set('Authorization', `Bearer ${token(INT_CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('active');
  });

  /**
   * POST /games/:gameId/finish — only the creator can finish the game.
   * PLAYER (not the creator) must receive 403.
   *
   * Validates: Requirement 3.4
   */
  it('POST /finish — non-creator receives 403', async () => {
    const res = await supertest(testApp)
      .post(`/api/games/${INT_GAME_MUT_ID}/finish`)
      .set('Authorization', `Bearer ${token(INT_PLAYER_ID)}`);

    expect(res.status).toBe(403);
  });

  /**
   * POST /games/:gameId/finish — creator can finish the game.
   *
   * Validates: Requirement 3.4
   */
  it('POST /finish — creator can finish the game', async () => {
    const res = await supertest(testApp)
      .post(`/api/games/${INT_GAME_MUT_ID}/finish`)
      .set('Authorization', `Bearer ${token(INT_CREATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('finished');
  });

  /**
   * POST /games/:gameId/join — a finished game is not joinable.
   * Confirms the join endpoint enforces game state (not affected by the cartelas fix).
   *
   * Validates: Requirement 3.4
   */
  it('POST /join — cannot join a finished game', async () => {
    // INT_GAME_MUT_ID is now finished from the test above
    const res = await supertest(testApp)
      .post(`/api/games/${INT_GAME_MUT_ID}/join`)
      .set('Authorization', `Bearer ${token(INT_PLAYER_ID)}`)
      .send({ cartelaCount: 1 });

    expect(res.status).toBe(400);
  });

  /**
   * POST /games/:gameId/join — a pending game is joinable by any authenticated user.
   * Confirms the join endpoint is unaffected by the cartelas fix.
   *
   * Validates: Requirement 3.4
   */
  it('POST /join — player can join a pending game', async () => {
    // Seed a fresh pending game for this join test
    const JOIN_GAME_ID = 'e9000030-e900-e900-e900-e90000000030';
    await AppDataSource.query(
      `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                          bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                          winner_ids, player_count, cartela_count, win_pattern, created_at)
       VALUES ($1, 9904, $2, 'pending', 'standard', '{}', '{}',
               10, 10, 0, 0, 0, '{}', 0, 0, 'any', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [JOIN_GAME_ID, INT_CREATOR_ID],
    );

    try {
      const res = await supertest(testApp)
        .post(`/api/games/${JOIN_GAME_ID}/join`)
        .set('Authorization', `Bearer ${token(INT_PLAYER_ID)}`)
        .send({ cartelaCount: 1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
    } finally {
      await AppDataSource.query(`DELETE FROM game_cartelas WHERE game_id = $1`, [JOIN_GAME_ID]).catch(() => {});
      await AppDataSource.query(`DELETE FROM transactions WHERE game_id = $1`, [JOIN_GAME_ID]).catch(() => {});
      await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [JOIN_GAME_ID]).catch(() => {});
    }
  });
});
