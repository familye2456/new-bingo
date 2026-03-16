import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AccountType = 'player' | 'house' | 'jackpot' | 'fees';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'account_type', type: 'enum', enum: ['player', 'house', 'jackpot', 'fees'] })
  accountType!: AccountType;

  @Column({ name: 'account_name' })
  accountName!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance!: number;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
