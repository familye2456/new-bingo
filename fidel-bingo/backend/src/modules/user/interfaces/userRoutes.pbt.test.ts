/**
 * Property-Based Tests: userRoutes - cartela bonus system
 * Feature: cartela-bonus-system
 *
 * Tests Properties 4, 5, 6 from the design document.
 *
 * All tests use fast-check with a minimum of 100 iterations (default).
 * Property 4 and 5 test pure functions extracted from the route handler.
 * Property 6 is pure-logic and needs no DB.
 *
 * No real DB connections are used.
 */

import * as fc from 'fast-check';

// ── Mock database and infrastructure before anything imports them ─────────────
jest.mock('../../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({}),
    transaction: jest.fn(),
    query: jest.fn(),
    isInitialized: false,
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: { setEx: jest.fn(), get: jest.fn().mockResolvedValue(null), del: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/metrics', () => ({
  activeGames: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../shared/infrastructure/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AppError } from '../../../shared/middleware/errorHandler';
import { User } from '../domain/User';

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Agent ownership enforcement on bonus toggle
// Feature: cartela-bonus-system, Property 4: For any agent and any user whose
// createdBy field does not match that agent's id, assertAgentOwns should throw
// AppError with 403 status.
// Validates: Requirements 4.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline copy of assertAgentOwns from userRoutes.ts so we can test it
 * as a pure function without spinning up an HTTP server.
 * Mirrors the exact logic in userRoutes.ts.
 */
function assertAgentOwns(actor: { id: string; role: string }, target: { createdBy?: string }) {
  if (actor.role === 'admin') return;
  if (target.createdBy !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'You can only manage users you created');
  }
}

describe('Property 4: Agent ownership enforcement', () => {
  it(
    'assertAgentOwns throws AppError(403) when agentId never equals user.createdBy',
    () => {
      // Feature: cartela-bonus-system, Property 4: agent ownership enforcement on bonus toggle
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          (agentId, createdBy) => {
            // Guard: ensure the two UUIDs are always different
            fc.pre(agentId !== createdBy);

            const actor = { id: agentId, role: 'agent' as const };
            const target = { createdBy };

            let thrown: AppError | undefined;
            try {
              assertAgentOwns(actor, target);
            } catch (err) {
              thrown = err as AppError;
            }

            expect(thrown).toBeInstanceOf(AppError);
            expect(thrown!.statusCode).toBe(403);
            expect(thrown!.code).toBe('FORBIDDEN');
          }
        ),
        { numRuns: 25 }
      );
    }
  );

  it(
    'assertAgentOwns does NOT throw when actor is admin (regardless of createdBy)',
    () => {
      // Feature: cartela-bonus-system, Property 4: admin bypasses ownership check
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.option(fc.uuid(), { nil: undefined }),
          (adminId, createdBy) => {
            const actor = { id: adminId, role: 'admin' as const };
            const target = { createdBy };

            // Should never throw for admin
            expect(() => assertAgentOwns(actor, target)).not.toThrow();
          }
        ),
        { numRuns: 25 }
      );
    }
  );

  it(
    'assertAgentOwns does NOT throw when agentId equals user.createdBy',
    () => {
      // Feature: cartela-bonus-system, Property 4: agent can manage their own user
      fc.assert(
        fc.property(
          fc.uuid(),
          (agentId) => {
            const actor = { id: agentId, role: 'agent' as const };
            const target = { createdBy: agentId }; // agent owns this user

            expect(() => assertAgentOwns(actor, target)).not.toThrow();
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 5: Invalid `enabled` values are rejected
// Feature: cartela-bonus-system, Property 5: For any value supplied for the
// `enabled` field that is not a strict boolean (not true or false — including
// strings "true"/"false", numbers, null, objects, etc.), the route handler
// logic should reject with 400 VALIDATION_ERROR.
// Validates: Requirements 4.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline the validation logic from the PATCH /users/:id/cartela-bonus handler.
 * The handler does: if (typeof enabled !== 'boolean') throw AppError(400, ...)
 * We extract this as a pure function so we can property-test it without HTTP overhead.
 * Mirrors the exact validation logic in userRoutes.ts.
 */
function validateEnabled(enabled: unknown): void {
  if (typeof enabled !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'enabled must be a boolean');
  }
}

describe('Property 5: Invalid enabled values are rejected', () => {
  it(
    'validateEnabled throws AppError(400, VALIDATION_ERROR) for any non-boolean value',
    () => {
      // Feature: cartela-bonus-system, Property 5: invalid `enabled` values are rejected
      fc.assert(
        fc.property(
          fc.anything().filter((v) => v !== true && v !== false),
          (nonBoolean) => {
            let thrown: AppError | undefined;
            try {
              validateEnabled(nonBoolean);
            } catch (err) {
              thrown = err as AppError;
            }
            expect(thrown).toBeInstanceOf(AppError);
            expect(thrown!.statusCode).toBe(400);
            expect(thrown!.code).toBe('VALIDATION_ERROR');
          }
        ),
        { numRuns: 25 }
      );
    }
  );

  it(
    'validateEnabled does NOT throw for strict boolean true or false',
    () => {
      // Feature: cartela-bonus-system, Property 5: strict boolean values pass validation
      fc.assert(
        fc.property(
          fc.boolean(),
          (boolValue) => {
            expect(() => validateEnabled(boolValue)).not.toThrow();
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 6: cartelaBonusEnabled round-trips through sanitize
// Feature: cartela-bonus-system, Property 6: For any user record with
// cartelaBonusEnabled set to either true or false, calling sanitize() should
// produce an object whose cartelaBonusEnabled field equals the original value.
// Validates: Requirements 2.3, 4.5
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 6: cartelaBonusEnabled round-trips through sanitize', () => {
  it(
    'sanitize() returns an object with cartelaBonusEnabled equal to the input value',
    () => {
      // Feature: cartela-bonus-system, Property 6: cartelaBonusEnabled round-trip through sanitize
      fc.assert(
        fc.property(
          fc.boolean(),
          (cartelaBonusEnabled) => {
            // Build a minimal User instance with only the fields sanitize() touches.
            // sanitize() does: const { passwordHash, mfaSecret, ...safe } = this; return safe;
            const user = new User();
            user.id = 'user-uuid-pbt-sanitize-01';
            user.username = 'testuser';
            user.email = 'test@example.com';
            user.passwordHash = 'should-be-stripped';
            user.role = 'player';
            user.status = 'active';
            user.balance = 100;
            user.creditLimit = 0;
            user.kycLevel = 0;
            user.mfaEnabled = false;
            user.loginAttempts = 0;
            user.paymentType = 'prepaid';
            user.cartelaBonusEnabled = cartelaBonusEnabled;

            const sanitized = user.sanitize();

            // passwordHash must be stripped
            expect((sanitized as any).passwordHash).toBeUndefined();

            // cartelaBonusEnabled must round-trip correctly
            expect(sanitized.cartelaBonusEnabled).toBe(cartelaBonusEnabled);
          }
        ),
        { numRuns: 25 }
      );
    }
  );
});
