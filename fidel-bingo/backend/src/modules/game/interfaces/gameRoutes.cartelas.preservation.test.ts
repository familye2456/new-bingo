/**
 * Preservation Test — Task 4.1
 *
 * Validates: Requirements 3.1 (Property 2 — admin full visibility unchanged)
 *
 * This test seeds a game with cartelas for two distinct users (User A and User B),
 * calls the GET /games/:gameId/cartelas handler as an admin, and asserts that ALL
 * cartelas for the game are returned — not filtered by userId.
 *
 * This test is EXPECTED TO PASS on FIXED code — confirming that the fix does not
 * break admin visibility.
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import * as fc from 'fast-check';
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

const PRES_ADMIN_ID  = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
const PRES_USER_A_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const PRES_USER_B_ID = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2';
const PRES_GAME_ID   = 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3';

let presUserACartelaId: string;
let presUserBCartelaId: string;
let presGcAId: string;
let presGcBId: string;

function adminToken(): string {
  return jwt.sign({ id: PRES_ADMIN_ID, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Seed admin user
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'pres_admin', 'pres_admin@example.com', 'hash', 'admin', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PRES_ADMIN_ID],
  );

  // Seed User A
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'pres_user_a', 'pres_user_a@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PRES_USER_A_ID],
  );

  // Seed User B
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'pres_user_b', 'pres_user_b@example.com', 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PRES_USER_B_ID],
  );

  // Seed a game (creator = User A)
  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, 901, $2, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0,
             '{}', 2, 2, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PRES_GAME_ID, PRES_USER_A_ID],
  );

  // Seed UserCartela for User A (card_number 901)
  const ucAResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 901,
             '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [PRES_USER_A_ID],
  );
  presUserACartelaId = ucAResult[0].id;

  // Seed UserCartela for User B (card_number 902)
  const ucBResult = await AppDataSource.query(
    `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
     VALUES ($1, 902,
             '{26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50}',
             '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
             true, false, NOW())
     RETURNING id`,
    [PRES_USER_B_ID],
  );
  presUserBCartelaId = ucBResult[0].id;

  // Link User A's cartela to the game
  const gcAResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [PRES_GAME_ID, presUserACartelaId, PRES_USER_A_ID],
  );
  presGcAId = gcAResult[0].id;

  // Link User B's cartela to the game
  const gcBResult = await AppDataSource.query(
    `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
     VALUES ($1, $2, $3, 10, NOW())
     RETURNING id`,
    [PRES_GAME_ID, presUserBCartelaId, PRES_USER_B_ID],
  );
  presGcBId = gcBResult[0].id;
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.query(`DELETE FROM game_cartelas WHERE id IN ($1, $2)`, [presGcAId, presGcBId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM user_cartelas WHERE id IN ($1, $2)`, [presUserACartelaId, presUserBCartelaId]).catch(() => {});
    await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [PRES_GAME_ID]).catch(() => {});
    await AppDataSource.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [PRES_ADMIN_ID, PRES_USER_A_ID, PRES_USER_B_ID]).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── Preservation Test ─────────────────────────────────────────────────────────
describe('GET /api/games/:gameId/cartelas — preservation: admin receives all cartelas (Property 2)', () => {
  // Extend timeout for remote DB operations
  jest.setTimeout(120000);
  /**
   * Task 4.1 — Admin user receives ALL cartelas for a game regardless of userId.
   *
   * A game is seeded with cartelas for User A (card 901) and User B (card 902).
   * An admin calls GET /games/:gameId/cartelas.
   * The fixed handler must return BOTH cartelas — the userId filter must NOT be
   * applied for admin users.
   *
   * Validates: Requirements 3.1
   */
  it('admin receives all cartelas (User A card 901 AND User B card 902)', async () => {
    const res = await supertest(testApp)
      .get(`/api/games/${PRES_GAME_ID}/cartelas`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data: Array<{ cardNumber?: number }> = res.body.data;

    // Admin must see both cartelas
    expect(data.length).toBe(2);

    const cardNumbers = data.map((entry) => entry.cardNumber);
    expect(cardNumbers).toContain(901);
    expect(cardNumbers).toContain(902);
  });
});

// ── Helpers for PBT (Task 4.2) ────────────────────────────────────────────────

/** Produces a valid UUID-shaped string from two 16-bit integers. */
function makeUuid(namespace: number, index: number): string {
  const ns = namespace.toString(16).padStart(4, '0');
  const idx = index.toString(16).padStart(4, '0');
  const p1 = `${ns}${idx}`;
  const p2 = `${ns}${idx}`.slice(0, 4);
  const p3 = `4${idx}`.slice(0, 4);
  const p4 = `a${idx}`.slice(0, 4);
  const p5 = `${ns}${idx}${ns}${idx}`.slice(0, 12);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/** Seed one game + N users each with one cartela linked to the game. */
async function seedScenario(
  gameId: string,
  userIds: string[],
  cardNumberBase: number,
): Promise<{ userCartelaIds: string[]; gcIds: string[] }> {
  const userCartelaIds: string[] = [];
  const gcIds: string[] = [];

  for (const userId of userIds) {
    await AppDataSource.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, `pbt4_user_${userId.slice(0, 8)}`, `pbt4_${userId.slice(0, 8)}@example.com`],
    );
  }

  await AppDataSource.query(
    `INSERT INTO games (id, game_number, creator_id, status, game_type, called_numbers, number_sequence,
                        bet_amount, house_percentage, total_bets, prize_pool, house_cut,
                        winner_ids, player_count, cartela_count, win_pattern, created_at)
     VALUES ($1, $2, $3, 'pending', 'standard', '{}', '{}',
             10, 10, 0, 0, 0, '{}', $4, $4, 'any', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [gameId, cardNumberBase, userIds[0], userIds.length],
  );

  for (let i = 0; i < userIds.length; i++) {
    const cardNumber = cardNumberBase + i;
    const ucResult = await AppDataSource.query(
      `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
       VALUES ($1, $2,
               '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
               '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
               true, false, NOW())
       RETURNING id`,
      [userIds[i], cardNumber],
    );
    userCartelaIds.push(ucResult[0].id);

    const gcResult = await AppDataSource.query(
      `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
       VALUES ($1, $2, $3, 10, NOW())
       RETURNING id`,
      [gameId, ucResult[0].id, userIds[i]],
    );
    gcIds.push(gcResult[0].id);
  }

  return { userCartelaIds, gcIds };
}

async function cleanupScenario(
  gameId: string,
  userIds: string[],
  userCartelaIds: string[],
  gcIds: string[],
): Promise<void> {
  if (gcIds.length > 0) {
    await AppDataSource.query(`DELETE FROM game_cartelas WHERE id = ANY($1::uuid[])`, [gcIds]).catch(() => {});
  }
  if (userCartelaIds.length > 0) {
    await AppDataSource.query(`DELETE FROM user_cartelas WHERE id = ANY($1::uuid[])`, [userCartelaIds]).catch(() => {});
  }
  await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [gameId]).catch(() => {});
  if (userIds.length > 0) {
    await AppDataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  }
}

// ── PBT: Property 2 — Admin Full Visibility (Task 4.2) ────────────────────────
describe('GET /api/games/:gameId/cartelas — PBT: admin receives full unfiltered set (Property 2)', () => {
  // Extend timeout for PBT with remote DB operations (5 runs × ~10s each)
  jest.setTimeout(120000);
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Property 2: For any generated game/cartela configuration, the admin response
   * equals the full unfiltered set — count matches the number of seeded cartelas
   * and all seeded card numbers are present.
   *
   * Generator: arbitrary number of users (2–4), each with one cartela in the game.
   * The admin calls GET /games/:gameId/cartelas and must see ALL of them.
   */
  it('admin response contains ALL seeded cartelas for any game configuration', async () => {
    // Unique run counter to avoid card_number collisions across runs
    let runIndex = 0;

    await fc.assert(
      fc.asyncProperty(
        // Generate 2–4 distinct user indices
        fc.integer({ min: 2, max: 4 }).chain((count) =>
          fc.uniqueArray(fc.integer({ min: 0, max: 9999 }), {
            minLength: count,
            maxLength: count,
          }),
        ),
        async (userIndices) => {
          const runId = runIndex++;
          const gameId = makeUuid(0xcc00 + runId, 0);
          const userIds = userIndices.map((idx) => makeUuid(0xdd00, idx));
          const cardNumberBase = 7000 + runId * 100;

          let userCartelaIds: string[] = [];
          let gcIds: string[] = [];

          try {
            ({ userCartelaIds, gcIds } = await seedScenario(gameId, userIds, cardNumberBase));

            const res = await supertest(testApp)
              .get(`/api/games/${gameId}/cartelas`)
              .set('Authorization', `Bearer ${adminToken()}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const data: Array<{ cardNumber?: number }> = res.body.data;

            // Admin must see ALL seeded cartelas — count must match
            expect(data.length).toBe(userIds.length);

            // Every seeded card number must be present in the response
            const returnedCardNumbers = data.map((e) => e.cardNumber);
            for (let i = 0; i < userIds.length; i++) {
              expect(returnedCardNumbers).toContain(cardNumberBase + i);
            }
          } finally {
            await cleanupScenario(gameId, userIds, userCartelaIds, gcIds);
          }
        },
      ),
      { numRuns: 5 },
    );
  });
});
