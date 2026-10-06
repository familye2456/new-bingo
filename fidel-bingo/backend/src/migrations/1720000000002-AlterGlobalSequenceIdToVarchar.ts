import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterGlobalSequenceIdToVarchar1720000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change id column from UUID to VARCHAR(255) so non-UUID keys like 'singleton' are valid
    await queryRunner.query(`
      ALTER TABLE global_sequences
        ALTER COLUMN id TYPE VARCHAR(255) USING id::TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert: only safe if all existing ids are valid UUIDs
    await queryRunner.query(`
      ALTER TABLE global_sequences
        ALTER COLUMN id TYPE UUID USING id::UUID
    `);
  }
}
