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

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL.replace('?sslmode=require', ''),
  ssl: { rejectUnauthorized: false },
  synchronize: true,
  logging: false,
  entities: [User, Game, Cartela, UserCartela, GameCartela, Transaction, Account, AuditLog, RefreshToken],
  migrations: ['dist/migrations/*.js'],
});
