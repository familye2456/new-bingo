import { Router } from 'express';
import { authenticate, authorize } from '../../../shared/middleware/authMiddleware';
import { createGame, joinGame, startGame, callNumber, markNumber, claimBingo, getGame, listGames, finishGame, resetGame, checkCartela } from './GameController';
import { AppDataSource } from '../../../config/database';
import { GameCartela } from '../domain/GameCartela';
import { Game } from '../domain/Game';
import { UserCartela } from '../domain/UserCartela';
import { Transaction } from '../../payment/domain/Transaction';
import { AuthRequest } from '../../../shared/middleware/authMiddleware';
import { Response } from 'express';

const router = Router();

router.use(authenticate);

// Games the current user participated in (via userId on game_cartelas)
router.get('/mine', async (req: AuthRequest, res: Response) => {
  const gcRepo = AppDataSource.getRepository(GameCartela);
  const gameRepo = AppDataSource.getRepository(Game);

  // Find all game entries for this user directly by userId
  const gameCartelas = await gcRepo
    .createQueryBuilder('gc')
    .where('gc.userId = :userId', { userId: req.user!.id })
    .select(['gc.gameId', 'gc.betAmount', 'gc.joinedAt'])
    .getMany();

  if (gameCartelas.length === 0) return res.json({ success: true, data: [] });

  const gameIds = [...new Set(gameCartelas.map((gc) => gc.gameId))];
  const games = await gameRepo
    .createQueryBuilder('g')
    .where('g.id IN (:...gameIds)', { gameIds })
    .orderBy('g.createdAt', 'DESC')
    .getMany();

  const betMap = new Map<string, number>();
  for (const gc of gameCartelas) betMap.set(gc.gameId, Number(gc.betAmount));

  const data = games.map((g) => ({
    ...g,
    myBet: betMap.get(g.id) ?? 0,
    isWinner: g.winnerIds?.includes(req.user!.id) ?? false,
  }));

  res.json({ success: true, data });
});

router.get('/', listGames);
// Only players (not admins) can create games
router.post('/', authorize('player', 'operator'), createGame);

// Daily bonus status — must be before /:gameId to avoid conflict
router.get('/bonus/today', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const txRepo = AppDataSource.getRepository(Transaction);
  const gameRepo = AppDataSource.getRepository(Game);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [bonusTx, houseCutResult] = await Promise.all([
    txRepo.createQueryBuilder('t')
      .where('t.userId = :userId', { userId })
      .andWhere('t.transactionType = :type', { type: 'bonus' })
      .andWhere('t.createdAt >= :todayStart', { todayStart })
      .getOne(),
    gameRepo.createQueryBuilder('g')
      .select('SUM(g.houseCut)', 'total')
      .where('g.creatorId = :userId', { userId })
      .andWhere('g.status = :status', { status: 'finished' })
      .andWhere('(g.finishedAt >= :todayStart OR g.createdAt >= :todayStart)', { todayStart })
      .getRawOne(),
  ]);

  const dailyHouseCut = parseFloat(houseCutResult?.total ?? '0') || 0;
  res.json({
    success: true,
    data: {
      bonusApplied: !!bonusTx,
      bonusAmount: bonusTx ? 200 : 0,
      bonusAppliedAt: bonusTx?.createdAt ?? null,
      dailyHouseCut,
      threshold: 1000,
      progress: Math.min(100, Math.round((dailyHouseCut / 1000) * 100)),
    },
  });
});

router.get('/:gameId', getGame);
router.post('/:gameId/join', joinGame);
router.post('/:gameId/start', startGame);
router.post('/:gameId/call', callNumber);
router.post('/:gameId/reset', resetGame);
router.get('/:gameId/check/:cardNumber', checkCartela);
router.post('/:gameId/finish', finishGame);
router.post('/:gameId/bingo', claimBingo);
router.post('/cartelas/:cartelaId/mark', markNumber);

// Get cartelas linked to a game (for the current user)
router.get('/:gameId/cartelas', async (req: AuthRequest, res: Response) => {
  const gcRepo = AppDataSource.getRepository(GameCartela);
  const gameId = req.params.gameId;
  const entries = req.user!.role === 'admin'
    ? await gcRepo.find({ where: { gameId }, relations: ['userCartela'] })
    : await gcRepo.find({ where: { gameId, userId: req.user!.id }, relations: ['userCartela'] });
  res.json({ success: true, data: entries.map((e) => ({ ...e.userCartela, betAmount: e.betAmount })) });
});

export default router;
