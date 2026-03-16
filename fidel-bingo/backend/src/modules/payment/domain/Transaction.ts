import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn
} from 'typeorm';
import { User } from '../../user/domain/User';

export type TransactionType = 'deposit' | 'withdrawal' | 'bet' | 'win' | 'refund' | 'house_cut';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'refunded';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_type', type: 'enum', enum: ['deposit', 'withdrawal', 'bet', 'win', 'refund', 'house_cut'] })
  transactionType!: TransactionType;

  @Column({ type: 'enum', enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' })
  status!: TransactionStatus;

  @Column({ name: 'from_account_id', nullable: true })
  fromAccountId?: string;

  @Column({ name: 'to_account_id', nullable: true })
  toAccountId?: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @Column({ name: 'game_id', nullable: true })
  gameId?: string;

  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'external_reference', nullable: true })
  externalReference?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'processed_at', nullable: true })
  processedAt?: Date;
}
