import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { GameService } from '../application/GameService';
import { redisClient } from '../../../config/redis';
import { logger } from '../../../shared/infrastructure/logger';
import { activePlayers } from '../../../shared/infrastructure/metrics';

interface AuthSocket extends Socket {
  user?: { id: string; role: string };
}

const gameService = new GameService();

export const setupGameGateway = (io: Server) => {
  // Auth middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth?.token 
        || socket.handshake.headers?.authorization?.split(' ')[1]
        || (socket.handshake.headers?.cookie?.split(';').find((c: string) => c.trim().startsWith('access_token='))?.split('=')[1]);
      if (!token) return next(new Error('Authentication required'));

      const payload = jwt.verify(token, env.JWT_SECRET) as { id: string; role: string };
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthSocket) => {
    const userId = socket.user!.id;
    logger.info('WS connected', { userId, socketId: socket.id });
    activePlayers.inc();

    // Track online status
    await redisClient.sAdd('online_users', userId);
    await redisClient.hSet(`user:${userId}`, { socket: socket.id, connected_at: Date.now().toString() });

    socket.join(`user:${userId}`);

    // Start game (creator only)
    socket.on('start_game', async (gameId: string) => {
      try {
        const game = await gameService.startGame(gameId, userId);
        io.to(`game:${gameId}`).emit('game_state', game);
      } catch (err: unknown) {
        socket.emit('error', { code: 'START_FAILED', message: err instanceof Error ? err.message : 'Failed to start' });
      }
    });

    // Join game room
    socket.on('join_game', async (gameId: string) => {
      try {
        const game = await gameService.getGame(gameId);
        socket.join(`game:${gameId}`);
        socket.to(`game:${gameId}`).emit('player_joined', { userId, username: socket.user?.id });
        socket.emit('game_state', game);
        logger.info('Player joined game room', { userId, gameId });
      } catch (err: unknown) {
        socket.emit('error', { code: 'JOIN_FAILED', message: err instanceof Error ? err.message : 'Failed to join' });
      }
    });

    // Leave game room
    socket.on('leave_game', (gameId: string) => {
      socket.leave(`game:${gameId}`);
      socket.to(`game:${gameId}`).emit('player_left', { userId });
    });

    // Call number (creator only)
    socket.on('call_number', async (gameId: string) => {
      try {
        const result = await gameService.callNumber(gameId, userId);
        io.to(`game:${gameId}`).emit('number_called', {
          number: result.number,
          remaining: result.remaining,
          calledBy: userId,
          timestamp: new Date(),
        });
      } catch (err: unknown) {
        socket.emit('error', { code: 'CALL_FAILED', message: err instanceof Error ? err.message : 'Failed to call' });
      }
    });

    // Mark number on cartela
    socket.on('mark_number', async ({ cartelaId, number }: { cartelaId: string; number: number }) => {
      try {
        const result = await gameService.markNumber(cartelaId, userId, number);
        socket.emit('number_marked', { cartelaId, number, ...result });

        if (result.isWinner) {
          socket.emit('bingo_possible', { cartelaId, pattern: result.pattern });
        }
      } catch (err: unknown) {
        socket.emit('error', { code: 'MARK_FAILED', message: err instanceof Error ? err.message : 'Failed to mark' });
      }
    });

    // Claim bingo
    socket.on('claim_bingo', async ({ gameId, cartelaId }: { gameId: string; cartelaId: string }) => {
      try {
        const result = await gameService.claimBingo(gameId, cartelaId, userId);
        io.to(`game:${gameId}`).emit('game_finished', {
          gameId,
          winners: [{ userId, cartelaId, amount: result.amount }],
          timestamp: new Date(),
        });
      } catch (err: unknown) {
        socket.emit('error', { code: 'CLAIM_FAILED', message: err instanceof Error ? err.message : 'Invalid claim' });
      }
    });

    socket.on('disconnect', async () => {
      activePlayers.dec();
      await redisClient.sRem('online_users', userId);
      await redisClient.del(`user:${userId}`);
      logger.info('WS disconnected', { userId });
    });
  });
};
