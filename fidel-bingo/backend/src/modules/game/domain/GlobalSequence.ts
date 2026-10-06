import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Stores a single pre-generated number sequence (1–75, shuffled).
 * All new games draw from this sequence, so the admin can predict
 * which cartela wins before the game is created.
 *
 * Only one row ever exists (id = 'singleton').
 */
@Entity('global_sequences')
export class GlobalSequence {
  @PrimaryColumn({ type: 'varchar', length: 16, default: 'singleton' })
  id!: string;

  /** The pre-shuffled sequence of numbers 1–75 */
  @Column({ name: 'sequence', type: 'int', array: true })
  sequence!: number[];

  @UpdateDateColumn({ name: 'generated_at' })
  generatedAt!: Date;
}
