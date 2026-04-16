import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { User } from '../modules/user/domain/User';
import { Cartela } from '../modules/game/domain/Cartela';
import { UserCartela } from '../modules/game/domain/UserCartela';
import * as path from 'path';

const TARGET_USERNAME = 'Beruke';

// Load newcartela.js using absolute path to avoid resolution issues
const newCartelaPath = path.join(__dirname, '../../assets/newcartela.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bingoCards } = require(newCartelaPath) as { bingoCards: Record<number, (number | string)[][]> };

async function assignCartelasToUser() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const userCartelaRepo = AppDataSource.getRepository(UserCartela);

  const user = await userRepo.findOne({ where: { username: TARGET_USERNAME } });
  if (!user) {
    console.error(`User "${TARGET_USERNAME}" not found.`);
    await AppDataSource.destroy();
    process.exit(1);
  }
  console.log(`Found user: ${user.username} (id: ${user.id})`);

  const cardIds: number[] = Object.keys(bingoCards).map(Number).sort((a, b) => a - b);
  console.log(`Processing ${cardIds.length} cartelas from newcartela.js...`);

  let assigned = 0;
  let skipped = 0;
  let created = 0;

  for (const cardId of cardIds) {
    const grid = bingoCards[cardId];
    const numbers: number[] = grid.flat().map((cell) =>
      typeof cell === 'string' ? 0 : cell
    );

    // Find or create the cartela
    let cartela = await cartelaRepo.findOne({ where: { cardNumber: cardId } });

    if (!cartela) {
      const patternMask: boolean[] = Array(25).fill(false);
      patternMask[12] = true;
      cartela = cartelaRepo.create({ cardNumber: cardId, numbers, patternMask, isActive: true, isWinner: false });
      cartela = await cartelaRepo.save(cartela);
      created++;
      console.log(`  Created cartela #${cardId}`);
    }

    // Assign to user if not already assigned
    const existing = await userCartelaRepo.findOne({
      where: { userId: user.id, cartelaId: cartela.id },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await userCartelaRepo.save(
      userCartelaRepo.create({ userId: user.id, cartelaId: cartela.id })
    );
    assigned++;
  }

  console.log(`\nDone. Created: ${created}, Assigned: ${assigned}, Already existed (skipped): ${skipped}`);
  await AppDataSource.destroy();
}

assignCartelasToUser().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
