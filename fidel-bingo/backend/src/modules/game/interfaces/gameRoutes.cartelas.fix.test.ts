/**
 * Fix Checking Test — Task 3.1
 *
 * Validates: Requirements 2.1, 2.2 (Property 1 — cartelas scoped to requesting user)
 *
 * This test seeds a game with cartelas for two distinct users (User A and User B),
 * calls the GET /games/:gameId/cartelas handler as User A (non-admin player), and
 * asserts that the response contains ONLY User A's cartela — NOT User B's.
 *
 * This test is EXPECTED TO PASS on FIXED code — the assertion confirms that the
 * userId filter is correctly applied and no other user's cartela data is exposed.
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

const FIX_USER_A_ID = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
const FIX_USER_B_ID = 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';
const FIX_GAME_ID   = 'f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3';
const FIX_USER_C_ID = 'f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4';

let fixUserACartelaId: string;
let fixUserBCartelaId: string;
let fixGcAId: string;
let fixGcBId: string;

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
     VALUES ($1, 'fix_user_a', 'fix_user_a@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIX_USER_A_ID]
  );

  // Seed User B
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'fix_user_b', 'fix_user_b@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIX_USER_B_ID]
  );

  // Seed User C (non-participant — has no cartelas in the game)
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'fix_user_c', 'fix_user_c@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIX_USER_C_ID]
  );

  // Seed a game (creator = User A)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 2, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0,
             '{}', 2, 2, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIX_GAME_ID, FIX_USER_A_ID]
  );

  // Seed UserCartela for User A (card_number 101)
  const ucAResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 101, '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [FIX_USER_A_ID]
  );
  fixUserACartelaId = ucAResult[0].id;

  // Seed UserCartela for User B (card_number 202)
  const ucBResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 202, '{26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [FIX_USER_B_ID]
  );
  fixUserBCartelaId = ucBResult[0].id;

  // Link User A's cartela to the game
  const gcAResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [FIX_GAME_ID, fixUserACartelaId, FIX_USER_A_ID]
  );
  fixGcAId = gcAResult[0].id;

  // Link User B's cartela to the game
  const gcBResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [FIX_GAME_ID, fixUserBCartelaId, FIX_USER_B_ID]
  );
  fixGcBId = gcBResult[0].id;
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    // Clean up in reverse dependency order
    await AppDataSource.query(`DELETE FROM game_cartelas WHERE id IN ($1, $2)`, [fixGcAId, fixGcBId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM user_cartelas WHERE id IN ($1, $2)`, [fixUserACartelaId, fixUserBCartelaId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [FIX_GAME_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM users WHERE id IN ($1, $2)`, [FIX_USER_A_ID, FIX_USER_B_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [FIX_USER_C_ID]).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── Fix Checking Test ─────────────────────────────────────────────────────────
describe('GET /api/games/:gameId/cartelas — fix: non-admin receives only own cartelas (Property 1)', () => {
  /**
   * Task 3.1 — Non-admin user receives ONLY their own cartelas after the fix.
   *
   * User A calls GET /games/:gameId/cartelas as a non-admin player.
   * The fixed handler filters by userId, so only User A's cartela (card_number 101)
   * is returned. User B's cartela (card_number 202) must NOT appear.
   *
   * Validates: Requirements 2.1, 2.2
   */
  it('User A receives only their own cartela (card 101), not User B\'s (card 202)', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${FIX_GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${playerToken(FIX_USER_A_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<{ cardNumber?: number }> = res.body.data;

    // Only User A's cartela should be returned
    expect(data.length).toBe(1);
    expect(data[0].cardNumber).toBe(101);

    // User B's cartela must NOT be present
    const userBCartelaInResponse = data.some((entry) => entry.cardNumber === 202);
    expect(userBCartelaInResponse).toBe(false);
  });
});

// ── Fix Checking Test (Task 3.2) ──────────────────────────────────────────────
describe('GET /api/games/:gameId/cartelas — fix: non-participant receives empty array (Property 1)', () => {
  /**
   * Task 3.2 — Non-admin user with NO cartelas in the game receives an empty array.
   *
   * User C has never joined the game (no game_cartelas row for User C).
   * The fixed handler filters by userId, so the response must be an empty array.
   *
   * Validates: Requirements 2.1
   */
  it('User C (non-participant) receives an empty array', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${FIX_GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${playerToken(FIX_USER_C_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<unknown> = res.body.data;

    // User C has no cartelas in this game — response must be empty
    expect(data.length).toBe(0);
  });
});
