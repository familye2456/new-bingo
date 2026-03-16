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
    // Get all assigned cartelaIds, then exclude them
    const assigned = await ucRepo.find({ select: ['cartelaId'] });
    const assignedIds = assigned.map((a) => a.cartelaId);

    const qb = cartelaRepo.createQueryBuilder('c')
      .orderBy('c.cardNumber', 'ASC')
      .take(take).skip(skip);

    if (assignedIds.length > 0) {
      qb.where('c.id NOT IN (:...assignedIds)', { assignedIds });
    }

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

  // Enrich with assignment info
  const allAssignments = await ucRepo.find({
    where: cartelaIds
      ? cartelaIds.map((id) => ({ cartelaId: id }))
      : undefined,
    relations: ['user'],
  });
  const assignMap = new Map(allAssignments.map((a) => [a.cartelaId, a]));

  const data = cartelas.map((c) => {
    const assignment = assignMap.get(c.id);
    return {
      ...c,
      userId: assignment?.userId ?? null,
      user: assignment?.user ? { username: assignment.user.username } : null,
    };
  });

  res.json({ success: true, data, total });
});

// Get single cartela with assignment info
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const cartela = await AppDataSource.getRepository(Cartela).findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found');

  const assignment = await AppDataSource.getRepository(UserCartela).findOne({
    where: { cartelaId: req.params.id },
    relations: ['user'],
  });

  res.json({
    success: true,
    data: {
      ...cartela,
      userId: assignment?.userId ?? null,
      user: assignment?.user ? { username: assignment.user.username } : null,
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

  const existing = await ucRepo.findOne({ where: { cartelaId: cartela.id } });
  if (existing) throw new AppError(409, 'ALREADY_ASSIGNED', `Card #${cardNumber} is already assigned`);

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

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

  // Find already-assigned card IDs in this range
  const assignedInRange = await ucRepo
    .createQueryBuilder('uc')
    .innerJoin('uc.cartela', 'c')
    .where('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .select('uc.cartelaId')
    .getMany();
  const assignedIds = assignedInRange.map((a) => a.cartelaId);

  const qb = cartelaRepo.createQueryBuilder('c')
    .where('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .orderBy('c.cardNumber', 'ASC');
  if (assignedIds.length > 0) qb.andWhere('c.id NOT IN (:...assignedIds)', { assignedIds });

  const cards = await qb.getMany();
  if (cards.length === 0)
    throw new AppError(404, 'NO_CARDS', `No unassigned cards found in range #${fromCard}–#${toCard}`);

  let assigned = 0;
  for (const card of cards) {
    await ucRepo.save(ucRepo.create({ userId, cartelaId: card.id }));
    assigned++;
  }

  res.status(200).json({ success: true, data: { cardsAssigned: assigned, username: user.username } });
});

// Unassign a cartela
router.patch('/:id/unassign', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const assignment = await ucRepo.findOne({ where: { cartelaId: req.params.id } });
  if (!assignment) throw new AppError(404, 'NOT_ASSIGNED', 'Cartela is not assigned');
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

  // Handle assignment change
  if (userId !== undefined) {
    const existing = await ucRepo.findOne({ where: { cartelaId: cartela.id } });
    if (userId === '') {
      if (existing) await ucRepo.remove(existing);
    } else {
      const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
      if (existing) {
        existing.userId = userId;
        await ucRepo.save(existing);
      } else {
        await ucRepo.save(ucRepo.create({ userId, cartelaId: cartela.id }));
      }
    }
  }

  const assignment = await ucRepo.findOne({ where: { cartelaId: cartela.id }, relations: ['user'] });
  res.json({
    success: true,
    data: {
      ...cartela,
      userId: assignment?.userId ?? null,
      user: assignment?.user ? { username: assignment.user.username } : null,
    },
  });
});

export default router;
