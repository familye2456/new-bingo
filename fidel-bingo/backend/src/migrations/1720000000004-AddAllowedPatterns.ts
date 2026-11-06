import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowedPatterns1720000000004 implements MigrationInterface {
  name = 'AddAllowedPatterns1720000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_patterns" TEXT[] DEFAULT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "allowed_patterns"`
    );
  }
}
