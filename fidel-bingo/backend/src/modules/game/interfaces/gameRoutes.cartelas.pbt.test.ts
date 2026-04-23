/**
 * Property-Based Test — Task 3.3
 *
 * Validates: Requirements 2.1, 2.2 (Property 1 — cartelas scoped to requesting user)
 *
 * For any generated set of (gameId, userId) cartela entries, the non-admin response
 * contains ONLY entries matching the requesting userId.
 *
 * Uses fast-check with numRuns: 5 to keep DB load low.
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

function playerToken(userId: string): string {
  return jwt.sign({ id: userId, role: 'player' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Deterministic UUID generation from a short index ─────────────────────────
// Produces a valid UUID-shaped string: 8-4-4-4-12 hex chars
// namespace: 0-65535, index: 0-65535
function makeUuid(namespace: number, index: number): string {
  const ns = namespace.toString(16).padStart(4, '0'); // 4 hex chars
  const idx = index.toString(16).padStart(4, '0');   // 4 hex chars
  // 8-4-4-4-12 = 32 hex chars total
  const p1 = `${ns}${idx}`;          // 8 chars
  const p2 = `${ns}${idx}`.slice(0, 4); // 4 chars (reuse ns)
  const p3 = `4${idx}`.slice(0, 4);  // 4 chars (version 4)
  const p4 = `a${idx}`.slice(0, 4);  // 4 chars (variant)
  const p5 = `${ns}${idx}${ns}${idx}`.slice(0, 12); // 12 chars
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed a scenario: one game, N users each with one cartela linked to the game.
 * Returns the IDs created so they can be cleaned up afterwards.
 */
async function seedScenario(
  gameId: string,
  userIds: string[],
  cardNumberBase: number,
): Promise<{ userCartelaIds: string[]; gcIds: string[] }> {
  const userCartelaIds: string[] = [];
  const gcIds: string[] = [];

  // Seed all users FIRST (game.creator_id FK requires the creator to exist)
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    await AppDataSource.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES ($1, $2, $3, 'hash', 'player', 'active', 0, 'prepaid', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, `pbt_user_${userId.slice(0, 8)}`, `pbt_${userId.slice(0, 8)}@example.com`],
    );
  }

  // Seed game (creator_id = userIds[0], which now exists)
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
    const userId = userIds[i];
    const cardNumber = cardNumberBase + i;

    // Seed user_cartela
    const ucResult = await AppDataSource.query(
      `INSERT INTO user_cartelas (user_id, card_number, numbers, pattern_mask, is_active, is_winner, assigned_at)
       VALUES ($1, $2,
               '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25}',
               '{false,false,false,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false,false}',
               true, false, NOW())
       RETURNING id`,
      [userId, cardNumber],
    );
    const ucId: string = ucResult[0].id;
    userCartelaIds.push(ucId);

    // Link to game
    const gcResult = await AppDataSource.query(
      `INSERT INTO game_cartelas (game_id, user_cartela_id, user_id, bet_amount, joined_at)
       VALUES ($1, $2, $3, 10, NOW())
       RETURNING id`,
      [gameId, ucId, userId],
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
    await AppDataSource.query(
      `DELETE FROM game_cartelas WHERE id = ANY($1::uuid[])`,
      [gcIds],
    ).catch(() => {});
  }
  if (userCartelaIds.length > 0) {
    await AppDataSource.query(
      `DELETE FROM user_cartelas WHERE id = ANY($1::uuid[])`,
      [userCartelaIds],
    ).catch(() => {});
  }
  await AppDataSource.query(`DELETE FROM games WHERE id = $1`, [gameId]).catch(() => {});
  if (userIds.length > 0) {
    await AppDataSource.query(
      `DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [userIds],
    ).catch(() => {});
  }
}

// ── Property-Based Test ───────────────────────────────────────────────────────
describe('GET /api/games/:gameId/cartelas — PBT: non-admin receives only own cartelas (Property 1)', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * Property 1: For any generated set of (gameId, userId) cartela entries,
   * the non-admin response contains ONLY entries matching the requesting userId.
   *
   * Generator: arbitrary number of users (2–4), each with one cartela in the game.
   * The requesting user is always the first user in the list.
   */
  it('non-admin response contains only entries matching the requesting userId', async () => {
    // Unique run counter to avoid card_number collisions across runs
    let runIndex = 0;

    await fc.assert(
      fc.asyncProperty(
        // Generate 2–4 distinct user indices (used to build deterministic UUIDs)
        fc.integer({ min: 2, max: 4 }).chain((count) =>
          fc.uniqueArray(fc.integer({ min: 0, max: 9999 }), {
            minLength: count,
            maxLength: count,
          }),
        ),
        async (userIndices) => {
          const runId = runIndex++;
          // Build deterministic UUIDs from indices
          const gameId = makeUuid(0xaa00 + runId, 0);
          const userIds = userIndices.map((idx) => makeUuid(0xbb00, idx));
          const requestingUserId = userIds[0];
          const cardNumberBase = 5000 + runId * 100;

          let userCartelaIds: string[] = [];
          let gcIds: string[] = [];

          try {
            ({ userCartelaIds, gcIds } = await seedScenario(gameId, userIds, cardNumberBase));

            const res = await supertest(testApp)
              .get(`/api/games/${gameId}/cartelas`)
              .set('Authorization', `Bearer ${playerToken(requestingUserId)}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const data: Array<{ userId?: string }> = res.body.data;

            // Every returned entry must belong to the requesting user
            for (const entry of data) {
              expect(entry.userId).toBe(requestingUserId);
            }

            // The requesting user has exactly one cartela in the game
            expect(data.length).toBe(1);
          } finally {
            await cleanupScenario(gameId, userIds, userCartelaIds, gcIds);
          }
        },
      ),
      { numRuns: 5 },
    );
  });
});
