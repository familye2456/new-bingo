import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreviousSequenceToGames1720000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE games
      ADD COLUMN IF NOT EXISTS previous_sequence integer[] NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE games DROP COLUMN IF EXISTS previous_sequence
    `);
  }
}
