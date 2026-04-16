import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Cartela } from '../modules/game/domain/Cartela';
import * as path from 'path';

const cartelaPath = path.join(__dirname, '../../assets/cartela.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bingoCards } = require(cartelaPath) as { bingoCards: Record<number, (number | string)[][]> };

async function seedMainCartelas() {
  await AppDataSource.initialize();

  const repo = AppDataSource.getRepository(Cartela);

  const cardIds = Object.keys(bingoCards).map(Number).sort((a, b) => a - b);
  console.log(`Seeding ${cardIds.length} cartelas from cartela.js into main pool...\n`);

  let inserted = 0;
  let skipped = 0;

  for (const cardId of cardIds) {
    const grid = bingoCards[cardId];
    const numbers: number[] = grid.flat().map((cell) =>
      typeof cell === 'string' ? 0 : cell
    );

    // Skip if a cartela with this exact cardNumber AND numbers already exists
    const rows: any[] = await AppDataSource.query(
      `SELECT id FROM cartelas WHERE card_number = $1 AND numbers = $2::int[] LIMIT 1`,
      [cardId, numbers]
    );

    if (rows.length > 0) {
      skipped++;
      continue;
    }

    const patternMask: boolean[] = Array(25).fill(false);
    patternMask[12] = true;

    await repo.save(repo.create({
      cardNumber: cardId,
      numbers,
      patternMask,
      isActive: true,
      isWinner: false,
    }));
    inserted++;
  }

  const total: { count: string }[] = await AppDataSource.query(`SELECT COUNT(*) as count FROM cartelas`);
  console.log(`Done. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  console.log(`Main cartelas pool total: ${total[0].count}`);

  await AppDataSource.destroy();
}

seedMainCartelas().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
