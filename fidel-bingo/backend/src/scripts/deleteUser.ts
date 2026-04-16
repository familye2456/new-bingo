import 'reflect-metadata';
import { AppDataSource } from '../config/database';

const TARGET_USERNAME = 'Zarihun';

async function run() {
  await AppDataSource.initialize();

  // Find user first
  const users: any[] = await AppDataSource.query(
    `SELECT id, username, email FROM users WHERE username = $1`,
    [TARGET_USERNAME]
  );

  if (users.length === 0) {
    console.log(`User "${TARGET_USERNAME}" not found.`);
    await AppDataSource.destroy();
    return;
  }

  const userId = users[0].id;
  console.log(`Found user: ${users[0].username} (${userId})`);

  // Delete in dependency order
  await AppDataSource.query(`DELETE FROM game_cartelas WHERE user_id = $1`, [userId]);
  await AppDataSource.query(`DELETE FROM user_cartelas WHERE user_id = $1`, [userId]);
  await AppDataSource.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
  await AppDataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]).catch(() => {});
  await AppDataSource.query(`DELETE FROM audit_logs WHERE user_id = $1`, [userId]).catch(() => {});
  await AppDataSource.query(`DELETE FROM games WHERE creator_id = $1`, [userId]);
  await AppDataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);

  console.log(`✓ User "${TARGET_USERNAME}" and all related data deleted.`);
  await AppDataSource.destroy();
}

run().catch((err) => { console.error('Failed:', err); process.exit(1); });
