import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn
} from 'typeorm';

@Entity('cartelas')
export class Cartela {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'card_number', nullable: true })
  cardNumber?: number;

  // 5x5 grid stored as flat array of 25 numbers (FREE cell = 0)
  @Column({ type: 'int', array: true })
  numbers!: number[];

  // Marked positions as flat boolean array (25 items), center is free space
  @Column({ name: 'pattern_mask', type: 'boolean', array: true })
  patternMask!: boolean[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'is_winner', default: false })
  isWinner!: boolean;

  @Column({ name: 'win_pattern', nullable: true })
  winPattern?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'win_amount', nullable: true })
  winAmount?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'purchase_price', nullable: true })
  purchasePrice?: number;

  @CreateDateColumn({ name: 'purchased_at' })
  purchasedAt!: Date;
}
