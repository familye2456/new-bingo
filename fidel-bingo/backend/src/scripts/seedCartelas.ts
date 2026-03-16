import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Cartela } from '../modules/game/domain/Cartela';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bingoCards } = require('../../assets/cartela.js');

async function seedCartelas() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Cartela);

  // Check if already seeded with cardNumbers
  const withCardNumber = await repo.createQueryBuilder('c')
    .where('c.cardNumber IS NOT NULL')
    .getCount();

  if (withCardNumber >= 2000) {
    console.log(`Already seeded with card numbers (${withCardNumber} found). Skipping.`);
    await AppDataSource.destroy();
    return;
  }

  // Rows exist but cardNumber is NULL — backfill from asset file
  const existing = await repo.count();
  if (existing > 0) {
    console.log(`Found ${existing} cartelas missing cardNumber. Backfilling from cartela.js...`);
    const cardIds: number[] = Object.keys(bingoCards).map(Number).sort((a, b) => a - b);
    let updated = 0;
    for (const cardId of cardIds) {
      const grid: (number | string)[][] = bingoCards[cardId];
      const numbers: number[] = grid.flat().map((cell: number | string) =>
        typeof cell === 'string' ? 0 : cell
      );
      const result = await AppDataSource.query(
        `UPDATE cartelas SET card_number = $1 WHERE numbers = $2::int[] AND card_number IS NULL`,
        [cardId, numbers]
      );
      if (result[1] > 0) updated++;
    }
    console.log(`Backfill complete. Updated ${updated} rows.`);
    await AppDataSource.destroy();
    return;
  }

  const cardIds: number[] = Object.keys(bingoCards).map(Number).sort((a, b) => a - b);
  console.log(`Seeding ${cardIds.length} cartela templates (cards 1–${cardIds[cardIds.length - 1]})...`);

  const BATCH = 100;
  let inserted = 0;

  for (let i = 0; i < cardIds.length; i += BATCH) {
    const batch = cardIds.slice(i, i + BATCH);
    const cartelas: Partial<Cartela>[] = batch.map((cardId) => {
      const grid: (number | string)[][] = bingoCards[cardId];

      // Flatten 5x5 grid row-major; FREE cell → 0
      const numbers: number[] = grid.flat().map((cell) =>
        typeof cell === 'string' ? 0 : cell
      );

      // patternMask: center (index 12) pre-marked as free
      const patternMask: boolean[] = Array(25).fill(false);
      patternMask[12] = true;

      return {
        cardNumber: cardId,
        numbers,
        patternMask,
        isActive: true,
        isWinner: false,
      };
    });

    await repo
      .createQueryBuilder()
      .insert()
      .into(Cartela)
      .values(cartelas as Cartela[])
      .execute();

    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${cardIds.length}`);
  }

  console.log(`Done. ${inserted} cartela templates seeded.`);
  await AppDataSource.destroy();
}

seedCartelas().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
