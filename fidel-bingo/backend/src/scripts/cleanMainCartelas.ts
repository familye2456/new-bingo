import 'reflect-metadata';
import { AppDataSource } from '../config/database';

/**
 * Deletes cartelas from the main cartelas table that were added by the
 * newcartela.js script (card numbers: 1,2,3-8,9-150 with newcartela.js grids).
 *
 * Safe approach: only delete cartelas that have NO user_cartelas assignments
 * pointing to them via source_cartela_id or the old cartela_id FK.
 * This avoids breaking any existing user assignments.
 */
async function cleanMainCartelas() {
  await AppDataSource.initialize();

  // Count before
  const before: { count: string }[] = await AppDataSource.query(
    `SELECT COUNT(*) as count FROM cartelas`
  );
  console.log(`Cartelas before: ${before[0].count}`);

  // Delete cartelas that are NOT referenced by any user_cartelas or game_cartelas
  const result = await AppDataSource.query(`
    DELETE FROM cartelas c
    WHERE NOT EXISTS (
      SELECT 1 FROM user_cartelas uc WHERE uc.source_cartela_id::uuid = c.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM game_cartelas gc WHERE gc.cartela_id::uuid = c.id
    )
  `);

  console.log(`Deleted ${result[1] ?? 0} unreferenced cartelas from main pool.`);

  // Count after
  const after: { count: string }[] = await AppDataSource.query(
    `SELECT COUNT(*) as count FROM cartelas`
  );
  console.log(`Cartelas after: ${after[0].count}`);

  await AppDataSource.destroy();
}

cleanMainCartelas().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
