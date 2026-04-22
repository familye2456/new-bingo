/**
 * Property-Based Tests: Ownership Filtering Logic
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * Property 1: Agent sees own users
 *   For any agent A, every user returned by GET / has createdBy === A.id OR createdBy === null
 *
 * Property 2: Admin sees all players
 *   Admin always receives the full player set regardless of createdBy
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../../config/database';
import { errorHandler } from '../../../shared/middleware/errorHandler';
import userRoutes from './userRoutes';

// ── Minimal test app ─────────────────────────────────────────────────────────
const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/users', userRoutes);
testApp.use(errorHandler);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// ── Fixed UUIDs for test actors ───────────────────────────────────────────────
const ADMIN_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENT_A_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const AGENT_B_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeToken(id: string, role: 'admin' | 'agent'): string {
  return jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '1h' });
}

// Extend timeout for remote DB connections
jest.setTimeout(60000);

// ── DB lifecycle ─────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Seed actors (admin + two agents)
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES
       ($1, 'filter_admin',   'filter_admin@test.com',   'hash', 'admin', 'active', 0, 'prepaid', NOW(), NOW()),
       ($2, 'filter_agent_a', 'filter_agent_a@test.com', 'hash', 'agent', 'active', 0, 'prepaid', NOW(), NOW()),
       ($3, 'filter_agent_b', 'filter_agent_b@test.com', 'hash', 'agent', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN_ID, AGENT_A_ID, AGENT_B_ID]
  );

  // Seed a varied set of players:
  //   - 3 owned by agent A
  //   - 2 owned by agent B
  //   - 2 with created_by = NULL (legacy / unassigned)
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_by, created_at, updated_at)
     VALUES
       (gen_random_uuid(), 'fp_a1', 'fp_a1@test.com', 'hash', 'player', 'active', 0, 'prepaid', $1, NOW(), NOW()),
       (gen_random_uuid(), 'fp_a2', 'fp_a2@test.com', 'hash', 'player', 'active', 0, 'prepaid', $1, NOW(), NOW()),
       (gen_random_uuid(), 'fp_a3', 'fp_a3@test.com', 'hash', 'player', 'active', 0, 'prepaid', $1, NOW(), NOW()),
       (gen_random_uuid(), 'fp_b1', 'fp_b1@test.com', 'hash', 'player', 'active', 0, 'prepaid', $2, NOW(), NOW()),
       (gen_random_uuid(), 'fp_b2', 'fp_b2@test.com', 'hash', 'player', 'active', 0, 'prepaid', $2, NOW(), NOW()),
       (gen_random_uuid(), 'fp_n1', 'fp_n1@test.com', 'hash', 'player', 'active', 0, 'prepaid', NULL, NOW(), NOW()),
       (gen_random_uuid(), 'fp_n2', 'fp_n2@test.com', 'hash', 'player', 'active', 0, 'prepaid', NULL, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [AGENT_A_ID, AGENT_B_ID]
  );
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.query(
      `DELETE FROM users WHERE email LIKE '%@test.com'`
    ).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── Property 1: Agent sees own users ─────────────────────────────────────────
/**
 * **Validates: Requirements 4.1, 4.2**
 *
 * For any agent A, every user returned by GET / has:
 *   createdBy === A.id  OR  createdBy === null
 *
 * We test this across multiple agent identities (agent A and agent B) to
 * confirm the property holds universally, not just for one specific agent.
 */
describe('Property 1: Agent sees own users — GET / returns only own players or null-owned players', () => {
  const agentCases = [
    { label: 'agent A', id: AGENT_A_ID },
    { label: 'agent B', id: AGENT_B_ID },
  ];

  it.each(agentCases)(
    '$label: every returned user has createdBy === agent.id OR createdBy === null',
    async ({ id }) => {
      const res = await supertest(testApp)
        .get('/api/users')
        .set('Authorization', `Bearer ${makeToken(id, 'agent')}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const users: Array<{ createdBy?: string | null }> = res.body.data;
      expect(users.length).toBeGreaterThan(0);

      // Property: every returned user must be owned by this agent or unowned
      for (const user of users) {
        const owned = user.createdBy === id || user.createdBy === null || user.createdBy === undefined;
        expect(owned).toBe(true);
      }
    }
  );

  it('agent A does NOT see players owned by agent B', async () => {
    const res = await supertest(testApp)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(AGENT_A_ID, 'agent')}`);

    expect(res.status).toBe(200);
    const users: Array<{ createdBy?: string | null }> = res.body.data;

    const seesAgentBPlayers = users.some((u) => u.createdBy === AGENT_B_ID);
    expect(seesAgentBPlayers).toBe(false);
  });

  it('agent A sees null-owned (legacy) players', async () => {
    const res = await supertest(testApp)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(AGENT_A_ID, 'agent')}`);

    expect(res.status).toBe(200);
    const users: Array<{ createdBy?: string | null }> = res.body.data;

    const hasNullOwned = users.some((u) => u.createdBy === null || u.createdBy === undefined);
    expect(hasNullOwned).toBe(true);
  });
});

// ── Property 2: Admin sees all players ───────────────────────────────────────
/**
 * **Validates: Requirements 4.3**
 *
 * Admin always receives the full player set regardless of createdBy.
 * The admin result must be a superset of what any individual agent sees.
 */
describe('Property 2: Admin sees all players — GET / returns full player set', () => {
  it('admin result is a superset of agent A result', async () => {
    const [adminRes, agentRes] = await Promise.all([
      supertest(testApp)
        .get('/api/users')
        .set('Authorization', `Bearer ${makeToken(ADMIN_ID, 'admin')}`),
      supertest(testApp)
        .get('/api/users')
        .set('Authorization', `Bearer ${makeToken(AGENT_A_ID, 'agent')}`),
    ]);

    expect(adminRes.status).toBe(200);
    expect(agentRes.status).toBe(200);

    const adminIds = new Set<string>(adminRes.body.data.map((u: { id: string }) => u.id));
    const agentIds: string[] = agentRes.body.data.map((u: { id: string }) => u.id);

    // Every user the agent sees must also appear in the admin list
    for (const id of agentIds) {
      expect(adminIds.has(id)).toBe(true);
    }
  });

  it('admin result includes players owned by agent B (not visible to agent A)', async () => {
    const [adminRes, agentARes] = await Promise.all([
      supertest(testApp)
        .get('/api/users')
        .set('Authorization', `Bearer ${makeToken(ADMIN_ID, 'admin')}`),
      supertest(testApp)
        .get('/api/users')
        .set('Authorization', `Bearer ${makeToken(AGENT_A_ID, 'agent')}`),
    ]);

    expect(adminRes.status).toBe(200);
    expect(agentARes.status).toBe(200);

    const adminUsers: Array<{ id: string; createdBy?: string | null }> = adminRes.body.data;
    const agentAIds = new Set<string>(agentARes.body.data.map((u: { id: string }) => u.id));

    // Admin must see at least one player that agent A cannot see (agent B's players)
    const adminOnlyUsers = adminUsers.filter((u) => !agentAIds.has(u.id));
    expect(adminOnlyUsers.length).toBeGreaterThan(0);
  });

  it('admin result contains players with every createdBy value (A, B, and null)', async () => {
    const res = await supertest(testApp)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(ADMIN_ID, 'admin')}`);

    expect(res.status).toBe(200);
    const users: Array<{ createdBy?: string | null }> = res.body.data;

    const createdByValues = new Set(users.map((u) => u.createdBy ?? null));
    expect(createdByValues.has(AGENT_A_ID)).toBe(true);
    expect(createdByValues.has(AGENT_B_ID)).toBe(true);
    expect(createdByValues.has(null)).toBe(true);
  });
});
