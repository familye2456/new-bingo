import dotenv from 'dotenv';
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000'),
  WS_PORT: parseInt(process.env.WS_PORT || '3001'),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fidelbingo',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || '15m',
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || '7d',

  // Encryption
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'change-me-32-chars-in-production!',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',

  // App
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  HOUSE_PERCENTAGE: parseFloat(process.env.HOUSE_PERCENTAGE || '10'),
};
