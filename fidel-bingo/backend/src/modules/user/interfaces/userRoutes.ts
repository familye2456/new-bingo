import { Router, Response } from 'express';
import { Server } from 'socket.io';
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
  if (actor.role === 'admin') return;
  if (target.createdBy !== actor.id) {
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
    // agent: only players explicitly assigned to them
    users = await repo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: 'player' })
      .andWhere('u.created_by = :id', { id: actor.id })
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
const notifyBalanceUpdate = (req: AuthRequest, userId: string, balance: number) => {
  const io = (req.app as any).get('io') as Server | undefined;
  if (!io) return;
  io.to(`user:${userId}`).emit('balance_updated', {
    userId,
    balance,
    updatedAt: new Date().toISOString(),
    source: 'admin_adjustment',
  });
};

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

  // Record deposit transaction so it appears in balance history
  await AppDataSource.getRepository(Transaction).save(
    AppDataSource.getRepository(Transaction).create({
      userId: req.params.id,
      transactionType: 'deposit',
      amount,
      status: 'completed',
      description: `Top-up by ${req.user!.role} (${req.user!.id.slice(0, 8)})`,
      processedAt: new Date(),
    })
  );

  // If balance is now non-negative, dismiss any pending negative-balance alert
  if (updated && Number(updated.balance) >= 0) {
    await AppDataSource.getRepository(Transaction).delete({
      userId: req.params.id,
      transactionType: 'refund',
      description: 'NEGATIVE_BALANCE_ALERT',
      status: 'pending',
    });
  }

  notifyBalanceUpdate(req, req.params.id, Number(updated?.balance ?? user.balance ?? 0));
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

  // Record withdrawal transaction so it appears in balance history
  await AppDataSource.getRepository(Transaction).save(
    AppDataSource.getRepository(Transaction).create({
      userId: req.params.id,
      transactionType: 'withdrawal',
      amount,
      status: 'completed',
      description: `Deduction by ${req.user!.role} (${req.user!.id.slice(0, 8)})`,
      processedAt: new Date(),
    })
  );

  notifyBalanceUpdate(req, req.params.id, Number(updated?.balance ?? user.balance ?? 0));
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

// ─── Negative balance alert — called by frontend when sync reveals negative balance ───
router.post('/me/alert-negative-balance', async (req: AuthRequest, res: Response) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.user!.id } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const balance = Number(user.balance);
  const txRepo = AppDataSource.getRepository(Transaction);

  if (balance >= 0) {
    // Balance is fine — remove any stale pending alert
    await txRepo.delete({
      userId: user.id,
      transactionType: 'refund',
      description: 'NEGATIVE_BALANCE_ALERT',
      status: 'pending',
    });
    return res.json({ success: true, alerted: false });
  }

  // Record the alert so admins can see it — only one active alert per user
  const alreadyAlerted = await txRepo.findOne({
    where: {
      userId: user.id,
      transactionType: 'refund',
      description: 'NEGATIVE_BALANCE_ALERT',
      status: 'pending',
    },
  });

  if (!alreadyAlerted) {
    await txRepo.save(txRepo.create({
      userId: user.id,
      transactionType: 'refund',
      amount: Math.abs(balance),
      status: 'pending',
      description: 'NEGATIVE_BALANCE_ALERT',
      processedAt: new Date(),
    }));
  }

  return res.json({ success: true, alerted: true, balance });
});

// ─── Admin: list all negative-balance alerts (pending refund with NEGATIVE_BALANCE_ALERT) ───
router.get('/negative-balance-alerts', authorize('admin', 'agent'), async (_req: AuthRequest, res: Response) => {
  const txRepo = AppDataSource.getRepository(Transaction);
  const alerts = await txRepo.find({
    where: { transactionType: 'refund', description: 'NEGATIVE_BALANCE_ALERT', status: 'pending' },
    order: { processedAt: 'DESC' },
  });

  // Enrich with user info
  const userRepo = AppDataSource.getRepository(User);
  const enriched = await Promise.all(
    alerts.map(async (a) => {
      const u = a.userId ? await userRepo.findOne({ where: { id: a.userId } }) : null;
      return {
        alertId: a.id,
        userId: a.userId,
        username: u?.username,
        balance: u ? Number(u.balance) : null,
        alertedAt: a.processedAt,
      };
    })
  );

  res.json({ success: true, data: enriched });
});

export default router;
