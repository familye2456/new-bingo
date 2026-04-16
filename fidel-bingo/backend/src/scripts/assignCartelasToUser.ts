import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { User } from '../modules/user/domain/User';
import { UserCartela } from '../modules/game/domain/UserCartela';
import * as path from 'path';

const TARGET_USERNAME = 'Beruke';

const newCartelaPath = path.join(__dirname, '../../assets/newcartela.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bingoCards } = require(newCartelaPath) as { bingoCards: Record<number, (number | string)[][]> };

async function run() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  // 1. Find user
  const user = await userRepo.findOne({ where: { username: TARGET_USERNAME } });
  if (!user) {
    console.error(`User "${TARGET_USERNAME}" not found.`);
    await AppDataSource.destroy();
    process.exit(1);
  }
  console.log(`Found user: ${user.username} (id: ${user.id})\n`);

  // 2. Remove ALL existing user_cartelas for this user
  const existing = await ucRepo.find({ where: { userId: user.id } });
  if (existing.length > 0) {
    await ucRepo.remove(existing);
    console.log(`Removed ${existing.length} existing cartelas from ${TARGET_USERNAME}.`);
  } else {
    console.log(`No existing cartelas — starting fresh.`);
  }

  // 3. Insert cartelas from newcartela.js directly into user_cartelas
  //    NO dependency on the shared cartelas pool.
  const cardIds = Object.keys(bingoCards).map(Number).sort((a, b) => a - b);
  console.log(`\nInserting ${cardIds.length} cartelas from newcartela.js into user_cartelas...\n`);

  let inserted = 0;
  for (const cardId of cardIds) {
    const grid = bingoCards[cardId];
    const numbers: number[] = grid.flat().map((cell) =>
      typeof cell === 'string' ? 0 : cell
    );
    const patternMask: boolean[] = Array(25).fill(false);
    patternMask[12] = true;

    const uc = ucRepo.create({
      userId: user.id,
      cardNumber: cardId,
      numbers,
      patternMask,
      isActive: true,
      isWinner: false,
      sourceCartelaId: null,
    });
    await ucRepo.save(uc);
    inserted++;
  }

  console.log(`\n✓ Done. Inserted ${inserted} cartelas for ${TARGET_USERNAME}.`);
  console.log(`  Main cartelas table was NOT modified.`);
  await AppDataSource.destroy();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
