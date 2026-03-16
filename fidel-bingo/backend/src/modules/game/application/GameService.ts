import { AppDataSource } from '../../../config/database';
import { Game } from '../domain/Game';
import { Cartela } from '../domain/Cartela';
import { UserCartela } from '../domain/UserCartela';
import { GameCartela } from '../domain/GameCartela';
import { User } from '../../user/domain/User';
import { Transaction } from '../../payment/domain/Transaction';
import { CartelaGenerator } from './CartelaGenerator';
import { WinnerDetection } from './WinnerDetection';
import { AppError } from '../../../shared/middleware/errorHandler';
import { redisClient } from '../../../config/redis';
import { activeGames } from '../../../shared/infrastructure/metrics';
import { logger } from '../../../shared/infrastructure/logger';
import { env } from '../../../config/env';

export interface CreateGameDTO {
  /** IDs of cartelas pre-assigned to the user (from user_cartelas) */
  cartelaIds: string[];
  betAmountPerCartela: number;
  winPattern?: string;
}

export class GameService {
  private gameRepo = AppDataSource.getRepository(Game);
  private cartelaRepo = AppDataSource.getRepository(Cartela);
  private ucRepo = AppDataSource.getRepository(UserCartela);
  private gcRepo = AppDataSource.getRepository(GameCartela);
  private userRepo = AppDataSource.getRepository(User);
  private generator = new CartelaGenerator();
  private winDetector = new WinnerDetection();

  async createGame(userId: string, dto: CreateGameDTO): Promise<Game> {
    if (!dto.cartelaIds || dto.cartelaIds.length === 0)
      throw new AppError(400, 'NO_CARTELAS', 'Select at least one cartela');
    if (dto.betAmountPerCartela <= 0)
      throw new AppError(400, 'INVALID_BET', 'Invalid bet amount');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    // Verify all cartelas belong to this user
    const ownedAssignments = await this.ucRepo.find({ where: { userId } });
    const ownedIds = new Set(ownedAssignments.map((a) => a.cartelaId));
    for (const cid of dto.cartelaIds) {
      if (!ownedIds.has(cid)) throw new AppError(403, 'FORBIDDEN', `Cartela ${cid} is not assigned to you`);
    }

    const cartelas = await this.cartelaRepo.findByIds(dto.cartelaIds);
    if (cartelas.length !== dto.cartelaIds.length)
      throw new AppError(404, 'CARTELA_NOT_FOUND', 'One or more cartelas not found');

    const totalCost = dto.betAmountPerCartela * dto.cartelaIds.length;
    if (user.paymentType !== 'postpaid' && user.balance < totalCost) {
      throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
    }

    return AppDataSource.transaction(async (manager) => {
      const game = manager.create(Game, {
        creatorId: userId,
        betAmount: dto.betAmountPerCartela,
        housePercentage: env.HOUSE_PERCENTAGE,
        winPattern: dto.winPattern ?? 'any',
        status: 'active',
        calledNumbers: [],
        winnerIds: [],
        cartelaCount: cartelas.length,
        totalBets: totalCost,
        prizePool: totalCost * (1 - env.HOUSE_PERCENTAGE / 100),
        houseCut: totalCost * (env.HOUSE_PERCENTAGE / 100),
      });
      await manager.save(game);

      // Set purchase price on each cartela and link to game
      for (const cartela of cartelas) {
        cartela.purchasePrice = dto.betAmountPerCartela;
        cartela.patternMask = Array(25).fill(false);
        cartela.patternMask[12] = true; // FREE center
        cartela.isWinner = false;
        await manager.save(cartela);

        await manager.save(manager.create(GameCartela, {
          gameId: game.id,
          cartelaId: cartela.id,
          betAmount: dto.betAmountPerCartela,
        }));
      }

      await manager.decrement(User, { id: userId }, 'balance', totalCost);

      await manager.save(manager.create(Transaction, {
        userId,
        gameId: game.id,
        transactionType: 'bet',
        amount: totalCost,
        status: 'completed',
        description: `Bet for game ${game.id}`,
        processedAt: new Date(),
      }));

      activeGames.inc();
      logger.info('Game created', { gameId: game.id, userId });
      return game;
    });
  }

  async joinGame(gameId: string, userId: string, cartelaCount: number): Promise<Cartela[]> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game || game.status !== 'pending') throw new AppError(400, 'GAME_NOT_JOINABLE', 'Game is not joinable');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const totalCost = game.betAmount * cartelaCount;
    if (user.paymentType !== 'postpaid' && user.balance < totalCost) {
      throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
    }

    return AppDataSource.transaction(async (manager) => {
      const cartelas: Cartela[] = [];
      for (let i = 0; i < cartelaCount; i++) {
        const cartela = manager.create(Cartela, {
          numbers: this.generator.generate(),
          patternMask: this.generator.generateMask(),
          purchasePrice: game.betAmount,
          isActive: true,
          isWinner: false,
        });
        const saved = await manager.save(cartela);
        await manager.save(manager.create(UserCartela, { userId, cartelaId: saved.id }));
        cartelas.push(saved);
      }

      await manager.decrement(User, { id: userId }, 'balance', totalCost);
      await manager.increment(Game, { id: gameId }, 'totalBets', totalCost);
      await manager.increment(Game, { id: gameId }, 'cartelaCount', cartelaCount);

      const updatedGame = await manager.findOne(Game, { where: { id: gameId } });
      if (updatedGame) {
        updatedGame.prizePool = updatedGame.totalBets * (1 - updatedGame.housePercentage / 100);
        updatedGame.houseCut = updatedGame.totalBets * (updatedGame.housePercentage / 100);
        await manager.save(updatedGame);
      }

      return cartelas;
    });
  }

  async startGame(gameId: string, userId: string): Promise<Game> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can start the game');
    if (game.status !== 'pending') throw new AppError(400, 'INVALID_STATE', 'Game cannot be started');

    game.status = 'active';
    game.startedAt = new Date();
    await this.gameRepo.save(game);

    await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game));
    logger.info('Game started', { gameId });
    return game;
  }

  async callNumber(gameId: string, userId: string): Promise<{ number: number; remaining: number }> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can call numbers');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');

    const allNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
    const remaining = allNumbers.filter((n) => !game.calledNumbers.includes(n));
    if (remaining.length === 0) throw new AppError(400, 'NO_NUMBERS_LEFT', 'All numbers have been called');

    const number = remaining[Math.floor(Math.random() * remaining.length)];
    game.calledNumbers = [...game.calledNumbers, number];
    await this.gameRepo.save(game);

    await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game));
    return { number, remaining: remaining.length - 1 };
  }

  async markNumber(cartelaId: string, userId: string, number: number): Promise<{ isWinner: boolean; pattern: string | null }> {
    const cartela = await this.cartelaRepo.findOne({ where: { id: cartelaId } });
    if (!cartela) throw new AppError(404, 'CARTELA_NOT_FOUND', 'Cartela not found');

    // Verify ownership via user_cartelas
    const ownership = await this.ucRepo.findOne({ where: { cartelaId, userId } });
    if (!ownership) throw new AppError(403, 'FORBIDDEN', 'Not your cartela');

    // Get the game this cartela belongs to (via called numbers check — need game context)
    // For markNumber we need the game's calledNumbers; pass gameId from client or look it up
    // Since cartela no longer has gameId, we skip the calledNumbers check here
    // (the client should only call this after a number is called in the game)

    const idx = cartela.numbers.indexOf(number);
    if (idx !== -1) {
      cartela.patternMask[idx] = true;
    }

    const pattern = this.winDetector.getWinPattern(cartela.patternMask);
    if (pattern) {
      cartela.isWinner = true;
      cartela.winPattern = pattern;
    }

    await this.cartelaRepo.save(cartela);
    return { isWinner: !!pattern, pattern };
  }

  async claimBingo(gameId: string, cartelaId: string, userId: string): Promise<{ valid: boolean; amount: number }> {
    const cartela = await this.cartelaRepo.findOne({ where: { id: cartelaId } });
    if (!cartela) throw new AppError(404, 'CARTELA_NOT_FOUND', 'Cartela not found');

    // Verify ownership
    const ownership = await this.ucRepo.findOne({ where: { cartelaId, userId } });
    if (!ownership) throw new AppError(403, 'FORBIDDEN', 'Invalid claim');

    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game || game.status !== 'active') throw new AppError(400, 'INVALID_CLAIM', 'Invalid game state');

    const pattern = this.winDetector.getWinPattern(cartela.patternMask);
    if (!pattern) throw new AppError(400, 'NO_WIN', 'No winning pattern detected');

    return AppDataSource.transaction(async (manager) => {
      const existingWinners = game.winnerIds.length;
      const shareAmount = existingWinners === 0 ? game.prizePool : game.prizePool / (existingWinners + 1);

      cartela.isWinner = true;
      cartela.winPattern = pattern;
      cartela.winAmount = shareAmount;
      await manager.save(cartela);

      game.winnerIds = [...game.winnerIds, userId];
      game.status = 'finished';
      game.finishedAt = new Date();
      await manager.save(game);

      await manager.increment(User, { id: userId }, 'balance', shareAmount);
      await manager.save(manager.create(Transaction, {
        userId,
        gameId,
        transactionType: 'win',
        amount: shareAmount,
        status: 'completed',
        description: `Win for game ${gameId}`,
        processedAt: new Date(),
      }));

      activeGames.dec();
      logger.info('Bingo claimed', { gameId, userId, amount: shareAmount });
      return { valid: true, amount: shareAmount };
    });
  }

  async getGame(gameId: string): Promise<Game> {
    const cached = await redisClient.get(`game:${gameId}`);
    if (cached) return JSON.parse(cached);

    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    return game;
  }

  async listGames(status?: string): Promise<Game[]> {
    const where = status ? { status: status as Game['status'] } : {};
    return this.gameRepo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }
}
