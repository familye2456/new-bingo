import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Stores a pre-generated number sequence (1–75, shuffled) per user.
 * Each user's next game will use their stored sequence, so the admin
 * can predict which cartela wins before the game is created.
 *
 * id = userId (UUID of the user this sequence belongs to).
 */
@Entity('global_sequences')
export class GlobalSequence {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  /** The pre-shuffled sequence of numbers 1–75 */
  @Column({ name: 'sequence', type: 'int', array: true })
  sequence!: number[];

  @UpdateDateColumn({ name: 'generated_at' })
  generatedAt!: Date;
}
