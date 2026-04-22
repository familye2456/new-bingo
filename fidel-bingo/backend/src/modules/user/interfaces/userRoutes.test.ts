/**
 * Bug Condition Exploration Test
 * Property 1: POST /api/users Returns 500 on Valid Input
 *
 * Validates: Requirements 1.1
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * When the fix is applied (Task 3), this same test should PASS.
 *
 * Counterexample being tested:
 *   POST /api/users { username: "testuser", email: "test@example.com", password: "Password1!" }
 *   authenticated as admin → expected 201, actual 500 (bug)
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../../config/database';
import { errorHandler } from '../../../shared/middleware/errorHandler';
import userRoutes from './userRoutes';

// ── Build a minimal test app (no server startup, no Redis, no sockets) ──────
const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/users', userRoutes);
testApp.use(errorHandler);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

/** Sign a JWT for a fake admin actor */
function adminToken(id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'): string {
  return jwt.sign({ id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

const ADMIN_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── DB lifecycle ─────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  // Seed the fake admin actor so the actor existence check in POST /api/users passes
  await AppDataSource.query(
    `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
     VALUES ($1, 'testadmin', 'testadmin@example.com', 'hash', 'admin', 'active', 0, 'prepaid', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN_UUID]
  );
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    // Clean up the seeded admin actor
    await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [ADMIN_UUID]).catch(() => {});
    await AppDataSource.destroy();
  }
});

// ── Cleanup: remove the test user if it was accidentally created ─────────────
afterEach(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.query(
      `DELETE FROM users WHERE email = 'test@example.com' OR username = 'testuser'`
    ).catch(() => {});
  }
});

// ── Bug Condition Exploration Test ───────────────────────────────────────────
describe('POST /api/users — bug condition exploration (Requirements 1.1)', () => {
  /**
   * Property 1: Bug Condition
   * A valid { username, email, password } payload submitted by an admin
   * SHOULD return HTTP 201 with success: true.
   *
   * On UNFIXED code this test FAILS with HTTP 500 — that failure IS the proof
   * the bug exists. Once the fix is applied (Task 3) this test will PASS.
   */
  it('returns 201 and success:true when admin creates a user with valid payload', async () => {
    const res = await supertest(testApp)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password1!',
      });

    // Expected behavior (2.1): HTTP 201, success: true, user data returned
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.username).toBe('testuser');
    expect(res.body.data.email).toBe('test@example.com');
    // password hash must NOT be exposed
    expect(res.body.data.passwordHash).toBeUndefined();
  });
});

// ── Preservation Property Tests ───────────────────────────────────────────────
/**
 * Property 2: Preservation — Existing Error Paths and Side-Effects Are Unchanged
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * These tests cover the non-bug-condition input space and MUST PASS on UNFIXED code.
 * They guard against regressions when the fix is applied.
 */

/** Sign a JWT for a fake agent actor */
function agentToken(id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'): string {
  const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
  return jwt.sign({ id, role: 'agent' }, JWT_SECRET, { expiresIn: '1h' });
}

// Cleanup for preservation tests
afterEach(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.query(
      `DELETE FROM users WHERE email IN ('dup@example.com', 'unique1@example.com', 'agentcreated@example.com') OR username IN ('dupuser', 'uniqueuser1', 'agentcreated')`
    ).catch(() => {});
  }
});

describe('POST /api/users — preservation: 409 on duplicate email/username (Requirements 3.1)', () => {
  /**
   * Property 2.1: Duplicate email/username → HTTP 409 USER_EXISTS
   *
   * For any request where the actor is an admin AND the payload is valid
   * but conflicts with an existing user, the system SHALL return 409 USER_EXISTS.
   *
   * Validates: Requirements 3.1
   */
  it.each([
    { label: 'duplicate email', first: { username: 'uniqueuser1', email: 'dup@example.com', password: 'Password1!' }, second: { username: 'anotheruser', email: 'dup@example.com', password: 'Password1!' } },
    { label: 'duplicate username', first: { username: 'dupuser', email: 'unique1@example.com', password: 'Password1!' }, second: { username: 'dupuser', email: 'other@example.com', password: 'Password1!' } },
  ])('returns 409 USER_EXISTS on $label', async ({ first, second }) => {
    // Seed the first user directly via DB to avoid depending on the buggy POST route
    const { AppDataSource: ds } = await import('../../../config/database');
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(first.password, 1);
    await ds.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, balance, payment_type, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'player', 'active', 0, 'prepaid', NOW(), NOW())`,
      [first.username, first.email, hash]
    );

    const res = await supertest(testApp)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(second);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('USER_EXISTS');
  });
});

describe('POST /api/users — preservation: 403 when agent creates agent-role user (Requirements 3.2)', () => {
  /**
   * Property 2.2: Agent requesting role:"agent" → HTTP 403 FORBIDDEN
   *
   * For any request where the actor is an agent AND the payload requests role:"agent",
   * the system SHALL return 403 FORBIDDEN.
   *
   * Validates: Requirements 3.2
   */
  it.each([
    { username: 'agentcreated', email: 'agentcreated@example.com', password: 'Password1!', role: 'agent' },
    { username: 'agentcreated2', email: 'agentcreated2@example.com', password: 'Secret99!', role: 'agent' },
  ])('returns 403 FORBIDDEN when agent tries to create role:agent user ($username)', async (payload) => {
    const res = await supertest(testApp)
      .post('/api/users')
      .set('Authorization', `Bearer ${agentToken()}`)
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/users — preservation: 400 on missing required fields (Requirements 3.1)', () => {
  /**
   * Property 2.3: Missing required fields → HTTP 400 VALIDATION_ERROR
   *
   * For any request missing username, email, or password, the system SHALL return 400.
   *
   * Validates: Requirements 3.1 (error paths unchanged)
   */
  it.each([
    { label: 'missing username', payload: { email: 'x@example.com', password: 'Password1!' } },
    { label: 'missing email', payload: { username: 'xuser', password: 'Password1!' } },
    { label: 'missing password', payload: { username: 'xuser', email: 'x@example.com' } },
  ])('returns 400 VALIDATION_ERROR on $label', async ({ payload }) => {
    const res = await supertest(testApp)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

// ── Frontend-only preservation behaviors (not testable in backend suite) ──────
describe('Preservation: frontend-only behaviors (Requirements 3.4, 3.5)', () => {
  /**
   * NOTE: The following preservation requirements are frontend behaviors that
   * cannot be verified in this backend integration test suite:
   *
   * 3.4 — WHEN the Create User modal is closed or cancelled THEN the form resets
   *        to its empty state (emptyForm). This is verified manually or via
   *        frontend component tests in UserManagement.test.tsx.
   *
   * 3.5 — WHEN a user is successfully created THEN the users list query
   *        (['admin-users'] and ['admin-agents']) is invalidated and refreshed.
   *        This is verified manually or via frontend integration tests.
   */
  it.skip('3.4 — modal close resets form state (frontend only — verified manually)', () => {});
  it.skip('3.5 — successful create invalidates users list query (frontend only — verified manually)', () => {});
});
