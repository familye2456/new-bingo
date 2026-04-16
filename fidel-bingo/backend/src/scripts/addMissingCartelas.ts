import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { UserCartela } from '../modules/game/domain/UserCartela';
import { User } from '../modules/user/domain/User';

const TARGET_USERNAME = 'Beruke';

const missingCards: { board_number: number; grid: (number | string)[][] }[] = [
  { board_number: 1, grid: [[15,22,37,56,65],[2,27,41,52,68],[7,17,'FREE',57,67],[14,18,36,59,73],[11,24,38,58,63]] },
  { board_number: 2, grid: [[11,26,43,59,75],[12,22,39,51,62],[6,18,'FREE',56,65],[13,28,33,52,66],[8,23,40,47,71]] },
  { board_number: 3, grid: [[10,24,41,55,69],[11,25,44,59,71],[7,29,'FREE',58,70],[3,23,38,48,68],[4,22,33,54,73]] },
  { board_number: 4, grid: [[2,19,38,55,67],[7,27,41,47,72],[10,26,'FREE',56,61],[5,28,31,52,62],[4,20,33,59,70]] },
  { board_number: 5, grid: [[12,26,38,50,66],[10,21,31,48,68],[1,25,'FREE',54,64],[9,28,41,53,75],[7,30,40,56,71]] },
  { board_number: 6, grid: [[14,19,44,59,72],[15,24,34,46,61],[6,16,'FREE',51,62],[4,22,31,56,68],[13,28,45,50,75]] },
  { board_number: 7, grid: [[10,29,42,47,74],[7,27,39,51,69],[4,24,'FREE',60,75],[11,23,33,54,71],[15,22,45,59,72]] },
  { board_number: 8, grid: [[11,22,33,50,65],[13,23,37,49,75],[9,28,'FREE',56,64],[12,30,43,51,72],[1,24,39,48,66]] },
];

async function addMissingCartelas() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  const user = await userRepo.findOne({ where: { username: TARGET_USERNAME } });
  if (!user) {
    console.error(`User "${TARGET_USERNAME}" not found.`);
    await AppDataSource.destroy();
    process.exit(1);
  }
  console.log(`Found user: ${user.username} (id: ${user.id})`);

  let assigned = 0;
  let skipped = 0;

  for (const card of missingCards) {
    const numbers: number[] = card.grid.flat().map((cell) => (typeof cell === 'string' ? 0 : cell));

    // Check if user already has this card number
    const existing = await ucRepo.findOne({ where: { userId: user.id, cardNumber: card.board_number } });
    if (existing) {
      console.log(`  Card #${card.board_number} already assigned — skipping`);
      skipped++;
      continue;
    }

    const patternMask: boolean[] = Array(25).fill(false);
    patternMask[12] = true;

    // Insert directly into user_cartelas — no shared pool dependency
    await ucRepo.save(ucRepo.create({
      userId: user.id,
      cardNumber: card.board_number,
      numbers,
      patternMask,
      isActive: true,
      isWinner: false,
      sourceCartelaId: null,
    }));
    console.log(`  Assigned card #${card.board_number} to ${TARGET_USERNAME}`);
    assigned++;
  }

  console.log(`\nDone. Assigned: ${assigned}, Skipped: ${skipped}`);
  await AppDataSource.destroy();
}

addMissingCartelas().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
