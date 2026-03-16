import { createClient } from 'redis';
import { env } from './env';
import { logger } from '../shared/infrastructure/logger';

export const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (err) => logger.error('Redis error', { err }));
redisClient.on('connect', () => logger.info('Redis connected'));

export const connectRedis = async () => {
  await redisClient.connect();
};
