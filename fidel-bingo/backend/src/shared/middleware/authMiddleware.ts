import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from './errorHandler';
import { AppDataSource } from '../../config/database';
import { User } from '../../modules/user/domain/User';

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const authenticate = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const token = req.cookies?.access_token || req.headers.authorization?.split(' ')[1];

  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { id: string; role: string };

    // Check user status on every request — block suspended/banned users immediately
    if (AppDataSource.isInitialized) {
      const user = await AppDataSource.getRepository(User).findOne({
        where: { id: payload.id },
        select: ['id', 'role', 'status'],
      });
      if (!user) throw new AppError(401, 'UNAUTHORIZED', 'User not found');
      if (user.status === 'suspended' || user.status === 'banned') {
        throw new AppError(403, 'ACCOUNT_BLOCKED', 'Account suspended');
      }
    }

    req.user = payload;
    next();
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };
};
