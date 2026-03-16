import React, { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '../services/api';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { CartelaCard } from '../components/CartelaCard';
import { NumberBoard } from '../components/NumberBoard';

export const GamePage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentGame, lastCalledNumber, setGame, addCalledNumber, updateCartela, clearGame } = useGameStore();

  const { data, isLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => gameApi.get(gameId!).then((r) => r.data.data),
    enabled: !!gameId,
  });

  useEffect(() => {
    if (data) setGame(data);
  }, [data, setGame]);

  useEffect(() => {
    if (!gameId) return;
    const socket = getSocket();

    socket.emit('join_game', gameId);

    socket.on('game_state', setGame);
    socket.on('number_called', ({ number }: { number: number }) => addCalledNumber(number));
    socket.on('game_finished', () => {
      setTimeout(() => navigate('/dashboard'), 3000);
    });

    return () => {
      socket.emit('leave_game', gameId);
      socket.off('game_state');
      socket.off('number_called');
      socket.off('game_finished');
      clearGame();
    };
  }, [gameId, setGame, addCalledNumber, clearGame, navigate]);

  const handleCallNumber = useCallback(async () => {
    if (!gameId) return;
    try {
      await gameApi.callNumber(gameId);
    } catch (err) {
      console.error('Failed to call number', err);
    }
  }, [gameId]);

  const handleMarkNumber = useCallback(async (cartelaId: string, number: number) => {
    try {
      const res = await gameApi.markNumber(cartelaId, number);
      const { isWinner } = res.data.data;
      if (isWinner) {
        // Update local mask
        const cartela = currentGame?.cartelas.find((c) => c.id === cartelaId);
        if (cartela) {
          const newMask = [...cartela.patternMask];
          const idx = cartela.numbers.indexOf(number);
          if (idx !== -1) newMask[idx] = true;
          updateCartela(cartelaId, newMask);
        }
      }
    } catch (err) {
      console.error('Failed to mark number', err);
    }
  }, [currentGame, updateCartela]);

  const handleClaimBingo = useCallback(async (cartelaId: string) => {
    if (!gameId) return;
    try {
      await gameApi.claimBingo(gameId, cartelaId);
    } catch (err) {
      console.error('Failed to claim bingo', err);
    }
  }, [gameId]);

  const handleStartGame = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await gameApi.start(gameId);
      setGame(res.data.data);
    } catch (err) {
      console.error('Failed to start game', err);
    }
  }, [gameId, setGame]);

  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading game...</div>;
  if (!currentGame) return <div className="flex items-center justify-center h-screen">Game not found</div>;

  const isCreator = currentGame.creatorId === user?.id;
  const myCartelas = currentGame.cartelas.filter((c) => (c as unknown as { userId: string }).userId === user?.id);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {/* Screen reader announcer */}
      <div id="game-announcer" className="sr-only" role="status" aria-live="polite" />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Game #{currentGame.id.slice(0, 8)}</h1>
            <span
              data-testid="game-status"
              className={`text-sm px-2 py-0.5 rounded-full ${
                currentGame.status === 'active' ? 'bg-green-100 text-green-700' :
                currentGame.status === 'finished' ? 'bg-gray-100 text-gray-600' :
                'bg-yellow-100 text-yellow-700'
              }`}
            >
              {currentGame.status.charAt(0).toUpperCase() + currentGame.status.slice(1)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">Prize Pool</div>
            <div className="text-2xl font-bold text-green-600">${Number(currentGame.prizePool).toFixed(2)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Number board */}
          <div className="lg:col-span-1">
            <NumberBoard calledNumbers={currentGame.calledNumbers} lastNumber={lastCalledNumber} />

            {/* Controls */}
            {isCreator && (
              <div className="mt-4 space-y-2">
                {currentGame.status === 'pending' && (
                  <button
                    data-testid="start-game-btn"
                    onClick={handleStartGame}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                  >
                    Start Game
                  </button>
                )}
                {currentGame.status === 'active' && (
                  <button
                    data-testid="call-number-btn"
                    onClick={handleCallNumber}
                    className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors"
                  >
                    Call Number
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Cartelas */}
          <div className="lg:col-span-2">
            <h2 className="font-semibold mb-3">Your Cartelas</h2>
            {myCartelas.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No cartelas yet</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {myCartelas.map((cartela) => (
                  <div key={cartela.id}>
                    <CartelaCard
                      cartela={cartela}
                      calledNumbers={currentGame.calledNumbers}
                      onMark={handleMarkNumber}
                      disabled={currentGame.status !== 'active'}
                    />
                    {cartela.isWinner && (
                      <button
                        onClick={() => handleClaimBingo(cartela.id)}
                        className="mt-2 w-full bg-yellow-500 text-white py-2 rounded-lg font-bold hover:bg-yellow-600"
                      >
                        Claim BINGO!
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
