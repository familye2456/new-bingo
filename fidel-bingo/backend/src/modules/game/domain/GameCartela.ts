import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Unique, Index
} from 'typeorm';
import { Game } from './Game';
import { UserCartela } from './UserCartela';
import { User } from '../../user/domain/User';

/**
 * Links a user's cartela (from user_cartelas) to a specific game.
 * userCartelaId references user_cartelas.id — not the shared cartelas pool.
 */
@Entity('game_cartelas')
@Unique(['gameId', 'userCartelaId'])
@Index('idx_game_cartelas_game_id', ['gameId'])
@Index('idx_game_cartelas_user_id', ['userId'])
export class GameCartela {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'game_id' })
  gameId!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @Column({ name: 'user_cartela_id' })
  userCartelaId!: string;

  @ManyToOne(() => UserCartela, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_cartela_id' })
  userCartela!: UserCartela;

  @Column({ name: 'user_id', nullable: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'bet_amount' })
  betAmount!: number;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt!: Date;
}
