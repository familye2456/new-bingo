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

const io = new Server(httpServer, {
  cors: { origin: env.FRONTEND_URL, credentials: true },
  transports: ['websocket', 'polling'],
});

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

const allowedOrigins = [env.FRONTEND_URL, 'https://f-bingo.vercel.app', 'http://localhost:5173' ,'https://bingo-keno.netlify.app'].filter(Boolean);
const corsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
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

app.use('/api/', rateLimit({
  windowMs: 60_000, max: env.NODE_ENV === 'development' ? 10000 : 600,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
}));
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60_000, max: env.NODE_ENV === 'development' ? 10000 : 30,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts' } },
}));
// Generous limiter for call-number endpoint (auto-call fires rapidly)
app.use('/api/games/:id/call', rateLimit({
  windowMs: 60_000, max: env.NODE_ENV === 'development' ? 10000 : 300,
  keyGenerator: (req) => `call:${(req as any).user?.id ?? req.ip}`,
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many call requests' } },
}));
// Tight limiter for game creation only
app.use('/api/games', rateLimit({
  windowMs: 60_000, max: env.NODE_ENV === 'development' ? 10000 : 20,
  keyGenerator: (req) => `postpaid:${(req as any).user?.id ?? req.ip}`,
  skip: (req) => req.method !== 'POST' || req.path.includes('/call'),
  message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many game creation requests' } },
}));

app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cartelas', cartelaRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/ready', (_req, res) => res.json({ status: 'ready' }));
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

setupGameGateway(io);
app.use(errorHandler);

const start = async () => {
  try {
    // ── Pre-migration: add new columns / drop stale constraints ───────────────
    // Runs BEFORE AppDataSource.initialize() so TypeORM never sees old schema
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

      // ── Agent role + createdBy column ─────────────────────────────────────
      // Add 'agent' to the role enum if not already present
      await migDs.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumlabel = 'agent'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'users_role_enum')
          ) THEN
            ALTER TYPE users_role_enum ADD VALUE 'agent';
          END IF;
        END $$;
      `).catch(() => {});

      // Add created_by column to users table
      await migDs.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL`
      ).catch(() => {});

      // user_cartelas — add each column individually so one failure doesn't block others
      const ucCols = [
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS card_number integer`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS numbers integer[]`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS pattern_mask boolean[]`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS win_pattern varchar`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS win_amount numeric(10,2)`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS source_cartela_id uuid`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
        `ALTER TABLE user_cartelas ADD COLUMN IF NOT EXISTS is_winner boolean NOT NULL DEFAULT false`,
        `ALTER TABLE game_cartelas ADD COLUMN IF NOT EXISTS user_cartela_id uuid`,
        `ALTER TABLE game_cartelas ALTER COLUMN cartela_id DROP NOT NULL`,
      ];
      for (const sql of ucCols) { await migDs.query(sql).catch(() => {}); }

      // Drop all FKs on user_cartelas (old cartela_id → cartelas FK)
      const ucFKs: any[] = await migDs.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='user_cartelas'::regclass AND contype='f'`
      ).catch(() => []);
      for (const fk of ucFKs) {
        await migDs.query(`ALTER TABLE user_cartelas DROP CONSTRAINT "${fk.conname}"`).catch(() => {});
      }

      // Drop old FKs on game_cartelas that reference cartelas (not user_cartelas)
      const gcFKs: any[] = await migDs.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid='game_cartelas'::regclass AND contype='f'
        AND pg_get_constraintdef(oid) NOT ILIKE '%user_cartela%'
        AND pg_get_constraintdef(oid) ILIKE '%cartela%'
      `).catch(() => []);
      for (const fk of gcFKs) {
        await migDs.query(`ALTER TABLE game_cartelas DROP CONSTRAINT "${fk.conname}"`).catch(() => {});
      }

      // Drop old unique constraints on game_cartelas
      const gcUQs: any[] = await migDs.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid='game_cartelas'::regclass AND contype='u'
        AND pg_get_constraintdef(oid) ILIKE '%cartela_id%'
        AND pg_get_constraintdef(oid) NOT ILIKE '%user_cartela_id%'
      `).catch(() => []);
      for (const uq of gcUQs) {
        await migDs.query(`ALTER TABLE game_cartelas DROP CONSTRAINT "${uq.conname}"`).catch(() => {});
      }

      await migDs.destroy();
      logger.info('Pre-migration complete');
    } catch (migErr) {
      logger.warn('Pre-migration warning (non-fatal)');
      console.error('PRE-MIGRATION ERROR:', migErr);
    }

    logger.info('Initializing database...');
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
          username: 'amouradmin', email: 'admin@fidelbingo.com',
          passwordHash, role: 'admin', status: 'active',
          balance: 0, kycLevel: 0, mfaEnabled: false, loginAttempts: 0,
        }));
        logger.info('Default admin created: amouradmin / Admin@2024!');
      }
    } catch (err) {
      logger.warn('Admin seed skipped', { err });
    }

    try { await connectRedis(); } catch (err) {
      logger.warn('Redis unavailable, running without cache', { err });
    }

    httpServer.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    console.error('FATAL SERVER ERROR:', err);
    process.exit(1);
  }
};

start();

export { app, io };
