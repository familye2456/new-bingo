/**
 * Migration: AddCartelaBonusEnabled
 *
 * What it does:
 *   Adds a `cartela_bonus_enabled` BOOLEAN column (NOT NULL, DEFAULT FALSE) to the
 *   `users` table. This flag controls whether a user receives a free-cartela credit
 *   (equal to the bet amount) each time they create a new game.
 *   All existing users are migrated with the default value of FALSE — no data loss.
 *
 * How to run (apply):
 *   npm run migration:run
 *
 * How to roll back (revert):
 *   npm run migration:revert
 *   (Drops the `cartela_bonus_enabled` column; existing column data will be lost.)
 *
 * Notes:
 *   - Safe to run on a live database: the ALTER TABLE uses IF NOT EXISTS / IF EXISTS
 *     guards so re-running is idempotent.
 *   - No frontend or backend restart is required beyond the normal deployment sequence.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartelaBonusEnabled1720000000000 implements MigrationInterface {
  name = 'AddCartelaBonusEnabled1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cartela_bonus_enabled" BOOLEAN NOT NULL DEFAULT FALSE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "cartela_bonus_enabled"`
    );
  }
}
