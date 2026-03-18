import { Router } from 'express';
import { authenticate, authorize } from '../../../shared/middleware/authMiddleware';
import { createGame, joinGame, startGame, callNumber, markNumber, claimBingo, getGame, listGames, finishGame } from './GameController';
import { AppDataSource } from '../../../config/database';
import { GameCartela } from '../domain/GameCartela';
import { Game } from '../domain/Game';
import { UserCartela } from '../domain/UserCartela';
import { AuthRequest } from '../../../shared/middleware/authMiddleware';
import { Response } from 'express';

const router = Router();

router.use(authenticate);

// Games the current user participated in (via their cartelas)
router.get('/mine', async (req: AuthRequest, res: Response) => {
  const ucRepo = AppDataSource.getRepository(UserCartela);
  const gcRepo = AppDataSource.getRepository(GameCartela);
  const gameRepo = AppDataSource.getRepository(Game);

  // Get all cartela IDs owned by this user
  const userCartelas = await ucRepo.find({ where: { userId: req.user!.id }, select: ['cartelaId'] });
  if (userCartelas.length === 0) return res.json({ success: true, data: [] });

  const cartelaIds = userCartelas.map((uc) => uc.cartelaId);

  // Find game_cartelas entries for those cartelas
  const gameCartelas = await gcRepo
    .createQueryBuilder('gc')
    .where('gc.cartelaId IN (:...cartelaIds)', { cartelaIds })
    .select(['gc.gameId', 'gc.betAmount', 'gc.joinedAt'])
    .getMany();

  if (gameCartelas.length === 0) return res.json({ success: true, data: [] });

  const gameIds = [...new Set(gameCartelas.map((gc) => gc.gameId))];
  const games = await gameRepo
    .createQueryBuilder('g')
    .where('g.id IN (:...gameIds)', { gameIds })
    .orderBy('g.createdAt', 'DESC')
    .getMany();

  // Attach bet amount per game
  const betMap = new Map<string, number>();
  for (const gc of gameCartelas) {
    betMap.set(gc.gameId, Number(gc.betAmount));
  }

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
router.get('/:gameId', getGame);
router.post('/:gameId/join', joinGame);
router.post('/:gameId/start', startGame);
router.post('/:gameId/call', callNumber);
router.post('/:gameId/finish', finishGame);
router.post('/:gameId/bingo', claimBingo);
router.post('/cartelas/:cartelaId/mark', markNumber);

// Get cartelas linked to a game (for the current user)
router.get('/:gameId/cartelas', async (req: AuthRequest, res: Response) => {
  const gcRepo = AppDataSource.getRepository(GameCartela);
  const entries = await gcRepo.find({
    where: { gameId: req.params.gameId },
    relations: ['cartela'],
  });
  res.json({ success: true, data: entries.map((e) => ({ ...e.cartela, betAmount: e.betAmount })) });
});

export default router;
