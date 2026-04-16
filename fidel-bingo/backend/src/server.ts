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
  'https://f-bingo.vercel.app',
  'http://localhost:5173',
].filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true); // allow non-browser requests
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow any vercel.app or netlify.app preview deployments
    if (origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app')) return cb(null, true);
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

// Rate limiting — general API (per IP)
app.use('/api/', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 10000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
}));

// Auth routes — stricter, only failed attempts count
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 10000 : 30,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts' } },
}));

// Postpaid game creation — stricter limit to prevent credit abuse
app.use('/api/games', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 10000 : 20,
  keyGenerator: (req) => `postpaid:${(req as any).user?.id ?? req.ip}`,
  skip: (req) => req.method !== 'POST',
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many game creation requests' } },
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
    // ── Run schema migrations BEFORE TypeORM initializes ──────────────────────
    // Use a temporary DataSource with synchronize:false to run raw DDL safely
    try {
      const { DataSource } = await import('typeorm');
      const migDs = new DataSource({
        type: 'postgres',
        url: env.DATABASE_URL.replace('?sslmode=require', ''),
        ssl: { rejectUnauthorized: false },
        synchronize: false,
        entities: [],
      });
      await migDs.initialize();

      await migDs.query(`
        ALTER TABLE user_cartelas
          ADD COLUMN IF NOT EXISTS card_number integer,
          ADD COLUMN IF NOT EXISTS numbers integer[],
          ADD COLUMN IF NOT EXISTS pattern_mask boolean[],
          ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
          ADD COLUMN IF NOT EXISTS is_winner boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS win_pattern varchar,
          ADD COLUMN IF NOT EXISTS win_amount numeric(10,2),
          ADD COLUMN IF NOT EXISTS source_cartela_id uuid
      `);

      await migDs.query(`
        ALTER TABLE game_cartelas
          ADD COLUMN IF NOT EXISTS user_cartela_id uuid
      `);

      await migDs.query(`
        ALTER TABLE game_cartelas ALTER COLUMN cartela_id DROP NOT NULL
      `).catch(() => {/* already nullable */});

      // Drop old FK on cartela_id pointing to cartelas table
      await migDs.query(`
        DO $$ DECLARE r RECORD; BEGIN
          FOR r IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'game_cartelas'::regclass
              AND contype = 'f'
              AND pg_get_constraintdef(oid) ILIKE '%cartelas%'
              AND conname NOT ILIKE '%user_cartela%'
          LOOP
            EXECUTE 'ALTER TABLE game_cartelas DROP CONSTRAINT "' || r.conname || '"';
          END LOOP;
        END $$
      `).catch(() => {/* ignore */});

      // Drop old unique constraint on (gameId, cartelaId)
      await migDs.query(`
        DO $$ DECLARE r RECORD; BEGIN
          FOR r IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'game_cartelas'::regclass
              AND contype = 'u'
              AND pg_get_constraintdef(oid) ILIKE '%cartela_id%'
              AND pg_get_constraintdef(oid) NOT ILIKE '%user_cartela_id%'
          LOOP
            EXECUTE 'ALTER TABLE game_cartelas DROP CONSTRAINT "' || r.conname || '"';
          END LOOP;
        END $$
      `).catch(() => {/* ignore */});

      await migDs.destroy();
      logger.info('Pre-migration complete');
    } catch (migErr) {
      logger.warn('Pre-migration warning (non-fatal)', { migErr });
    }

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
