/**
 * Smoke Test — Task 5.1: Remove /games/bonus/today endpoint
 *
 * Validates: Requirement 1.2
 *
 * Verifies that the legacy GET /games/bonus/today route has been removed
 * and returns 404 (unmatched route falls through to Express's default 404
 * handling) so no stale handler is accessible.
 */

import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import gameRoutes from './gameRoutes';

// ── Build a minimal test app (no DB, no Redis, no sockets needed) ─────────────
const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use('/api/games', gameRoutes);
// No errorHandler — we just want the raw 404 from Express when no route matches

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

/** Sign a JWT for a fake player (auth middleware requires a valid token) */
function playerToken(id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'): string {
  return jwt.sign({ id, role: 'player' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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
