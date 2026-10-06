import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGlobalSequence1720000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS global_sequences (
        id VARCHAR(16) PRIMARY KEY DEFAULT 'singleton',
        sequence INTEGER[] NOT NULL DEFAULT '{}',
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS global_sequences`);
  }
}
