/**
 * Bug Condition Exploration Test — Task 1.1
 *
 * Validates: Requirements 1.1 (data-leak on GET /games/:gameId/cartelas)
 *
 * This test seeds a game with cartelas for two distinct users (User A and User B),
 * calls the GET /games/:gameId/cartelas handler as User A, and asserts that
 * User B's cartela IS present in the response.
 *
 * This test is EXPECTED TO PASS on UNFIXED code — the assertion confirms the
 * data-leak bug exists (User A can see User B's cartela data).
 *
 * After the fix is applied (Task 2.1), this test should FAIL because User B's
 * cartela will no longer be returned to User A.
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../../config/database';
import { errorHandler } from '../../../shared/middleware/errorHandler';
import gameRoutes from './gameRoutes';

// ── Build a minimal test app ──────────────────────────────────────────────────
const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/games', gameRoutes);
testApp.use(errorHandler);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

const USER_A_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const USER_B_ID = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const USER_C_ID = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const GAME_ID   = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

let userACartelaId: string;
let userBCartelaId: string;
let gcAId: string;
let gcBId: string;

function playerToken(userId: string): string {
  return jwt.sign({ id: userId, role: 'player' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Seed User A
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'bug_user_a', 'bug_user_a@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [USER_A_ID]
  );

  // Seed User B
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'bug_user_b', 'bug_user_b@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [USER_B_ID]
  );

  // Seed User C (non-participant — no cartelas in the game)
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'bug_user_c', 'bug_user_c@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [USER_C_ID]
  );

  // Seed a game (creator = User A)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 1, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0,
             '{}', 2, 2, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [GAME_ID, USER_A_ID]
  );

  // Seed UserCartela for User A
  const ucAResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 101, '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [USER_A_ID]
  );
  userACartelaId = ucAResult[0].id;

  // Seed UserCartela for User B
  const ucBResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 202, '{26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [USER_B_ID]
  );
  userBCartelaId = ucBResult[0].id;

  // Link User A's cartela to the game
  const gcAResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [GAME_ID, userACartelaId, USER_A_ID]
  );
  gcAId = gcAResult[0].id;

  // Link User B's cartela to the game
  const gcBResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [GAME_ID, userBCartelaId, USER_B_ID]
  );
  gcBId = gcBResult[0].id;
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    // Clean up in reverse dependency order
    await AppDataSource.query(`DELETE FROM game_cartelas WHERE id IN ($1, $2)`, [gcAId, gcBId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM user_cartelas WHERE id IN ($1, $2)`, [userACartelaId, userBCartelaId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [GAME_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [USER_A_ID, USER_B_ID, USER_C_ID]).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── Bug Condition Exploration Test ────────────────────────────────────────────
describe('GET /api/games/:gameId/cartelas — bug condition: data-leak (Requirements 1.1)', () => {
  /**
   * Cross-user leak test (Task 1.1)
   *
   * User A calls GET /games/:gameId/cartelas.
   * On UNFIXED code the handler returns ALL cartelas for the game (no userId filter),
   * so User B's cartela IS present in the response — this assertion PASSES and
   * confirms the bug exists.
   *
   * After the fix (Task 2.1) the handler will filter by userId, so User B's cartela
   * will NOT be in the response and this assertion will FAIL (expected behaviour
   * post-fix).
   */
  it('User A response contains User B cartela (confirms data-leak on unfixed code)', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${playerToken(USER_A_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<{ cardNumber?: number }> = res.body.data;

    // The response must contain at least 2 entries (both users' cartelas)
    expect(data.length).toBeGreaterThanOrEqual(2);

    // User B's cartela (card_number 202) must be present — this is the data-leak
    const userBCartelaInResponse = data.some((entry) => entry.cardNumber === 202);
    expect(userBCartelaInResponse).toBe(true);
  });

  /**
   * Non-participant test (Task 1.2)
   *
   * User C has NO cartelas in the game (they never joined).
   * On UNFIXED code the handler returns ALL cartelas for the game (no userId filter),
   * so the response is non-empty even though User C has no cartelas — this assertion
   * PASSES and confirms the bug exists.
   *
   * After the fix (Task 2.1) the handler will filter by userId, so User C will
   * receive an empty array and this assertion will FAIL (expected behaviour post-fix).
   */
  it('User C (non-participant) response is non-empty (confirms data-leak on unfixed code)', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${playerToken(USER_C_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<unknown> = res.body.data;

    // On unfixed code the response contains all cartelas for the game even though
    // User C has no cartelas — this non-empty assertion confirms the data-leak.
    expect(data.length).toBeGreaterThan(0);
  });
});
