import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn
} from 'typeorm';

export type UserRole = 'player' | 'admin' | 'operator' | 'agent';
export type UserStatus = 'active' | 'suspended' | 'self_excluded' | 'banned';
export type PaymentType = 'prepaid' | 'postpaid';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 50 })
  username!: string;

  @Column({ unique: true, length: 255 })
  email!: string;

  @Column({ unique: true, nullable: true, length: 20 })
  phone?: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'enum', enum: ['player', 'admin', 'operator', 'agent'], default: 'player' })
  role!: UserRole;

  @Column({ type: 'enum', enum: ['active', 'suspended', 'self_excluded', 'banned'], default: 'active' })
  status!: UserStatus;

  @Column({ name: 'first_name', nullable: true })
  firstName?: string;

  @Column({ name: 'last_name', nullable: true })
  lastName?: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: Date;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ name: 'payment_type', type: 'enum', enum: ['prepaid', 'postpaid'], default: 'prepaid' })
  paymentType!: PaymentType;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance!: number;

  /** Maximum credit allowed for postpaid users (0 = unlimited) */
  @Column({ name: 'credit_limit', type: 'decimal', precision: 12, scale: 2, default: 0 })
  creditLimit!: number;

  @Column({ name: 'kyc_level', default: 0 })
  kycLevel!: number;

  @Column({ name: 'country_code', length: 2, nullable: true })
  countryCode?: string;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled!: boolean;

  @Column({ name: 'mfa_secret', nullable: true })
  mfaSecret?: string;

  @Column({ name: 'login_attempts', default: 0 })
  loginAttempts!: number;

  @Column({ name: 'locked_until', nullable: true })
  lockedUntil?: Date;

  @Column({ name: 'self_excluded_until', nullable: true })
  selfExcludedUntil?: Date;

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'last_login_ip', nullable: true })
  lastLoginIp?: string;

  /** ID of the admin/agent who created this user (null = created by self-registration or system) */
  @Column({ name: 'created_by', nullable: true, type: 'uuid' })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  sanitize() {
    const { passwordHash, mfaSecret, ...safe } = this;
    return safe;
  }
}
