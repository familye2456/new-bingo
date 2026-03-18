import { createClient } from 'redis';
import { env } from './env';
import { logger } from '../shared/infrastructure/logger';

// No-op stub used when Redis is disabled
const noopClient = {
  get: async (_k: string) => null,
  setEx: async () => undefined,
  del: async () => undefined,
  isReady: false,
  on: () => noopClient,
} as any;

export let redisClient: ReturnType<typeof createClient> = noopClient;

export const connectRedis = async () => {
  if (!env.REDIS_URL) {
    logger.info('Redis disabled (REDIS_URL not set)');
    return;
  }

  redisClient = createClient({ url: env.REDIS_URL });
  redisClient.on('error', (err) => logger.error('Redis error', { err }));
  redisClient.on('connect', () => logger.info('Redis connected'));

  try {
    await redisClient.connect();
  } catch (err) {
    logger.warn('Redis connection failed, running without cache', { err });
    redisClient = noopClient;
  }
};
