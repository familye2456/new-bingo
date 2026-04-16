import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Index
} from 'typeorm';
import { User } from '../../user/domain/User';

/**
 * Each row is a cartela owned by a specific user.
 * The grid data (card_number, numbers, pattern_mask) is stored directly here
 * so that users can have custom cartelas without touching the shared cartelas pool.
 *
 * - source_cartela_id: optional reference back to the admin cartelas pool (nullable)
 *   Set when the admin assigns from the pool; NULL for custom/script-imported cartelas.
 * - is_winner, win_pattern, win_amount: game result fields, updated during gameplay.
 */
@Entity('user_cartelas')
@Index('idx_user_cartelas_user_id', ['userId'])
@Index('idx_user_cartelas_card_number', ['userId', 'cardNumber'])
export class UserCartela {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // ── Optional back-reference to admin pool ──────────────────────────────────
  @Column({ name: 'source_cartela_id', type: 'uuid', nullable: true, default: null })
  sourceCartelaId?: string | null;

  // ── Cartela grid data (owned by this user row) ─────────────────────────────
  @Column({ name: 'card_number', nullable: true })
  cardNumber?: number;

  @Column({ name: 'numbers', type: 'int', array: true, nullable: true })
  numbers!: number[];

  @Column({ name: 'pattern_mask', type: 'boolean', array: true, nullable: true })
  patternMask!: boolean[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  // ── Game result state ──────────────────────────────────────────────────────
  @Column({ name: 'is_winner', default: false })
  isWinner!: boolean;

  @Column({ name: 'win_pattern', nullable: true })
  winPattern?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'win_amount', nullable: true })
  winAmount?: number;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt!: Date;
}
