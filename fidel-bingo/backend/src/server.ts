import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { AppDataSource } from './config/database';
import { connectRedis } from './config/redis';
import { logger } from './shared/infrastructure/logger';
import { errorHandler } from './shared/middleware/errorHandler';
import { metricsMiddleware } from './shared/middleware/metricsMiddleware';
import { register } from './shared/infrastructure/metrics';
import authRoutes from './modules/auth/interfaces/authRoutes';
import gameRoutes from './modules/game/interfaces/gameRoutes';
import userRoutes from './modules/user/interfaces/userRoutes';
import cartelaRoutes from './modules/game/interfaces/cartelaRoutes';
import { setupGameGateway } from './modules/game/infrastructure/GameGateway';

const app = express();
const httpServer = createServer(app);

// Socket.io
const io = new Server(httpServer, {
  cors: { origin: env.FRONTEND_URL, credentials: true },
  transports: ['websocket', 'polling'],
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'wss:', env.FRONTEND_URL],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

const allowedOrigins = [
  env.FRONTEND_URL,
  'https://fidel-bingo1.netlify.app',
  'https://f-bingo.vercel.app',
  'http://localhost:5173',
].filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // In production be permissive — don't crash on unknown origins, just deny
    return cb(null, false);
  },
  credentials: true,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(metricsMiddleware);

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 10000 : 500,
  skipSuccessfulRequests: false,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cartelas', cartelaRoutes);

// Health & metrics
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/ready', (_req, res) => res.json({ status: 'ready' }));
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// WebSocket
setupGameGateway(io);

// Error handler (must be last)
app.use(errorHandler);

const start = async () => {
  try {
    await AppDataSource.initialize();
    logger.info('Database connected');

    // Auto-seed admin on first run
    try {
      const bcrypt = await import('bcryptjs');
      const { User } = await import('./modules/user/domain/User');
      const userRepo = AppDataSource.getRepository(User);
      const existing = await userRepo.findOne({ where: { username: 'amouradmin' } });
      if (!existing) {
        const passwordHash = await bcrypt.hash('Admin@2024!', 12);
        await userRepo.save(userRepo.create({
          username: 'amouradmin',
          email: 'admin@fidelbingo.com',
          passwordHash,
          role: 'admin',
          status: 'active',
          balance: 0,
          kycLevel: 0,
          mfaEnabled: false,
          loginAttempts: 0,
        }));
        logger.info('Default admin created: amouradmin / Admin@2024!');
      }
    } catch (err) {
      logger.warn('Admin seed skipped', { err });
    }

    try {
      await connectRedis();
    } catch (err) {
      logger.warn('Redis unavailable, running without cache', { err });
    }

    httpServer.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
};

start();

export { app, io };
