import { DataSource } from 'typeorm';
import { env } from './env';
import { User } from '../modules/user/domain/User';
import { Game } from '../modules/game/domain/Game';
import { Cartela } from '../modules/game/domain/Cartela';
import { UserCartela } from '../modules/game/domain/UserCartela';
import { GameCartela } from '../modules/game/domain/GameCartela';
import { Transaction } from '../modules/payment/domain/Transaction';
import { Account } from '../modules/payment/domain/Account';
import { AuditLog } from '../shared/domain/AuditLog';
import { RefreshToken } from '../modules/auth/domain/RefreshToken';
import { GlobalSequence } from '../modules/game/domain/GlobalSequence';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL.replace('?sslmode=require', ''),
  ssl: { rejectUnauthorized: false },
  synchronize: false,
  logging: false,
  poolSize: 10,
  connectTimeoutMS: 30000,
  extra: {
    max: 10,
    min: 0,                          // don't hold idle connections on free tier
    idleTimeoutMillis: 10000,        // release idle connections faster
    connectionTimeoutMillis: 30000,  // allow more time for cold-start wakeup
    statement_timeout: 60000,
    keepAlive: true,                 // detect stale connections
    keepAliveInitialDelayMillis: 10000,
  },
  entities: [User, Game, Cartela, UserCartela, GameCartela, Transaction, Account, AuditLog, RefreshToken, GlobalSequence],
  migrations: ['dist/migrations/*.js'],
});
