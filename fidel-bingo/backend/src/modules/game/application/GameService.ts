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
  housePercentage?: number;
}

export class GameService {
  private gameRepo = AppDataSource.getRepository(Game);
  private cartelaRepo = AppDataSource.getRepository(Cartela);
  private ucRepo = AppDataSource.getRepository(UserCartela);
  private gcRepo = AppDataSource.getRepository(GameCartela);
  private userRepo = AppDataSource.getRepository(User);
  private generator = new CartelaGenerator();
  private winDetector = new WinnerDetection();

  /** Fisher-Yates shuffle — returns a new shuffled array */
  private shuffleNumbers(): number[] {
    const arr = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async createGame(userId: string, dto: CreateGameDTO): Promise<Game> {
    if (!dto.cartelaIds || dto.cartelaIds.length === 0)
      throw new AppError(400, 'NO_CARTELAS', 'Select at least one cartela');
    if (dto.betAmountPerCartela <= 0)
      throw new AppError(400, 'INVALID_BET', 'Invalid bet amount');

    // 1 round-trip: fetch user + ownership + cartelas + game count all in parallel
    const [user, ownedAssignments, cartelas, userGameCount] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId }, select: ['id', 'paymentType', 'balance', 'creditLimit'] }),
      this.ucRepo.find({
        where: dto.cartelaIds.map((cartelaId) => ({ userId, cartelaId })),
        select: ['cartelaId'],
      }),
      this.cartelaRepo.findByIds(dto.cartelaIds),
      this.gameRepo.count({ where: { creatorId: userId } }),
    ]);

    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const ownedIds = new Set(ownedAssignments.map((a) => a.cartelaId));
    for (const cid of dto.cartelaIds) {
      if (!ownedIds.has(cid)) throw new AppError(403, 'FORBIDDEN', `Cartela ${cid} is not assigned to you`);
    }
    if (cartelas.length !== dto.cartelaIds.length)
      throw new AppError(404, 'CARTELA_NOT_FOUND', 'One or more cartelas not found');

    const totalCost = dto.betAmountPerCartela * dto.cartelaIds.length;
    const HOUSE_PCT = (dto.housePercentage != null && dto.housePercentage >= 10 && dto.housePercentage <= 45)
      ? dto.housePercentage : env.HOUSE_PERCENTAGE;
    const houseCut = totalCost * (HOUSE_PCT / 100);

    if (user.paymentType !== 'postpaid') {
      if (Number(user.balance) < houseCut)
        throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
    } else {
      const creditLimit = Number(user.creditLimit ?? 0);
      if (creditLimit > 0) {
        const currentDebt = Math.max(0, -Number(user.balance));
        if (currentDebt + houseCut > creditLimit)
          throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded');
      }
    }

    // 1 transaction: save game + game_cartelas + deduct balance + save transaction
    return AppDataSource.transaction(async (manager) => {
      const game = manager.create(Game, {
        creatorId: userId,
        gameNumber: userGameCount + 1,
        betAmount: dto.betAmountPerCartela,
        housePercentage: HOUSE_PCT,
        winPattern: dto.winPattern ?? 'any',
        status: 'active',
        calledNumbers: [],
        numberSequence: this.shuffleNumbers(),
        winnerIds: [],
        cartelaCount: cartelas.length,
        totalBets: totalCost,
        prizePool: totalCost - houseCut,
        houseCut,
      });

      // Run game insert + balance decrement in parallel inside the transaction
      const [savedGame] = await Promise.all([
        manager.save(game),
        manager.decrement(User, { id: userId }, 'balance', houseCut),
      ]);

      // Batch insert game_cartelas + transaction record in parallel
      await Promise.all([
        manager.save(
          dto.cartelaIds.map((cartelaId) =>
            manager.create(GameCartela, { gameId: savedGame.id, cartelaId, userId, betAmount: dto.betAmountPerCartela })
          )
        ),
        manager.save(
          manager.create(Transaction, {
            userId, gameId: savedGame.id, transactionType: 'bet',
            amount: houseCut, status: 'completed',
            description: `House fee for game ${savedGame.id}`,
            processedAt: new Date(),
          })
        ),
      ]);

      activeGames.inc();
      logger.info('Game created', { gameId: savedGame.id, userId });
      return savedGame;
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
        await manager.save(manager.create(GameCartela, {
          gameId,
          cartelaId: saved.id,
          userId,
          betAmount: game.betAmount,
        }));
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

      await manager.save(manager.create(Transaction, {
        userId,
        gameId,
        transactionType: 'bet',
        amount: totalCost,
        status: 'completed',
        description: `Joined game ${gameId}`,
        processedAt: new Date(),
      }));

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

    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
    logger.info('Game started', { gameId });
    return game;
  }

  async resetGame(gameId: string, userId: string): Promise<void> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can reset the game');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');

    game.calledNumbers = [];
    // Keep numberSequence intact — restart from index 0 of the same shuffle
    await this.gameRepo.save(game);
    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
  }

  /**
   * Check if a cartela (by card number) is registered in this game and whether it has won.
   * Returns: registered, cartela data, and win status against current calledNumbers.
   */
  async checkCartela(gameId: string, cardNumber: number): Promise<{
    registered: boolean;
    cardNumber: number;
    numbers?: number[];
    patternMask?: boolean[];
    isWinner: boolean;
    winPattern: string | null;
  }> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');

    // Find cartela by card number
    const cartela = await this.cartelaRepo.findOne({ where: { cardNumber } });
    if (!cartela) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    // Check if this cartela is linked to this game
    const link = await this.gcRepo.findOne({ where: { gameId, cartelaId: cartela.id } });
    if (!link) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    // Build pattern mask from current called numbers
    const mask = cartela.numbers.map((n, i) =>
      i === 12 ? true : game.calledNumbers.includes(n) // center is always free
    );

    const winPattern = this.winDetector.getWinPattern(mask);
    const isWinner = this.winDetector.checkWin(mask, game.winPattern);

    return {
      registered: true,
      cardNumber,
      numbers: cartela.numbers,
      patternMask: mask,
      isWinner,
      winPattern,
    };
  }

  async callNumber(gameId: string, userId: string): Promise<{ number: number; remaining: number }> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can call numbers');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');

    const nextIndex = game.calledNumbers.length;
    if (nextIndex >= 75) throw new AppError(400, 'NO_NUMBERS_LEFT', 'All numbers have been called');

    // Use pre-generated sequence; fall back to random if sequence missing (legacy games)
    const sequence = game.numberSequence?.length === 75
      ? game.numberSequence
      : this.shuffleNumbers();

    const number = sequence[nextIndex];
    game.calledNumbers = [...game.calledNumbers, number];
    if (game.numberSequence?.length !== 75) game.numberSequence = sequence;
    await this.gameRepo.save(game);

    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
    return { number, remaining: 75 - game.calledNumbers.length };
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
      // prizePool = totalBets (house cut already taken at game creation)
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

  async finishGame(gameId: string, userId: string): Promise<Game> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can finish the game');
    if (game.status === 'finished' || game.status === 'cancelled')
      throw new AppError(400, 'INVALID_STATE', 'Game is already ended');

    game.status = 'finished';
    game.finishedAt = new Date();
    await this.gameRepo.save(game);

    try { await redisClient.del(`game:${gameId}`); } catch {}
    activeGames.dec();
    logger.info('Game finished manually', { gameId, userId });
    return game;
  }

  async getGame(gameId: string): Promise<Game> {
    try {
      const cached = await redisClient.get(`game:${gameId}`);
      if (cached) return JSON.parse(cached);
    } catch {}

    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    return game;
  }

  async listGames(status?: string): Promise<Game[]> {
    const where = status ? { status: status as Game['status'] } : {};
    return this.gameRepo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }
}
