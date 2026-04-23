/**
 * End-to-End Integration Test — Task 5.1
 *
 * Validates: Requirement 2.1
 *
 * Full flow: two users join a game, each calls GET /games/:gameId/cartelas,
 * and each receives ONLY their own cartela data — not the other user's.
 *
 * This test runs against the FIXED code and confirms the data-isolation
 * property holds end-to-end.
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

// ── Stable UUIDs — use a distinct namespace (e2e…) to avoid collisions ───────
const E2E_CREATOR_ID = 'e2e00001-e2e0-e2e0-e2e0-e2e000000001';
const E2E_USER_A_ID  = 'e2e00002-e2e0-e2e0-e2e0-e2e000000002';
const E2E_USER_B_ID  = 'e2e00003-e2e0-e2e0-e2e0-e2e000000003';
const E2E_GAME_ID    = 'e2e00010-e2e0-e2e0-e2e0-e2e000000010';

// Tracked IDs for cleanup
let userACartelaId: string;
let userBCartelaId: string;
let gcAId: string;
let gcBId: string;

function token(userId: string, role: 'player' | 'admin' = 'player'): string {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '1h' });
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  jest.setTimeout(120000);
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Seed users: creator, User A, User B
  for (const [id, username, email] of [
    [E2E_CREATOR_ID, 'e2e_creator', 'e2e_creator@example.com'],
    [E2E_USER_A_ID,  'e2e_user_a',  'e2e_user_a@example.com'],
    [E2E_USER_B_ID,  'e2e_user_b',  'e2e_user_b@example.com'],
  ] as const) {
    await AppDataSource.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'hash', 'player', 'active', 1000, 'prepaid', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, username, email],
    );
  }

  // Seed the game (created by CREATOR, pending so players can join)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 5001, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0, '{}', 0, 0, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [E2E_GAME_ID, E2E_CREATOR_ID],
  );

  // User A joins via POST /games/:gameId/join
  const joinARes = await supertest(testApp)
    .post(`/api/games/${E2E_GAME_ID}/join`)
    .set('Authorization', `Bearer ${token(E2E_USER_A_ID)}`)
    .send({ cartelaCount: 1 });

  if (joinARes.status !== 200) {
    throw new Error(`User A join failed: ${joinARes.status} ${JSON.stringify(joinARes.body)}`);
  }

  // User B joins via POST /games/:gameId/join
  const joinBRes = await supertest(testApp)
    .post(`/api/games/${E2E_GAME_ID}/join`)
    .set('Authorization', `Bearer ${token(E2E_USER_B_ID)}`)
    .send({ cartelaCount: 1 });

  if (joinBRes.status !== 200) {
    throw new Error(`User B join failed: ${joinBRes.status} ${JSON.stringify(joinBRes.body)}`);
  }

  // Capture the cartela IDs returned by the join responses for cleanup
  // The join endpoint returns an array of GameCartela-shaped objects
  const aCartela = joinARes.body.data[0];
  const bCartela = joinBRes.body.data[0];

  userACartelaId = aCartela?.userCartelaId ?? aCartela?.id;
  userBCartelaId = bCartela?.userCartelaId ?? bCartela?.id;
  gcAId = aCartela?.id;
  gcBId = bCartela?.id;
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    // Clean up in reverse FK order
    await AppDataSource.query(
      `DELETE FROM game_cartelas WHERE game_id = $1`,
      [E2E_GAME_ID],
    ).catch(() => {});
    await AppDataSource.query(
      `DELETE FROM transactions WHERE game_id = $1`,
      [E2E_GAME_ID],
    ).catch(() => {});
    if (userACartelaId) {
      await AppDataSource.query(
        `DELETE FROM user_cartelas WHERE id = $1`,
        [userACartelaId],
      ).catch(() => {});
    }
    if (userBCartelaId) {
      await AppDataSource.query(
        `DELETE FROM user_cartelas WHERE id = $1`,
        [userBCartelaId],
      ).catch(() => {});
    }
    await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [E2E_GAME_ID]).catch(() => {});
    await AppDataSource.query(
      `DELETE FROM users WHERE id IN ($1, $2, $3)`,
      [E2E_CREATOR_ID, E2E_USER_A_ID, E2E_USER_B_ID],
    ).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── E2E: Data isolation between two players ───────────────────────────────────
describe('GET /api/games/:gameId/cartelas — E2E: each user sees only their own cartela (Requirement 2.1)', () => {
  jest.setTimeout(120000);

  /**
   * User A calls GET /games/:gameId/cartelas.
   * The response must contain ONLY User A's cartela — not User B's.
   *
   * Validates: Requirement 2.1
   */
  it('User A receives only their own cartela, not User B\'s', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${E2E_GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${token(E2E_USER_A_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<{ userId?: string }> = res.body.data;

    // Must have at least one cartela (User A's own)
    expect(data.length).toBeGreaterThan(0);

    // Every returned entry must belong to User A
    for (const entry of data) {
      expect(entry.userId).toBe(E2E_USER_A_ID);
    }

    // User B's cartela must NOT appear
    const userIds = data.map((e) => e.userId);
    expect(userIds).not.toContain(E2E_USER_B_ID);
  });

  /**
   * User B calls GET /games/:gameId/cartelas.
   * The response must contain ONLY User B's cartela — not User A's.
   *
   * Validates: Requirement 2.1
   */
  it('User B receives only their own cartela, not User A\'s', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${E2E_GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${token(E2E_USER_B_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<{ userId?: string }> = res.body.data;

    // Must have at least one cartela (User B's own)
    expect(data.length).toBeGreaterThan(0);

    // Every returned entry must belong to User B
    for (const entry of data) {
      expect(entry.userId).toBe(E2E_USER_B_ID);
    }

    // User A's cartela must NOT appear
    const userIds = data.map((e) => e.userId);
    expect(userIds).not.toContain(E2E_USER_A_ID);
  });

  /**
   * Cross-check: the two users received different cartela data.
   * This confirms the isolation is real and not an artifact of both users
   * coincidentally having the same cartela. Uses cartela `id` (always unique)
   * as the disjoint key.
   *
   * Validates: Requirement 2.1
   */
  it('User A and User B receive distinct cartela data', async () => {
    const [resA, resB] = await Promise.all([
      supertest(testApp)
        .get(`/api/games/${E2E_GAME_ID}/cartelas`)
        .set('Authorization', `Bearer ${token(E2E_USER_A_ID)}`),
      supertest(testApp)
        .get(`/api/games/${E2E_GAME_ID}/cartelas`)
        .set('Authorization', `Bearer ${token(E2E_USER_B_ID)}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const idsA: string[] = resA.body.data.map((e: { id?: string }) => e.id);
    const idsB: string[] = resB.body.data.map((e: { id?: string }) => e.id);

    // The two sets of cartela IDs must be disjoint — no shared cartelas
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
