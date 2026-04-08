import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../../../shared/middleware/authMiddleware';
import { AppDataSource } from '../../../config/database';
import { User } from '../domain/User';
import { Transaction } from '../../payment/domain/Transaction';
import { UserCartela } from '../../game/domain/UserCartela';
import { AppError } from '../../../shared/middleware/errorHandler';
import bcrypt from 'bcryptjs';

const router = Router();
router.use(authenticate);

// ─── Player: own profile ────────────────────────────────────────────────────

router.get('/me', async (req: AuthRequest, res: Response) => {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  res.json({ success: true, data: user.sanitize() });
});

router.patch('/me', async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const { firstName, lastName, avatarUrl } = req.body;
  await repo.update(req.user!.id, { firstName, lastName, avatarUrl });
  const user = await repo.findOne({ where: { id: req.user!.id } });
  res.json({ success: true, data: user?.sanitize() });
});

router.get('/me/transactions', async (req: AuthRequest, res: Response) => {
  const txs = await AppDataSource.getRepository(Transaction).find({
    where: { userId: req.user!.id },
    order: { createdAt: 'DESC' },
    take: 100,
  });
  res.json({ success: true, data: txs });
});

// ─── Admin: user management ─────────────────────────────────────────────────

// List all regular users
router.get('/', authorize('admin'), async (_req: AuthRequest, res: Response) => {
  const users = await AppDataSource.getRepository(User).find({
    where: { role: 'player' },
    order: { createdAt: 'DESC' },
  });
  res.json({ success: true, data: users.map((u) => u.sanitize()) });
});

// Create a regular user
router.post('/', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const { username, email, password, firstName, lastName, phone, paymentType } = req.body;

  if (!username || !email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'username, email, and password are required');
  }

  const existing = await repo.findOne({ where: [{ email }, { username }] });
  if (existing) throw new AppError(409, 'USER_EXISTS', 'Email or username already taken');

  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = repo.create({
    username, email, passwordHash, firstName, lastName, phone,
    role: 'player', status: 'active', balance: 0,
    paymentType: paymentType === 'postpaid' ? 'postpaid' : 'prepaid',
  });
  await repo.save(user);
  res.status(201).json({ success: true, data: user.sanitize() });
});

// Get a single user
router.get('/:id', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  res.json({ success: true, data: user.sanitize() });
});

// Update a user
router.patch('/:id', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another admin');

  const { firstName, lastName, phone, email, username, paymentType } = req.body;
  const update: Partial<User> = { firstName, lastName, phone, email, username };
  if (paymentType === 'prepaid' || paymentType === 'postpaid') update.paymentType = paymentType;
  await repo.update(req.params.id, update);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Top up balance (prepaid users only)
router.patch('/:id/balance', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another admin');
  if (user.paymentType !== 'prepaid') throw new AppError(400, 'NOT_PREPAID', 'Balance top-up is only for prepaid users');

  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive number');

  await repo.increment({ id: req.params.id }, 'balance', amount);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Deduct balance (prepaid users only)
router.patch('/:id/balance/deduct', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another admin');
  if (user.paymentType !== 'prepaid') throw new AppError(400, 'NOT_PREPAID', 'Balance deduction is only for prepaid users');

  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive number');
  if (Number(user.balance) < amount) throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Deduction exceeds current balance');

  await repo.decrement({ id: req.params.id }, 'balance', amount);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Activate a user
router.patch('/:id/activate', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another admin');

  await repo.update(req.params.id, { status: 'active' });
  res.json({ success: true, message: 'User activated' });
});

// Deactivate (suspend) a user
router.patch('/:id/deactivate', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another admin');

  await repo.update(req.params.id, { status: 'suspended' });
  res.json({ success: true, message: 'User deactivated' });
});

// Delete a user (soft delete via TypeORM DeleteDateColumn)
router.delete('/:id', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot delete another admin');

  await repo.softDelete(req.params.id);
  res.json({ success: true, message: 'User deleted' });
});

// Get user's transactions
router.get('/:id/transactions', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const txs = await AppDataSource.getRepository(Transaction).find({
    where: { userId: req.params.id },
    order: { createdAt: 'DESC' },
    take: 100,
  });
  res.json({ success: true, data: txs });
});

// Get user's assigned cartelas
router.get('/:id/cartelas', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const assignments = await AppDataSource.getRepository(UserCartela).find({
    where: { userId: req.params.id },
    relations: ['cartela'],
    order: { assignedAt: 'DESC' },
  });
  res.json({ success: true, data: assignments.map((a) => ({ ...a.cartela, assignedAt: a.assignedAt })) });
});

export default router;
