import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gameApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();

  const [betAmount, setBetAmount] = useState('1.50');
  const [cartelaCount, setCartelaCount] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data: games, isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => gameApi.list().then((r) => r.data.data),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: () => gameApi.create({ betAmountPerCartela: parseFloat(betAmount), cartelaIds: [] }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      navigate(`/game/${res.data.data.id}`);
    },
  });

  const joinMutation = useMutation({
    mutationFn: ({ gameId }: { gameId: string }) => gameApi.join(gameId, 1),
    onSuccess: (_res, { gameId }) => navigate(`/game/${gameId}`),
  });

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Nav */}
      <nav className="bg-white shadow px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-blue-600">Fidel Bingo</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            Balance: <strong className="text-green-600">${Number(user?.balance ?? 0).toFixed(2)}</strong>
          </span>
          <span className="text-sm text-gray-700">{user?.username}</span>
          <button onClick={logout} className="text-sm text-red-500 hover:underline">Logout</button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto p-6">
        {/* Create game */}
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Create New Game</h2>
            <button
              data-testid="create-game-btn"
              onClick={() => setShowCreate(!showCreate)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {showCreate ? 'Cancel' : '+ New Game'}
            </button>
          </div>

          {showCreate && (
            <div className="flex gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="bet-amount">Bet Amount ($)</label>
                <input
                  id="bet-amount"
                  data-testid="bet-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-32"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="cartela-count">Cartelas</label>
                <select
                  id="cartela-count"
                  data-testid="cartela-count"
                  value={cartelaCount}
                  onChange={(e) => setCartelaCount(parseInt(e.target.value))}
                  className="border rounded-lg px-3 py-2"
                >
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button
                data-testid="submit-game"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          )}
        </div>

        {/* Games list */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Available Games</h2>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading games...</div>
          ) : games?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No games available. Create one!</div>
          ) : (
            <div className="space-y-3">
              {games?.map((game: { id: string; status: string; betAmount: number; prizePool: number; cartelaCount: number; creatorId: string }) => (
                <div key={game.id} className="border rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">Game #{game.id.slice(0, 8)}</div>
                    <div className="text-sm text-gray-500">
                      Bet: ${Number(game.betAmount).toFixed(2)} · Pool: ${Number(game.prizePool).toFixed(2)} · {game.cartelaCount} cartelas
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      game.status === 'active' ? 'bg-green-100 text-green-700' :
                      game.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {game.status}
                    </span>
                    {game.creatorId === user?.id ? (
                      <button
                        onClick={() => navigate(`/game/${game.id}`)}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700"
                      >
                        Open
                      </button>
                    ) : game.status === 'pending' ? (
                      <button
                        onClick={() => joinMutation.mutate({ gameId: game.id })}
                        disabled={joinMutation.isPending}
                        className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        Join
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/game/${game.id}`)}
                        className="bg-gray-200 text-gray-700 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-300"
                      >
                        Watch
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
