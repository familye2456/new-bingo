import { AppDataSource } from '../../../config/database';
import { Game } from '../domain/Game';
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
import { MoreThanOrEqual } from 'typeorm';

export interface CreateGameDTO {
  /** IDs from user_cartelas (not the shared cartelas pool) */
  cartelaIds: string[];
  betAmountPerCartela: number;
  winPattern?: string;
  housePercentage?: number;
}

export class GameService {
  private gameRepo = AppDataSource.getRepository(Game);
  private ucRepo = AppDataSource.getRepository(UserCartela);
  private gcRepo = AppDataSource.getRepository(GameCartela);
  private userRepo = AppDataSource.getRepository(User);
  private generator = new CartelaGenerator();
  private winDetector = new WinnerDetection();

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

    // Verify all selected user_cartelas belong to this user
    const [user, ownedUCs, userGameCount] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId }, select: ['id', 'paymentType', 'balance', 'creditLimit'] }),
      this.ucRepo.find({ where: dto.cartelaIds.map((id) => ({ id, userId })) }),
      this.gameRepo.count({ where: { creatorId: userId } }),
    ]);

    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (ownedUCs.length !== dto.cartelaIds.length)
      throw new AppError(403, 'FORBIDDEN', 'One or more cartelas do not belong to you');

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
        cartelaCount: ownedUCs.length,
        totalBets: totalCost,
        prizePool: totalCost - houseCut,
        houseCut,
      });

      const [savedGame] = await Promise.all([
        manager.save(game),
        manager.decrement(User, { id: userId }, 'balance', houseCut),
      ]);

      await Promise.all([
        manager.save(
          dto.cartelaIds.map((ucId) =>
            manager.create(GameCartela, {
              gameId: savedGame.id,
              userCartelaId: ucId,
              userId,
              betAmount: dto.betAmountPerCartela,
            })
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

    // Find user_cartela by card number linked to this game
    const gc = await this.gcRepo
      .createQueryBuilder('gc')
      .innerJoin('gc.userCartela', 'uc')
      .where('gc.gameId = :gameId', { gameId })
      .andWhere('uc.cardNumber = :cardNumber', { cardNumber })
      .select(['gc.userCartelaId', 'gc.userId'])
      .getRawOne();

    if (!gc) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    const uc = await this.ucRepo.findOne({ where: { id: gc.gc_user_cartela_id } });
    if (!uc) return { registered: false, cardNumber, isWinner: false, winPattern: null };

    const mask = uc.numbers.map((n, i) =>
      i === 12 ? true : game.calledNumbers.includes(n)
    );

    const winPattern = this.winDetector.getWinPattern(mask);
    const isWinner = this.winDetector.checkWin(mask, game.winPattern);

    return { registered: true, cardNumber, numbers: uc.numbers, patternMask: mask, isWinner, winPattern };
  }

  async callNumber(gameId: string, userId: string): Promise<{ number: number; remaining: number }> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can call numbers');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');

    const nextIndex = game.calledNumbers.length;
    if (nextIndex >= 75) throw new AppError(400, 'NO_NUMBERS_LEFT', 'All numbers have been called');

    const sequence = game.numberSequence?.length === 75 ? game.numberSequence : this.shuffleNumbers();
    const number = sequence[nextIndex];
    game.calledNumbers = [...game.calledNumbers, number];
    if (game.numberSequence?.length !== 75) game.numberSequence = sequence;
    await this.gameRepo.save(game);

    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
    return { number, remaining: 75 - game.calledNumbers.length };
  }

  async markNumber(userCartelaId: string, userId: string, number: number): Promise<{ isWinner: boolean; pattern: string | null }> {
    const uc = await this.ucRepo.findOne({ where: { id: userCartelaId, userId } });
    if (!uc) throw new AppError(404, 'CARTELA_NOT_FOUND', 'Cartela not found or not yours');

    const idx = uc.numbers.indexOf(number);
    if (idx !== -1) uc.patternMask[idx] = true;

    const pattern = this.winDetector.getWinPattern(uc.patternMask);
    if (pattern) { uc.isWinner = true; uc.winPattern = pattern; }

    await this.ucRepo.save(uc);
    return { isWinner: !!pattern, pattern };
  }

  async claimBingo(gameId: string, userCartelaId: string, userId: string): Promise<{ valid: boolean; amount: number }> {
    const uc = await this.ucRepo.findOne({ where: { id: userCartelaId, userId } });
    if (!uc) throw new AppError(404, 'CARTELA_NOT_FOUND', 'Cartela not found');

    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game || game.status !== 'active') throw new AppError(400, 'INVALID_CLAIM', 'Invalid game state');

    const pattern = this.winDetector.getWinPattern(uc.patternMask);
    if (!pattern) throw new AppError(400, 'NO_WIN', 'No winning pattern detected');

    return AppDataSource.transaction(async (manager) => {
      const existingWinners = game.winnerIds.length;
      const shareAmount = existingWinners === 0 ? game.prizePool : game.prizePool / (existingWinners + 1);

      uc.isWinner = true;
      uc.winPattern = pattern;
      uc.winAmount = shareAmount;
      await manager.save(uc);

      game.winnerIds = [...game.winnerIds, userId];
      game.status = 'finished';
      game.finishedAt = new Date();
      await manager.save(game);

      await manager.increment(User, { id: userId }, 'balance', shareAmount);
      await manager.save(manager.create(Transaction, {
        userId, gameId, transactionType: 'win',
        amount: shareAmount, status: 'completed',
        description: `Win for game ${gameId}`,
        processedAt: new Date(),
      }));

      activeGames.dec();
      logger.info('Bingo claimed', { gameId, userId, amount: shareAmount });
      this.applyDailyBonusIfEligible(game.creatorId).catch(() => {});

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
    await this.applyDailyBonusIfEligible(userId);
    return game;
  }

  async resetGame(gameId: string, userId: string): Promise<void> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can reset the game');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');
    game.calledNumbers = [];
    await this.gameRepo.save(game);
    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
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

  async joinGame(gameId: string, userId: string, cartelaCount: number): Promise<UserCartela[]> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game || game.status !== 'pending') throw new AppError(400, 'GAME_NOT_JOINABLE', 'Game is not joinable');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const totalCost = game.betAmount * cartelaCount;
    if (user.paymentType !== 'postpaid' && user.balance < totalCost)
      throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');

    return AppDataSource.transaction(async (manager) => {
      const ucs: UserCartela[] = [];
      for (let i = 0; i < cartelaCount; i++) {
        const patternMask = Array(25).fill(false);
        patternMask[12] = true;
        const uc = manager.create(UserCartela, {
          userId,
          numbers: this.generator.generate(),
          patternMask,
          isActive: true,
          isWinner: false,
        });
        const savedUc = await manager.save(uc);
        await manager.save(manager.create(GameCartela, {
          gameId, userCartelaId: savedUc.id, userId, betAmount: game.betAmount,
        }));
        ucs.push(savedUc);
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
        userId, gameId, transactionType: 'bet',
        amount: totalCost, status: 'completed',
        description: `Joined game ${gameId}`, processedAt: new Date(),
      }));

      return ucs;
    });
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

  async listGames(status?: string, userId?: string, date?: string): Promise<Game[]> {
    const where: any = {};
    if (status) where.status = status as Game['status'];
    if (userId) where.creatorId = userId;

    // When filtering by date, skip the take limit so all matching games are returned
    if (date === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      where.createdAt = MoreThanOrEqual(todayStart);
      return this.gameRepo.find({ where, order: { createdAt: 'DESC' } });
    }

    return this.gameRepo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }

  private async applyDailyBonusIfEligible(userId: string): Promise<void> {
    try {
      const BONUS_THRESHOLD = 1000;
      const BONUS_AMOUNT = 200;
      const txRepo = AppDataSource.getRepository(Transaction);
      const gameRepo = AppDataSource.getRepository(Game);
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const alreadyBonused = await txRepo.createQueryBuilder('t')
        .where('t.userId = :userId', { userId })
        .andWhere('t.transactionType = :type', { type: 'bonus' })
        .andWhere('t.createdAt >= :todayStart', { todayStart })
        .getOne();
      if (alreadyBonused) return;

      const result = await gameRepo.createQueryBuilder('g')
        .select('SUM(g.houseCut)', 'total')
        .where('g.creatorId = :userId', { userId })
        .andWhere('g.status = :status', { status: 'finished' })
        .andWhere('(g.finishedAt >= :todayStart OR g.createdAt >= :todayStart)', { todayStart })
        .getRawOne();

      const dailyHouseCut = parseFloat(result?.total ?? '0') || 0;
      if (dailyHouseCut < BONUS_THRESHOLD) return;

      await this.userRepo.increment({ id: userId }, 'balance', BONUS_AMOUNT);
      await txRepo.save(txRepo.create({
        userId, transactionType: 'bonus', amount: BONUS_AMOUNT, status: 'completed',
        description: `Daily bonus: reached ${BONUS_THRESHOLD} Birr house profit (${user.paymentType})`,
        processedAt: new Date(),
      }));
      logger.info('Daily bonus applied', { userId, dailyHouseCut, bonus: BONUS_AMOUNT });
    } catch (err) {
      logger.warn('Daily bonus check failed', { userId, err });
    }
  }
}
