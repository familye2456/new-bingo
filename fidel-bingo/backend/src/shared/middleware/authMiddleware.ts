import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const authenticate = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const token = req.cookies?.access_token || req.headers.authorization?.split(' ')[1];

  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { id: string; role: string };
    req.user = payload;
    next();
  } catch {
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
