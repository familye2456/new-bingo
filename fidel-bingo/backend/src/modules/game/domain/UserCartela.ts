import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Unique, Index
} from 'typeorm';
import { User } from '../../user/domain/User';
import { Cartela } from './Cartela';

@Entity('user_cartelas')
@Unique(['userId', 'cartelaId'])
@Index('idx_user_cartelas_user_id', ['userId'])
@Index('idx_user_cartelas_cartela_id', ['cartelaId'])
export class UserCartela {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'cartela_id' })
  cartelaId!: string;

  @ManyToOne(() => Cartela, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartela_id' })
  cartela!: Cartela;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt!: Date;
}
