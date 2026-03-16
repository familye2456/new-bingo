import { Router } from 'express';
import { authenticate, authorize } from '../../../shared/middleware/authMiddleware';
import { createGame, joinGame, startGame, callNumber, markNumber, claimBingo, getGame, listGames } from './GameController';
import { AppDataSource } from '../../../config/database';
import { GameCartela } from '../domain/GameCartela';
import { AuthRequest } from '../../../shared/middleware/authMiddleware';
import { Response } from 'express';

const router = Router();

router.use(authenticate);

router.get('/', listGames);
// Only players (not admins) can create games
router.post('/', authorize('player', 'operator'), createGame);
router.get('/:gameId', getGame);
router.post('/:gameId/join', joinGame);
router.post('/:gameId/start', startGame);
router.post('/:gameId/call', callNumber);
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
