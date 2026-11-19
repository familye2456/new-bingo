import { Request, Response, NextFunction } from 'express';
import { EntityMetadataNotFoundError } from 'typeorm';
import { logger } from '../infrastructure/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  if (err instanceof EntityMetadataNotFoundError) {
    return res.status(503).json({
      success: false,
      error: { code: 'DB_NOT_READY', message: 'Database is not ready yet' },
    });
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path, method: req.method });

  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
};
