import { Response } from 'express';
import { GameService } from '../application/GameService';
import { AuthRequest } from '../../../shared/middleware/authMiddleware';

const gameService = new GameService();

export const createGame = async (req: AuthRequest, res: Response) => {
  const game = await gameService.createGame(req.user!.id, req.body);
  res.status(201).json({ success: true, data: game });
};

export const joinGame = async (req: AuthRequest, res: Response) => {
  const cartelas = await gameService.joinGame(req.params.gameId, req.user!.id, req.body.cartelaCount || 1);
  res.json({ success: true, data: cartelas });
};

export const startGame = async (req: AuthRequest, res: Response) => {
  const game = await gameService.startGame(req.params.gameId, req.user!.id);
  res.json({ success: true, data: game });
};

export const callNumber = async (req: AuthRequest, res: Response) => {
  const result = await gameService.callNumber(req.params.gameId, req.user!.id);
  res.json({ success: true, data: result });
};

export const markNumber = async (req: AuthRequest, res: Response) => {
  const result = await gameService.markNumber(req.params.cartelaId, req.user!.id, req.body.number);
  res.json({ success: true, data: result });
};

export const claimBingo = async (req: AuthRequest, res: Response) => {
  const result = await gameService.claimBingo(req.params.gameId, req.body.cartelaId, req.user!.id);
  res.json({ success: true, data: result });
};

export const getGame = async (req: AuthRequest, res: Response) => {
  const game = await gameService.getGame(req.params.gameId);
  res.json({ success: true, data: game });
};

export const listGames = async (req: AuthRequest, res: Response) => {
  const games = await gameService.listGames(req.query.status as string);
  res.json({ success: true, data: games });
};
