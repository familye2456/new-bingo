import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Unique
} from 'typeorm';
import { Game } from './Game';
import { Cartela } from './Cartela';

@Entity('game_cartelas')
@Unique(['gameId', 'cartelaId'])
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

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'bet_amount' })
  betAmount!: number;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt!: Date;
}
