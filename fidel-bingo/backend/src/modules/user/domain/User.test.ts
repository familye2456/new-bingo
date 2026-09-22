import { User } from './User';

/**
 * Unit tests for User.sanitize()
 * Validates: Requirements 2.3
 */
describe('User.sanitize()', () => {
  function buildUser(overrides: Partial<User> = {}): User {
    const user = new User();
    user.id = 'test-uuid-1234';
    user.username = 'testuser';
    user.email = 'test@example.com';
    user.passwordHash = 'hashed_password_secret';
    user.role = 'player';
    user.status = 'active';
    user.paymentType = 'prepaid';
    user.balance = 100;
    user.creditLimit = 0;
    user.kycLevel = 0;
    user.mfaEnabled = false;
    user.loginAttempts = 0;
    user.cartelaBonusEnabled = false;
    user.createdAt = new Date('2024-01-01');
    user.updatedAt = new Date('2024-01-01');
    Object.assign(user, overrides);
    return user;
  }

  it('includes cartelaBonusEnabled = true when set to true', () => {
    const user = buildUser({ cartelaBonusEnabled: true });
    const result = user.sanitize();
    expect(result.cartelaBonusEnabled).toBe(true);
  });

  it('includes cartelaBonusEnabled = false when set to false', () => {
    const user = buildUser({ cartelaBonusEnabled: false });
    const result = user.sanitize();
    expect(result.cartelaBonusEnabled).toBe(false);
  });

  it('does NOT include passwordHash in sanitized output', () => {
    const user = buildUser({ passwordHash: 'super_secret_hash' });
    const result = user.sanitize();
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('does NOT include mfaSecret in sanitized output', () => {
    const user = buildUser({ mfaSecret: 'totp_secret_value' });
    const result = user.sanitize();
    expect(result).not.toHaveProperty('mfaSecret');
  });

  it('includes all other safe fields in sanitized output', () => {
    const user = buildUser({
      cartelaBonusEnabled: true,
      mfaSecret: 'should_be_stripped',
      passwordHash: 'also_stripped',
    });
    const result = user.sanitize();

    // Core fields present
    expect(result.id).toBe('test-uuid-1234');
    expect(result.username).toBe('testuser');
    expect(result.email).toBe('test@example.com');
    expect(result.role).toBe('player');
    expect(result.status).toBe('active');
    expect(result.balance).toBe(100);
    expect(result.cartelaBonusEnabled).toBe(true);

    // Sensitive fields absent
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('mfaSecret');
  });

  it('cartelaBonusEnabled reflects the exact value assigned to the user', () => {
    const userTrue = buildUser({ cartelaBonusEnabled: true });
    const userFalse = buildUser({ cartelaBonusEnabled: false });

    expect(userTrue.sanitize().cartelaBonusEnabled).toBe(true);
    expect(userFalse.sanitize().cartelaBonusEnabled).toBe(false);
  });
});
