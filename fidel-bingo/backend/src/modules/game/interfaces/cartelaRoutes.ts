import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../../../shared/middleware/authMiddleware';
import { AppDataSource } from '../../../config/database';
import { Cartela } from '../domain/Cartela';
import { UserCartela } from '../domain/UserCartela';
import { User } from '../../user/domain/User';
import { AppError } from '../../../shared/middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── Player: own cartelas ────────────────────────────────────────────────────

router.get('/mine', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const assignments = await ucRepo.find({
    where: { userId: req.user!.id },
    relations: ['cartela'],
    order: { assignedAt: 'ASC' },
  });
  const cartelas = assignments.map((a) => ({ ...a.cartela, assignedAt: a.assignedAt }));
  res.json({ success: true, data: cartelas });
});

// Generate a new cartela for the current user (auto card number)
router.post('/generate', async (req: AuthRequest, res: Response) => {
  const { numbers: customNumbers, cardNumber: requestedCardNumber } = req.body as { numbers?: number[]; cardNumber?: number };

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const { CartelaGenerator } = await import('../application/CartelaGenerator');
  const generator = new CartelaGenerator();

  // Validate custom numbers if provided
  if (customNumbers !== undefined) {
    if (!Array.isArray(customNumbers) || customNumbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
  }

  // Determine card number
  let nextCardNumber: number;
  if (requestedCardNumber !== undefined) {
    const existing = await cartelaRepo.findOne({ where: { cardNumber: requestedCardNumber } });
    if (existing) throw new AppError(409, 'DUPLICATE_CARD_NUMBER', `Card #${requestedCardNumber} already exists`);
    nextCardNumber = requestedCardNumber;
  } else {
    const maxCard = await cartelaRepo
      .createQueryBuilder('c')
      .select('MAX(c.card_number)', 'max')
      .getRawOne();
    nextCardNumber = (parseInt(maxCard?.max ?? '0', 10) || 0) + 1;
  }

  const numbers = customNumbers ?? generator.generate();
  const cartela = cartelaRepo.create({
    cardNumber: nextCardNumber,
    numbers,
    patternMask: generator.generateMask(),
    isActive: true,
    isWinner: false,
    purchasePrice: 0,
  });
  await cartelaRepo.save(cartela);
  await ucRepo.save(ucRepo.create({ userId: req.user!.id, cartelaId: cartela.id }));

  res.status(201).json({ success: true, data: { ...cartela, assignedAt: new Date() } });
});

// Delete own cartela (unassign only — cartela stays in system)
router.delete('/mine/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);

  const assignment = await ucRepo.findOne({ where: { cartelaId: req.params.id, userId: req.user!.id } });
  if (!assignment) throw new AppError(404, 'NOT_FOUND', 'Cartela not found in your collection');

  await ucRepo.remove(assignment);
  res.json({ success: true });
});

// Update own cartela numbers and/or cardNumber
router.patch('/mine/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const cartelaRepo = AppDataSource.getRepository(Cartela);

  const assignment = await ucRepo.findOne({ where: { cartelaId: req.params.id, userId: req.user!.id } });
  if (!assignment) throw new AppError(404, 'NOT_FOUND', 'Cartela not found in your collection');

  const { numbers, cardNumber } = req.body as { numbers?: number[]; cardNumber?: number };
  const cartela = await cartelaRepo.findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found');

  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || numbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
    cartela.numbers = numbers;
  }
  if (cardNumber !== undefined) {
    const existing = await cartelaRepo.findOne({ where: { cardNumber } });
    if (existing && existing.id !== cartela.id)
      throw new AppError(409, 'DUPLICATE_CARD_NUMBER', `Card #${cardNumber} already exists`);
    cartela.cardNumber = cardNumber;
  }

  await cartelaRepo.save(cartela);
  res.json({ success: true, data: { ...cartela, assignedAt: assignment.assignedAt } });
});

// ─── Admin only below ────────────────────────────────────────────────────────

router.use(authorize('admin'));

// List cartelas with optional assignment info
// ?userId=   filter by assigned user
// ?unassigned=true  show only unassigned cards
router.get('/', async (req: AuthRequest, res: Response) => {
  const { userId, unassigned, page = '1', limit = '100' } = req.query as {
    userId?: string; unassigned?: string; page?: string; limit?: string;
  };

  const take = Math.min(Number(limit), 200);
  const skip = (Number(page) - 1) * take;

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  let cartelaIds: string[] | null = null;

  if (userId) {
    const assignments = await ucRepo.find({ where: { userId }, select: ['cartelaId'] });
    cartelaIds = assignments.map((a) => a.cartelaId);
    if (cartelaIds.length === 0) {
      return res.json({ success: true, data: [], total: 0 });
    }
  } else if (unassigned === 'true') {
    // Use NOT EXISTS subquery — avoids loading entire user_cartelas table into memory
    const qb = cartelaRepo.createQueryBuilder('c')
      .where((qb) => {
        const sub = qb.subQuery()
          .select('1')
          .from(UserCartela, 'uc')
          .where('uc.cartelaId = c.id')
          .getQuery();
        return `NOT EXISTS ${sub}`;
      })
      .orderBy('c.cardNumber', 'ASC')
      .take(take).skip(skip);

    const [data, total] = await qb.getManyAndCount();
    const enriched = data.map((c) => ({ ...c, userId: null, user: null }));
    return res.json({ success: true, data: enriched, total });
  }

  const qb = cartelaRepo.createQueryBuilder('c')
    .orderBy('c.cardNumber', 'ASC')
    .take(take).skip(skip);

  if (cartelaIds) {
    qb.where('c.id IN (:...cartelaIds)', { cartelaIds });
  }

  const [cartelas, total] = await qb.getManyAndCount();

  // Count assignments per cartela (multiple users can share a card)
  const allAssignments = await ucRepo.find({
    where: cartelaIds ? cartelaIds.map((id) => ({ cartelaId: id })) : undefined,
    relations: ['user'],
  });
  const assignMap = new Map<string, { userId: string; username: string }[]>();
  for (const a of allAssignments) {
    if (!assignMap.has(a.cartelaId)) assignMap.set(a.cartelaId, []);
    assignMap.get(a.cartelaId)!.push({ userId: a.userId, username: a.user?.username ?? '' });
  }

  const data = cartelas.map((c) => {
    const users = assignMap.get(c.id) ?? [];
    return {
      ...c,
      // keep legacy single-user fields for backward compat
      userId: users[0]?.userId ?? null,
      user: users[0] ? { username: users[0].username } : null,
      assignedCount: users.length,
    };
  });

  res.json({ success: true, data, total });
});

// Get single cartela with ALL assignment info (multiple users can have same card)
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const cartela = await AppDataSource.getRepository(Cartela).findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found');

  const assignments = await AppDataSource.getRepository(UserCartela).find({
    where: { cartelaId: req.params.id },
    relations: ['user'],
  });

  res.json({
    success: true,
    data: {
      ...cartela,
      assignments: assignments.map(a => ({
        userId: a.userId,
        username: a.user.username,
        assignedAt: a.assignedAt,
      })),
    },
  });
});

// Assign a specific card number to a user
router.post('/assign', async (req: AuthRequest, res: Response) => {
  const { userId, cardNumber } = req.body as { userId: string; cardNumber: number };
  if (!userId || !cardNumber) throw new AppError(400, 'MISSING_FIELDS', 'userId and cardNumber are required');

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  const cartela = await cartelaRepo.findOne({ where: { cardNumber } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', `Card #${cardNumber} not found`);

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  // Only block if this exact user already has this card
  const existing = await ucRepo.findOne({ where: { cartelaId: cartela.id, userId } });
  if (existing) throw new AppError(409, 'ALREADY_ASSIGNED', `Card #${cardNumber} is already assigned to this user`);

  const assignment = ucRepo.create({ userId, cartelaId: cartela.id });
  await ucRepo.save(assignment);

  res.json({ success: true, data: { ...cartela, userId, user: { username: user.username } } });
});

// Assign a range of card numbers to a single user
router.post('/assign-range', async (req: AuthRequest, res: Response) => {
  const { fromCard, toCard, userId } = req.body as {
    fromCard: number; toCard: number; userId: string;
  };

  if (!fromCard || !toCard || fromCard > toCard)
    throw new AppError(400, 'INVALID_CARD_RANGE', 'fromCard and toCard required, fromCard <= toCard');
  if (!userId)
    throw new AppError(400, 'MISSING_USER', 'userId is required');

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  // Find cards in range already assigned to this user (avoid duplicates)
  const alreadyOwned = await ucRepo
    .createQueryBuilder('uc')
    .innerJoin('uc.cartela', 'c')
    .where('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .andWhere('uc.userId = :userId', { userId })
    .select('uc.cartelaId')
    .getMany();
  const ownedIds = new Set(alreadyOwned.map((a) => a.cartelaId));

  const cards = await cartelaRepo.createQueryBuilder('c')
    .where('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .orderBy('c.cardNumber', 'ASC')
    .getMany();

  if (cards.length === 0)
    throw new AppError(404, 'NO_CARDS', `No cards found in range #${fromCard}–#${toCard}`);

  let assigned = 0;
  for (const card of cards) {
    if (ownedIds.has(card.id)) continue; // already assigned to this user
    await ucRepo.save(ucRepo.create({ userId, cartelaId: card.id }));
    assigned++;
  }

  res.status(200).json({ success: true, data: { cardsAssigned: assigned, username: user.username } });
});

// Bulk unassign a range of cards from a user
router.post('/unassign-range', async (req: AuthRequest, res: Response) => {
  const { fromCard, toCard, userId } = req.body as { fromCard: number; toCard: number; userId: string };

  if (!fromCard || !toCard || fromCard > toCard)
    throw new AppError(400, 'INVALID_CARD_RANGE', 'fromCard and toCard required, fromCard <= toCard');
  if (!userId)
    throw new AppError(400, 'MISSING_USER', 'userId is required');

  const ucRepo = AppDataSource.getRepository(UserCartela);

  const assignments = await ucRepo
    .createQueryBuilder('uc')
    .innerJoin('uc.cartela', 'c')
    .where('uc.userId = :userId', { userId })
    .andWhere('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .getMany();

  if (assignments.length === 0)
    return res.json({ success: true, data: { cardsUnassigned: 0 } });

  await ucRepo.remove(assignments);
  res.json({ success: true, data: { cardsUnassigned: assignments.length } });
});

// Unassign a cartela from a specific user
router.patch('/:id/unassign', async (req: AuthRequest, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) throw new AppError(400, 'MISSING_USER', 'userId is required to unassign');

  const ucRepo = AppDataSource.getRepository(UserCartela);
  const assignment = await ucRepo.findOne({ where: { cartelaId: req.params.id, userId } });
  if (!assignment) throw new AppError(404, 'NOT_ASSIGNED', 'Cartela is not assigned to this user');
  await ucRepo.remove(assignment);
  res.json({ success: true, message: 'Cartela unassigned' });
});

// Update cartela — reassign user or edit numbers/active status
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  const cartela = await cartelaRepo.findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found');

  const { isActive, userId, numbers } = req.body as { isActive?: boolean; userId?: string; numbers?: number[] };

  if (isActive !== undefined) cartela.isActive = isActive;

  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || numbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
    cartela.numbers = numbers;
  }

  await cartelaRepo.save(cartela);

  // Handle assignment change — userId here means reassign ALL or add one
  if (userId !== undefined) {
    if (userId === '') {
      // Remove all assignments for this cartela
      const existing = await ucRepo.find({ where: { cartelaId: cartela.id } });
      if (existing.length) await ucRepo.remove(existing);
    } else {
      const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
      const existing = await ucRepo.findOne({ where: { cartelaId: cartela.id, userId } });
      if (!existing) {
        await ucRepo.save(ucRepo.create({ userId, cartelaId: cartela.id }));
      }
    }
  }

  const assignments = await ucRepo.find({ where: { cartelaId: cartela.id }, relations: ['user'] });
  res.json({
    success: true,
    data: {
      ...cartela,
      userId: assignments[0]?.userId ?? null,
      user: assignments[0]?.user ? { username: assignments[0].user.username } : null,
      assignedCount: assignments.length,
    },
  });
});

export default router;
