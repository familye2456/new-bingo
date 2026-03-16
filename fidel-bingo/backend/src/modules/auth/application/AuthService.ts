import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppDataSource } from '../../../config/database';
import { User } from '../../user/domain/User';
import { RefreshToken } from '../domain/RefreshToken';
import { env } from '../../../config/env';
import { AppError } from '../../../shared/middleware/errorHandler';
import { logger } from '../../../shared/infrastructure/logger';

export interface LoginDTO {
  identifier: string; // email or username
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface RegisterDTO {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export class AuthService {
  private userRepo = AppDataSource.getRepository(User);
  private tokenRepo = AppDataSource.getRepository(RefreshToken);

  async register(dto: RegisterDTO): Promise<User> {
    const existing = await this.userRepo.findOne({ where: [{ email: dto.email }, { username: dto.username }] });
    if (existing) throw new AppError(409, 'USER_EXISTS', 'Email or username already taken');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({ ...dto, passwordHash, balance: 0, role: 'player', status: 'active' });
    return this.userRepo.save(user);
  }

  async login(dto: LoginDTO) {
    const { identifier } = dto;
    const isEmail = identifier.includes('@');
    const user = await this.userRepo.findOne({
      where: isEmail ? { email: identifier } : { username: identifier },
    });
    if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await this.userRepo.save(user);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    user.lastLoginIp = dto.ip;
    await this.userRepo.save(user);

    const accessToken = this.generateToken(user, env.JWT_ACCESS_EXPIRES);
    const refreshToken = this.generateToken(user, env.JWT_REFRESH_EXPIRES);

    const family = crypto.randomUUID();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await this.tokenRepo.save(
      this.tokenRepo.create({
        userId: user.id,
        tokenHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdIp: dto.ip,
        userAgent: dto.userAgent,
      })
    );

    logger.info('User logged in', { userId: user.id });
    return { user: user.sanitize(), accessToken, refreshToken };
  }

  async refreshTokens(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const stored = await this.tokenRepo.findOne({ where: { tokenHash }, relations: ['user'] });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }

    // Rotate token
    stored.revokedAt = new Date();
    await this.tokenRepo.save(stored);

    const accessToken = this.generateToken(stored.user, env.JWT_ACCESS_EXPIRES);
    const newRefreshToken = this.generateToken(stored.user, env.JWT_REFRESH_EXPIRES);
    const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    await this.tokenRepo.save(
      this.tokenRepo.create({
        userId: stored.userId,
        tokenHash: newHash,
        family: stored.family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        replacedBy: stored.id,
      })
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string) {
    await this.tokenRepo.update({ userId }, { revokedAt: new Date() });
  }

  private generateToken(user: User, expiresIn: string): string {
    return jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
  }
}
