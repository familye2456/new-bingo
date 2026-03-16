import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column()
  action!: string;

  @Column({ type: 'jsonb' })
  metadata!: {
    ip?: string;
    userAgent?: string;
    timestamp: Date;
    before?: unknown;
    after?: unknown;
  };

  @Column({ nullable: true })
  targetUserId?: string;

  @Column({ type: 'uuid', nullable: true })
  correlationId?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
