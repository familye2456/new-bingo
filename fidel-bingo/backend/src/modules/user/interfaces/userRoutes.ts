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

// ─── Helper: verify an agent owns the target user ───────────────────────────

function assertAgentOwns(actor: { id: string; role: string }, target: User) {
  if (actor.role === 'admin') return; // admins can do anything
  // agents can only touch users they created (or legacy users with no createdBy)
  if (target.createdBy !== null && target.createdBy !== undefined && target.createdBy !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'You can only manage users you created');
  }
}

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

// ─── Admin / Agent: user management ─────────────────────────────────────────

// List all agents (admin only — for the assign-agent dropdown)
router.get('/agents', authorize('admin'), async (_req: AuthRequest, res: Response) => {
  const users = await AppDataSource.getRepository(User).find({
    where: { role: 'agent' },
    order: { createdAt: 'DESC' },
  });
  res.json({ success: true, data: users.map((u) => u.sanitize()) });
});

// List users — admins see all players, agents see only their own
router.get('/', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const actor = req.user!;

  let users: User[];
  if (actor.role === 'admin') {
    users = await repo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: 'player' })
      .orderBy('u.created_at', 'DESC')
      .getMany();
  } else {
    // agent: only players assigned to them (created_by = agent id) or unassigned (created_by IS NULL)
    users = await repo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: 'player' })
      .andWhere('(u.created_by = :id OR u.created_by IS NULL)', { id: actor.id })
      .orderBy('u.created_at', 'DESC')
      .getMany();
  }

  // Attach agent username for each user that has a createdBy
  const agentIds = [...new Set(users.map(u => u.createdBy).filter(Boolean))] as string[];
  const agentMap: Record<string, string> = {};
  if (agentIds.length > 0) {
    const agents = await repo.findByIds(agentIds);
    for (const a of agents) agentMap[a.id] = a.username;
  }

  res.json({
    success: true,
    data: users.map((u) => ({ ...u.sanitize(), agentUsername: u.createdBy ? (agentMap[u.createdBy] ?? null) : null })),
  });
});

// Create a user — admins can create players & agents; agents can only create players
router.post('/', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const actor = req.user!;
  const { username, email, password, firstName, lastName, phone, paymentType, role: requestedRole, agentId } = req.body;

  if (!username || !email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'username, email, and password are required');
  }

  // Determine role to assign
  let assignRole: 'player' | 'agent' = 'player';
  if (requestedRole === 'agent') {
    if (actor.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Only admins can create agents');
    assignRole = 'agent';
  }

  const existing = await repo.findOne({ where: [{ email }, { username }] });
  if (existing) throw new AppError(409, 'USER_EXISTS', 'Email or username already taken');

  const actorUser = await repo.findOne({ where: { id: actor.id } });
  if (!actorUser) throw new AppError(401, 'UNAUTHORIZED', 'Actor not found');

  // Admin can assign a new player directly to an agent via agentId
  let createdBy = actor.id;
  if (agentId && actor.role === 'admin' && assignRole === 'player') {
    const agent = await repo.findOne({ where: { id: agentId, role: 'agent' } });
    if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
    createdBy = agentId;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = repo.create({
    username, email, passwordHash,
    firstName: firstName || null,
    lastName: lastName || null,
    phone: phone || null,
    role: assignRole,
    status: 'active',
    balance: 0,
    paymentType: paymentType === 'postpaid' ? 'postpaid' : 'prepaid',
    createdBy,
  });
  await repo.save(user);
  res.status(201).json({ success: true, data: user.sanitize() });
});

// Get a single user
router.get('/:id', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  assertAgentOwns(req.user!, user);
  res.json({ success: true, data: user.sanitize() });
});

// Update a user
router.patch('/:id', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify an admin');
  if (user.role === 'agent' && req.user!.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify another agent');
  assertAgentOwns(req.user!, user);

  const { firstName, lastName, phone, email, username, paymentType } = req.body;
  const update: Partial<User> = { firstName, lastName, phone, email, username };
  if (paymentType === 'prepaid' || paymentType === 'postpaid') update.paymentType = paymentType;
  await repo.update(req.params.id, update);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Top up balance
router.patch('/:id/balance', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify an admin');
  assertAgentOwns(req.user!, user);
  if (user.paymentType !== 'prepaid') throw new AppError(400, 'NOT_PREPAID', 'Balance top-up is only for prepaid users');

  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive number');

  await repo.increment({ id: req.params.id }, 'balance', amount);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Deduct balance
router.patch('/:id/balance/deduct', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify an admin');
  assertAgentOwns(req.user!, user);
  if (user.paymentType !== 'prepaid') throw new AppError(400, 'NOT_PREPAID', 'Balance deduction is only for prepaid users');

  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive number');
  if (Number(user.balance) < amount) throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Deduction exceeds current balance');

  await repo.decrement({ id: req.params.id }, 'balance', amount);
  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Activate a user
router.patch('/:id/activate', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify an admin');
  assertAgentOwns(req.user!, user);

  await repo.update(req.params.id, { status: 'active' });
  res.json({ success: true, message: 'User activated' });
});

// Deactivate (suspend) a user
router.patch('/:id/deactivate', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot modify an admin');
  assertAgentOwns(req.user!, user);

  await repo.update(req.params.id, { status: 'suspended' });
  res.json({ success: true, message: 'User deactivated' });
});

// Assign a user to an agent (admin only)
router.patch('/:id/assign-agent', authorize('admin'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role !== 'player') throw new AppError(400, 'INVALID_ROLE', 'Only players can be assigned to an agent');

  const { agentId } = req.body;

  if (agentId === null || agentId === undefined || agentId === '') {
    // Unassign — remove from any agent
    await repo.update(req.params.id, { createdBy: undefined });
  } else {
    const agent = await repo.findOne({ where: { id: agentId, role: 'agent' } });
    if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
    await repo.update(req.params.id, { createdBy: agentId });
  }

  const updated = await repo.findOne({ where: { id: req.params.id } });
  res.json({ success: true, data: updated?.sanitize() });
});

// Delete a user and all related data
router.delete('/:id', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (user.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot delete an admin');
  if (user.role === 'agent' && req.user!.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Cannot delete another agent');
  assertAgentOwns(req.user!, user);

  const id = req.params.id;
  await AppDataSource.query(`DELETE FROM game_cartelas WHERE user_id = $1`, [id]);
  await AppDataSource.query(`DELETE FROM user_cartelas WHERE user_id = $1`, [id]);
  await AppDataSource.query(`DELETE FROM transactions WHERE user_id = $1`, [id]);
  await AppDataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]).catch(() => {});
  await AppDataSource.query(`DELETE FROM audit_logs WHERE user_id = $1`, [id]).catch(() => {});
  await AppDataSource.query(`DELETE FROM games WHERE creator_id = $1`, [id]);
  await repo.delete(id);

  res.json({ success: true, message: 'User and all related data deleted' });
});

// Get user's transactions
router.get('/:id/transactions', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  assertAgentOwns(req.user!, user);

  const txs = await AppDataSource.getRepository(Transaction).find({
    where: { userId: req.params.id },
    order: { createdAt: 'DESC' },
    take: 100,
  });
  res.json({ success: true, data: txs });
});

// Get user's assigned cartelas
router.get('/:id/cartelas', authorize('admin', 'agent'), async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  assertAgentOwns(req.user!, user);

  const cartelas = await AppDataSource.getRepository(UserCartela).find({
    where: { userId: req.params.id },
    order: { assignedAt: 'ASC' },
  });
  res.json({ success: true, data: cartelas });
});

export default router;
