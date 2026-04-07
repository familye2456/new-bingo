import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Unique, Index
} from 'typeorm';
import { Game } from './Game';
import { Cartela } from './Cartela';
import { User } from '../../user/domain/User';

@Entity('game_cartelas')
@Unique(['gameId', 'cartelaId'])
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

  @Column({ name: 'cartela_id' })
  cartelaId!: string;

  @ManyToOne(() => Cartela, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartela_id' })
  cartela!: Cartela;

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
