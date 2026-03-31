import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn
} from 'typeorm';
import { User } from '../../user/domain/User';

export type GameStatus = 'pending' | 'active' | 'finished' | 'cancelled';
export type GameType = 'standard' | 'progressive' | 'speed';

@Entity('games')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'game_number', default: 1 })
  gameNumber!: number;

  @Column({ name: 'creator_id' })
  creatorId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'creator_id' })
  creator!: User;

  @Column({ type: 'enum', enum: ['pending', 'active', 'finished', 'cancelled'], default: 'pending' })
  status!: GameStatus;

  @Column({ name: 'game_type', type: 'enum', enum: ['standard', 'progressive', 'speed'], default: 'standard' })
  gameType!: GameType;

  @Column({ name: 'called_numbers', type: 'int', array: true, default: [] })
  calledNumbers!: number[];

  /** Pre-shuffled sequence of all 75 numbers, generated at game creation */
  @Column({ name: 'number_sequence', type: 'int', array: true, default: [] })
  numberSequence!: number[];

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'bet_amount' })
  betAmount!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'house_percentage', default: 10 })
  housePercentage!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'total_bets', default: 0 })
  totalBets!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'prize_pool', default: 0 })
  prizePool!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'house_cut', default: 0 })
  houseCut!: number;

  @Column({ name: 'winner_ids', type: 'uuid', array: true, default: [] })
  winnerIds!: string[];

  @Column({ name: 'player_count', default: 0 })
  playerCount!: number;

  @Column({ name: 'cartela_count', default: 0 })
  cartelaCount!: number;

  @Column({ name: 'win_pattern', default: 'any' })
  winPattern!: string;

  @Column({ name: 'started_at', nullable: true })
  startedAt?: Date;

  @Column({ name: 'finished_at', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
