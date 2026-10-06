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
import { In, MoreThanOrEqual } from 'typeorm';
import { GlobalSequence } from '../domain/GlobalSequence';

export interface CreateGameDTO {
  /** IDs from user_cartelas (not the shared cartelas pool) */
  cartelaIds: string[];
  betAmountPerCartela: number;
  winPattern?: string;
  housePercentage?: number;
  createdAt?: string; // Optional: preserve original offline creation timestamp
}

export interface FinishGameResult {
  game: Game;
  /** Card number of the randomly selected bonus cartela (null if no bonus) */
  bonusCardNumber: number | null;
  /** Bet amount credited as bonus (null if no bonus) */
  bonusAmount: number | null;
}

export class GameService {
  private gameRepo = AppDataSource.getRepository(Game);
  private ucRepo = AppDataSource.getRepository(UserCartela);
  private gcRepo = AppDataSource.getRepository(GameCartela);
  private userRepo = AppDataSource.getRepository(User);
  private gsRepo = AppDataSource.getRepository(GlobalSequence);
  private generator = new CartelaGenerator();
  private winDetector = new WinnerDetection();
  // Per-game mutex: prevents concurrent callNumber executions from producing duplicates
  private callLocks = new Map<string, Promise<unknown>>();

  private shuffleNumbers(): number[] {
    const arr = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Get the sequence for a specific user, creating one if it doesn't exist yet */
  async getGlobalSequence(userId?: string): Promise<GlobalSequence> {
    const key = userId ?? 'singleton';
    let gs = await this.gsRepo.findOne({ where: { id: key } });
    if (!gs || gs.sequence.length !== 75) {
      gs = this.gsRepo.create({ id: key, sequence: this.shuffleNumbers() });
      await this.gsRepo.save(gs);
      logger.info('User sequence initialised', { userId: key });
    }
    return gs;
  }

  /** Regenerate the sequence for a specific user (or global singleton) */
  async regenerateGlobalSequence(userId?: string): Promise<GlobalSequence> {
    const key = userId ?? 'singleton';
    let gs = await this.gsRepo.findOne({ where: { id: key } });
    if (!gs) {
      gs = this.gsRepo.create({ id: key, sequence: this.shuffleNumbers() });
    } else {
      gs.sequence = this.shuffleNumbers();
    }
    await this.gsRepo.save(gs);
    logger.info('User sequence regenerated', { userId: key });
    return gs;
  }

  /**
   * Given a list of user_cartela IDs and a win pattern, simulate the user's
   * pre-generated sequence and return which cartela wins first.
   */
  async detectWinner(cartelaIds: string[], winPattern: string, userId?: string): Promise<{
    sequence: number[];
    generatedAt: Date;
    winner: { cardNumber: number; callsNeeded: number } | null;
    rankings: Array<{ cardNumber: number; callsNeeded: number }>;
  }> {
    // Use the cartela owner's sequence if userId not explicitly provided
    const targetUserId = userId ?? (cartelaIds.length > 0
      ? (await this.ucRepo.findOne({ where: { id: cartelaIds[0] } }))?.userId
      : undefined);

    const gs = await this.getGlobalSequence(targetUserId);
    const cartelas = await this.ucRepo.find({ where: { id: In(cartelaIds) } });
    if (cartelas.length === 0) {
      return { sequence: gs.sequence, generatedAt: gs.generatedAt, winner: null, rankings: [] };
    }

    const rankings: Array<{ cardNumber: number; callsNeeded: number }> = [];

    for (const uc of cartelas) {
      // Skip cartelas that have no numbers (unassigned / incomplete rows)
      if (!uc.numbers || uc.numbers.length !== 25) continue;

      const mask: boolean[] = Array(25).fill(false);
      mask[12] = true; // free space
      let callsNeeded = 75; // worst case — never wins

      for (let i = 0; i < gs.sequence.length; i++) {
        const called = gs.sequence[i];
        for (let j = 0; j < 25; j++) {
          if (j !== 12 && uc.numbers[j] === called) mask[j] = true;
        }
        if (this.winDetector.checkWin(mask, winPattern)) {
          callsNeeded = i + 1;
          break;
        }
      }
      rankings.push({ cardNumber: uc.cardNumber ?? 0, callsNeeded });
    }

    rankings.sort((a, b) => a.callsNeeded - b.callsNeeded);
    return {
      sequence: gs.sequence,
      generatedAt: gs.generatedAt,
      winner: rankings[0] ?? null,
      rankings,
    };
  }

  async createGame(userId: string, dto: CreateGameDTO): Promise<Game> {
    if (!dto.cartelaIds || dto.cartelaIds.length === 0)
      throw new AppError(400, 'NO_CARTELAS', 'Select at least one cartela');
    if (dto.betAmountPerCartela <= 0)
      throw new AppError(400, 'INVALID_BET', 'Invalid bet amount');

    // Validate createdAt if provided (must not be in the future)
    if (dto.createdAt) {
      const providedDate = new Date(dto.createdAt);
      const now = new Date();
      if (isNaN(providedDate.getTime())) {
        throw new AppError(400, 'INVALID_DATE', 'Invalid createdAt timestamp');
      }
      if (providedDate.getTime() > now.getTime()) {
        throw new AppError(400, 'FUTURE_DATE', 'createdAt cannot be in the future');
      }
    }

    // Verify all selected user_cartelas belong to this user
    const [user, ownedUCs, userGameCount] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId }, select: ['id', 'paymentType', 'balance', 'creditLimit', 'cartelaBonusEnabled'] }),
      this.ucRepo.find({ where: dto.cartelaIds.map((id) => ({ id, userId })) }),
      this.gameRepo.count({ where: { creatorId: userId } }),
    ]);

    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (user.status === 'suspended' || user.status === 'banned')
      throw new AppError(403, 'ACCOUNT_BLOCKED', 'Your account is suspended');
    if (ownedUCs.length !== dto.cartelaIds.length)
      throw new AppError(403, 'FORBIDDEN', 'One or more cartelas do not belong to you');

    const totalCost = dto.betAmountPerCartela * dto.cartelaIds.length;
    const HOUSE_PCT = (dto.housePercentage != null && dto.housePercentage >= 10 && dto.housePercentage <= 45)
      ? dto.housePercentage : env.HOUSE_PERCENTAGE;
    const houseCut = Math.ceil(totalCost * (HOUSE_PCT / 100));

    // Both prepaid and postpaid users must have sufficient balance
    if (Number(user.balance) < houseCut)
      throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');

    return AppDataSource.transaction(async (manager) => {
      // Use the user's pre-generated sequence so admin can predict the winner
      const gs = await this.getGlobalSequence(userId);
      const game = manager.create(Game, {
        creatorId: userId,
        gameNumber: userGameCount + 1,
        betAmount: dto.betAmountPerCartela,
        housePercentage: HOUSE_PCT,
        winPattern: dto.winPattern ?? 'any',
        status: 'active',
        calledNumbers: [],
        numberSequence: gs.sequence,
        winnerIds: [],
        cartelaCount: ownedUCs.length,
        totalBets: totalCost,
        prizePool: totalCost - houseCut,
        houseCut,
        ...(dto.createdAt && { createdAt: new Date(dto.createdAt) }),
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

      // Regenerate this user's sequence immediately so the next game has a fresh one
      // and the admin can check the new sequence for the next prediction
      await this.regenerateGlobalSequence(userId);

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
    // Serialize concurrent calls for the same game to prevent duplicate number emission
    const prev = this.callLocks.get(gameId) ?? Promise.resolve();
    let resolveLock!: () => void;
    const lock = new Promise<void>((r) => { resolveLock = r; });
    this.callLocks.set(gameId, prev.then(() => lock));

    await prev;
    try {
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
    } finally {
      resolveLock();
    }
  }

  /**
   * Admin-only: set a target cartela that should win next.
   * Reorders the remaining (uncalled) portion of the sequence so that all
   * numbers the target cartela still needs come first, in a random order,
   * followed by the remaining numbers in their original shuffled order.
   * The already-called portion of the sequence is never touched.
   */
  async setTargetCartela(gameId: string, cartelaId: string | null): Promise<Game> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game must be active');

    // Clearing the target
    if (cartelaId === null) {
      game.targetCartelaId = null;
      await this.gameRepo.save(game);
      try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
      return game;
    }

    const uc = await this.ucRepo.findOne({ where: { id: cartelaId } });
    if (!uc) throw new AppError(404, 'CARTELA_NOT_FOUND', 'Cartela not found');

    // Numbers this cartela still needs (not yet called, free space at index 12 excluded)
    const needed = uc.numbers.filter((n, i) => i !== 12 && !game.calledNumbers.includes(n));

    if (needed.length === 0) {
      // Cartela already has all numbers — just record the target, no reorder needed
      game.targetCartelaId = cartelaId;
      await this.gameRepo.save(game);
      return game;
    }

    // Build new sequence: keep already-called part, then needed numbers first, then the rest
    const nextIndex = game.calledNumbers.length;
    const remaining = game.numberSequence.slice(nextIndex).filter(n => !needed.includes(n));

    // Shuffle the needed numbers so their order isn't predictable
    const shuffledNeeded = [...needed];
    for (let i = shuffledNeeded.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledNeeded[i], shuffledNeeded[j]] = [shuffledNeeded[j], shuffledNeeded[i]];
    }

    game.numberSequence = [
      ...game.numberSequence.slice(0, nextIndex),
      ...shuffledNeeded,
      ...remaining,
    ];
    game.targetCartelaId = cartelaId;

    await this.gameRepo.save(game);
    try { await redisClient.setEx(`game:${gameId}`, 3600, JSON.stringify(game)); } catch {}
    logger.info('Target cartela set', { gameId, cartelaId, neededCount: needed.length });
    return game;
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
      const rawShareAmount = existingWinners === 0 ? game.prizePool : game.prizePool / (existingWinners + 1);
      // Round down to nearest 10 (e.g. 253 → 250)
      const shareAmount = Math.floor(rawShareAmount / 10) * 10;

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

      return { valid: true, amount: shareAmount };
    });
  }

  async finishGame(gameId: string, userId: string): Promise<FinishGameResult> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.creatorId !== userId) throw new AppError(403, 'FORBIDDEN', 'Only creator can finish the game');
    if (game.status === 'finished' || game.status === 'cancelled')
      throw new AppError(400, 'INVALID_STATE', 'Game is already ended');

    // Check if user is eligible for bonus cartela
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'cartelaBonusEnabled'],
    });
    
    logger.info('Finishing game - user bonus check', { userId, cartelaBonusEnabled: user?.cartelaBonusEnabled, betAmount: game.betAmount });

    // Find the cartelas used in this game (to pick bonus from)
    let bonusCardNumber: number | null = null;
    let bonusAmount: number | null = null;

    if (user?.cartelaBonusEnabled && game.betAmount > 0) {
      // Get the cartelas registered in this game for this user
      const gameCartelas = await this.gcRepo.find({
        where: { gameId, userId },
        relations: ['userCartela'],
      });
      const eligible = gameCartelas
        .filter((gc) => gc.userCartela?.cardNumber != null)
        .map((gc) => gc.userCartela!);

      logger.info('Eligible cartelas for bonus', { gameId, eligibleCount: eligible.length });

      if (eligible.length > 0) {
        // Pick one at random from the game's cartelas
        const picked = eligible[Math.floor(Math.random() * eligible.length)];
        bonusCardNumber = picked.cardNumber ?? null;
        bonusAmount = Number(game.betAmount);
        logger.info('Bonus cartela picked', { bonusCardNumber, bonusAmount });
      }
    }

    return AppDataSource.transaction(async (manager) => {
      game.status = 'finished';
      game.finishedAt = new Date();
      await manager.save(game);

      // Credit bonus balance and record transaction
      if (bonusCardNumber != null && bonusAmount != null) {
        await Promise.all([
          manager.increment(User, { id: userId }, 'balance', bonusAmount),
          manager.save(
            manager.create(Transaction, {
              userId,
              gameId,
              transactionType: 'bonus',
              amount: bonusAmount,
              status: 'completed',
              description: `Bonus cartela #${bonusCardNumber} for game ${gameId}`,
              processedAt: new Date(),
            })
          ),
        ]);
        logger.info('Bonus cartela credited on finish', { gameId, userId, bonusCardNumber, bonusAmount });
      }

      try { await redisClient.del(`game:${gameId}`); } catch {}
      activeGames.dec();
      logger.info('Game finished manually', { gameId, userId });
      return { game, bonusCardNumber, bonusAmount };
    });
  }

  async resetGame(gameId: string, userId: string): Promise<void> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (game.status !== 'active') throw new AppError(400, 'INVALID_STATE', 'Game is not active');
    game.calledNumbers = [];
    game.numberSequence = this.shuffleNumbers();
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
    if (user.balance < totalCost)
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
        updatedGame.prizePool = updatedGame.totalBets - Math.ceil(updatedGame.totalBets * (updatedGame.housePercentage / 100));
        updatedGame.houseCut = Math.ceil(updatedGame.totalBets * (updatedGame.housePercentage / 100));
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

    // When filtering by a specific user (admin report), return last 90 days without limit
    if (userId) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      cutoff.setHours(0, 0, 0, 0);
      where.createdAt = MoreThanOrEqual(cutoff);
      return this.gameRepo.find({ where, order: { createdAt: 'DESC' } });
    }

    return this.gameRepo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }

}
