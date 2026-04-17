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

// Return user's own cartela rows (data stored directly in user_cartelas)
router.get('/mine', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const cartelas = await ucRepo.find({
    where: { userId: req.user!.id },
    order: { assignedAt: 'ASC' },
  });
  res.json({ success: true, data: cartelas });
});

// Create a new cartela for the current user (stored in user_cartelas only)
router.post('/generate', async (req: AuthRequest, res: Response) => {
  const { numbers: customNumbers, cardNumber: requestedCardNumber } = req.body as {
    numbers?: number[]; cardNumber?: number;
  };

  if (customNumbers !== undefined && (!Array.isArray(customNumbers) || customNumbers.length !== 25))
    throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');

  const { CartelaGenerator } = await import('../application/CartelaGenerator');
  const generator = new CartelaGenerator();
  const ucRepo = AppDataSource.getRepository(UserCartela);

  // Reject duplicate card numbers for this user
  if (requestedCardNumber !== undefined) {
    const dup = await ucRepo.findOne({ where: { userId: req.user!.id, cardNumber: requestedCardNumber } });
    if (dup) throw new AppError(409, 'DUPLICATE_CARD_NUMBER', `Card #${requestedCardNumber} is already in your collection`);
  }

  const numbers = customNumbers ?? generator.generate();
  const patternMask = generator.generateMask();

  const uc = ucRepo.create({
    userId: req.user!.id,
    cardNumber: requestedCardNumber,
    numbers,
    patternMask,
    isActive: true,
    isWinner: false,
    sourceCartelaId: null,
  });
  await ucRepo.save(uc);

  res.status(201).json({ success: true, data: uc });
});

// Delete own cartela
router.delete('/mine/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const uc = await ucRepo.findOne({ where: { id: req.params.id, userId: req.user!.id } });
  if (!uc) throw new AppError(404, 'NOT_FOUND', 'Cartela not found in your collection');
  await ucRepo.remove(uc);
  res.json({ success: true });
});

// Update own cartela numbers / cardNumber
router.patch('/mine/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const uc = await ucRepo.findOne({ where: { id: req.params.id, userId: req.user!.id } });
  if (!uc) throw new AppError(404, 'NOT_FOUND', 'Cartela not found in your collection');

  const { numbers, cardNumber } = req.body as { numbers?: number[]; cardNumber?: number };

  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || numbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
    uc.numbers = numbers;
  }
  if (cardNumber !== undefined) uc.cardNumber = cardNumber;

  await ucRepo.save(uc);
  res.json({ success: true, data: uc });
});

// ─── Admin only below ────────────────────────────────────────────────────────

router.use(authorize('admin'));

// ── Admin cartelas pool (shared template library) ────────────────────────────

// List admin cartela pool
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '100' } = req.query as { page?: string; limit?: string };
  const take = Math.min(Number(limit), 200);
  const skip = (Number(page) - 1) * take;

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const [cartelas, total] = await cartelaRepo.createQueryBuilder('c')
    .orderBy('c.cardNumber', 'ASC')
    .take(take).skip(skip)
    .getManyAndCount();

  res.json({ success: true, data: cartelas, total });
});

// Get single admin cartela
router.get('/pool/:id', async (req: AuthRequest, res: Response) => {
  const cartela = await AppDataSource.getRepository(Cartela).findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found in pool');
  res.json({ success: true, data: cartela });
});

// Update admin pool cartela numbers
router.patch('/pool/:id', async (req: AuthRequest, res: Response) => {
  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const cartela = await cartelaRepo.findOne({ where: { id: req.params.id } });
  if (!cartela) throw new AppError(404, 'NOT_FOUND', 'Cartela not found');

  const { numbers, isActive } = req.body as { numbers?: number[]; isActive?: boolean };

  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || numbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
    cartela.numbers = numbers;
  }
  if (isActive !== undefined) cartela.isActive = isActive;

  await cartelaRepo.save(cartela);
  res.json({ success: true, data: cartela });
});

// ── Admin: manage user cartelas ───────────────────────────────────────────────

// List cartelas assigned to a user
router.get('/user/:userId', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const cartelas = await ucRepo.find({
    where: { userId: req.params.userId },
    order: { assignedAt: 'ASC' },
  });
  res.json({ success: true, data: cartelas });
});

// Assign a card from admin pool to a user (copies data into user_cartelas)
router.post('/assign', async (req: AuthRequest, res: Response) => {
  const { userId, cardNumber } = req.body as { userId: string; cardNumber: number };
  if (!userId || !cardNumber) throw new AppError(400, 'MISSING_FIELDS', 'userId and cardNumber are required');

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const userRepo = AppDataSource.getRepository(User);

  const poolCard = await cartelaRepo.findOne({ where: { cardNumber } });
  if (!poolCard) throw new AppError(404, 'NOT_FOUND', `Card #${cardNumber} not found in admin pool`);

  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  // Check if user already has this card number
  const existing = await ucRepo.findOne({ where: { userId, cardNumber } });
  if (existing) throw new AppError(409, 'ALREADY_ASSIGNED', `Card #${cardNumber} is already in this user's collection`);

  const uc = ucRepo.create({
    userId,
    cardNumber: poolCard.cardNumber,
    numbers: poolCard.numbers,
    patternMask: poolCard.patternMask,
    isActive: true,
    isWinner: false,
    sourceCartelaId: poolCard.id,
  });
  await ucRepo.save(uc);

  res.json({ success: true, data: { ...uc, user: { username: user.username } } });
});

// Assign a range of cards from admin pool to a user
router.post('/assign-range', async (req: AuthRequest, res: Response) => {
  const { fromCard, toCard, userId } = req.body as { fromCard: number; toCard: number; userId: string };

  if (!fromCard || !toCard || fromCard > toCard)
    throw new AppError(400, 'INVALID_CARD_RANGE', 'fromCard and toCard required, fromCard <= toCard');
  if (!userId)
    throw new AppError(400, 'MISSING_USER', 'userId is required');

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const cartelaRepo = AppDataSource.getRepository(Cartela);
  const ucRepo = AppDataSource.getRepository(UserCartela);

  const poolCards = await cartelaRepo.createQueryBuilder('c')
    .where('c.cardNumber >= :fromCard AND c.cardNumber <= :toCard', { fromCard, toCard })
    .orderBy('c.cardNumber', 'ASC')
    .getMany();

  if (poolCards.length === 0)
    throw new AppError(404, 'NO_CARDS', `No cards found in pool for range #${fromCard}–#${toCard}`);

  // Get card numbers user already has
  const owned = await ucRepo
    .createQueryBuilder('uc')
    .where('uc.userId = :userId', { userId })
    .andWhere('uc.cardNumber >= :fromCard AND uc.cardNumber <= :toCard', { fromCard, toCard })
    .select('uc.cardNumber')
    .getMany();
  const ownedNums = new Set(owned.map((o) => o.cardNumber));

  let assigned = 0;
  for (const card of poolCards) {
    if (ownedNums.has(card.cardNumber)) continue;
    await ucRepo.save(ucRepo.create({
      userId,
      cardNumber: card.cardNumber,
      numbers: card.numbers,
      patternMask: card.patternMask,
      isActive: true,
      isWinner: false,
      sourceCartelaId: card.id,
    }));
    assigned++;
  }

  res.json({ success: true, data: { cardsAssigned: assigned, username: user.username } });
});

// Unassign a range of cards from a user
router.post('/unassign-range', async (req: AuthRequest, res: Response) => {
  const { fromCard, toCard, userId } = req.body as { fromCard: number; toCard: number; userId: string };

  if (!fromCard || !toCard || fromCard > toCard)
    throw new AppError(400, 'INVALID_CARD_RANGE', 'fromCard and toCard required, fromCard <= toCard');
  if (!userId)
    throw new AppError(400, 'MISSING_USER', 'userId is required');

  const ucRepo = AppDataSource.getRepository(UserCartela);

  const toRemove = await ucRepo
    .createQueryBuilder('uc')
    .where('uc.userId = :userId', { userId })
    .andWhere('uc.cardNumber >= :fromCard AND uc.cardNumber <= :toCard', { fromCard, toCard })
    .getMany();

  if (toRemove.length === 0)
    return res.json({ success: true, data: { cardsUnassigned: 0 } });

  await ucRepo.remove(toRemove);
  res.json({ success: true, data: { cardsUnassigned: toRemove.length } });
});

// Copy all cartelas from one user to another
router.post('/copy-from', async (req: AuthRequest, res: Response) => {
  const { fromUserId, toUserId } = req.body as { fromUserId: string; toUserId: string };
  if (!fromUserId || !toUserId) throw new AppError(400, 'MISSING_FIELDS', 'fromUserId and toUserId are required');
  if (fromUserId === toUserId) throw new AppError(400, 'SAME_USER', 'Cannot copy to the same user');

  const ucRepo = AppDataSource.getRepository(UserCartela);

  const source = await ucRepo.find({ where: { userId: fromUserId } });
  if (source.length === 0) throw new AppError(404, 'NO_CARTELAS', 'Source user has no cartelas');

  const existing = await ucRepo.find({ where: { userId: toUserId }, select: ['cardNumber'] });
  const ownedNums = new Set(existing.map((e) => e.cardNumber));

  let copied = 0;
  for (const s of source) {
    if (ownedNums.has(s.cardNumber)) continue;
    await ucRepo.save(ucRepo.create({
      userId: toUserId,
      cardNumber: s.cardNumber,
      numbers: s.numbers,
      patternMask: [...s.patternMask.map((_, i) => i === 12)], // reset mask
      isActive: true,
      isWinner: false,
      sourceCartelaId: s.sourceCartelaId,
    }));
    copied++;
  }

  res.json({ success: true, data: { copied, total: source.length } });
});

// Add a custom cartela directly to a user (no pool required)
router.post('/user/:userId/add', async (req: AuthRequest, res: Response) => {
  const { cardNumber, numbers } = req.body as { cardNumber: number; numbers: number[] };

  if (!cardNumber) throw new AppError(400, 'MISSING_FIELDS', 'cardNumber is required');
  if (!Array.isArray(numbers) || numbers.length !== 25)
    throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.params.userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const ucRepo = AppDataSource.getRepository(UserCartela);
  const dup = await ucRepo.findOne({ where: { userId: req.params.userId, cardNumber } });
  if (dup) throw new AppError(409, 'ALREADY_ASSIGNED', `Card #${cardNumber} is already in this user's collection`);

  const patternMask = Array(25).fill(false);
  patternMask[12] = true;

  const uc = ucRepo.create({
    userId: req.params.userId,
    cardNumber,
    numbers,
    patternMask,
    isActive: true,
    isWinner: false,
    sourceCartelaId: null,
  });
  await ucRepo.save(uc);

  res.status(201).json({ success: true, data: uc });
});

// Remove a specific user cartela by its user_cartela id
router.delete('/user/:userId/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const uc = await ucRepo.findOne({ where: { id: req.params.id, userId: req.params.userId } });
  if (!uc) throw new AppError(404, 'NOT_FOUND', 'Cartela not found for this user');
  await ucRepo.remove(uc);
  res.json({ success: true });
});

// Clear ALL cartelas for a user
router.delete('/user/:userId/all', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const cartelas = await ucRepo.find({ where: { userId: req.params.userId } });
  if (cartelas.length > 0) await ucRepo.remove(cartelas);
  res.json({ success: true, data: { removed: cartelas.length } });
});

// Update a user's cartela (numbers / cardNumber)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const uc = await ucRepo.findOne({ where: { id: req.params.id } });
  if (!uc) throw new AppError(404, 'NOT_FOUND', 'User cartela not found');

  const { numbers, cardNumber, isActive } = req.body as {
    numbers?: number[]; cardNumber?: number; isActive?: boolean;
  };

  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || numbers.length !== 25)
      throw new AppError(400, 'INVALID_NUMBERS', 'numbers must be an array of 25 integers');
    uc.numbers = numbers;
  }
  if (cardNumber !== undefined) uc.cardNumber = cardNumber;
  if (isActive !== undefined) uc.isActive = isActive;

  await ucRepo.save(uc);
  res.json({ success: true, data: uc });
});

// Legacy unassign endpoint — removes a user_cartela row
router.patch('/:id/unassign', async (req: AuthRequest, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) throw new AppError(400, 'MISSING_USER', 'userId is required to unassign');

  const ucRepo = AppDataSource.getRepository(UserCartela);
  const uc = await ucRepo.findOne({ where: { id: req.params.id, userId } });
  if (!uc) throw new AppError(404, 'NOT_ASSIGNED', 'Cartela not found for this user');
  await ucRepo.remove(uc);
  res.json({ success: true, message: 'Cartela removed' });
});

export default router;
