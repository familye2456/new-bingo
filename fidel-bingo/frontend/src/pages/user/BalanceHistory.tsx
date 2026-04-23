import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface GameHistory {
  id: string;
  gameNumber?: number;
  status: string;
  betAmount: number;
  myBet: number;
  totalBets: number;
  prizePool: number;
  houseCut: number;
  cartelaCount: number;
  winPattern: string;
  isWinner: boolean;
  winnerIds: string[];
  createdAt: string;
  createdByUsername?: string | null;
}

const fmt = (d: string) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const BalanceHistory: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const { data: games = [], isLoading: gamesLoading } = useQuery<GameHistory[]>({
    queryKey: ['my-games'],
    queryFn: () => offlineGameApi.myGames(),
  });

  const activeGames = games.filter(g => g.status === 'active');

  const finishAllMutation = useMutation({
    mutationFn: async () => {
      for (const g of activeGames) await offlineGameApi.finish(g.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-games'] }),
  });

  const sorted = [...games].sort((a, b) => (b.gameNumber ?? 0) - (a.gameNumber ?? 0));

  return (
    <div className="h-full overflow-auto p-3 sm:p-6 w-full" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h1 className="text-lg sm:text-xl font-bold text-white">Balance History</h1>
        <div className="flex flex-wrap items-center gap-2">
          {activeGames.length > 0 && (
            <button
              onClick={() => finishAllMutation.mutate()}
              disabled={finishAllMutation.isLoading}
              className="bg-red-500 hover:bg-red-600 text-white text-xs sm:text-sm font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {finishAllMutation.isLoading ? 'Finishing...' : `Finish All (${activeGames.length})`}
            </button>
          )}
          <div className="bg-green-500 text-white rounded-lg px-4 py-1.5 text-sm font-semibold">
            {Number(user?.balance ?? 0).toFixed(2)} Birr
          </div>
        </div>
      </div>

      {/* Game History */}
      {gamesLoading ? (
        <div className="text-center py-10 text-slate-400">Loading...</div>
      ) : games.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">No games played yet.</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block rounded-xl overflow-hidden border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  {['#', 'Date', 'Created By', 'Bet', 'Cartelas', 'Total Bet', 'Win', 'House', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => {
                  const won = g.isWinner;
                  const winBirr = won ? Number(g.totalBets) - Number(g.houseCut) : 0;
                  return (
                    <tr key={g.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-400 text-xs">#{g.gameNumber ?? (i + 1)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmt(g.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{g.createdByUsername ?? '—'}</td>
                      <td className="px-4 py-3 font-semibold text-white">{Number(g.betAmount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-300">{g.cartelaCount}</td>
                      <td className="px-4 py-3 text-slate-300">{Number(g.totalBets).toFixed(2)}</td>
                      <td className="px-4 py-3 font-semibold">
                        {won
                          ? <span className="text-green-400">+{winBirr.toFixed(2)}</span>
                          : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-3 text-orange-400">{Number(g.houseCut).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                          g.status === 'finished' ? 'bg-slate-600 text-slate-200' :
                          g.status === 'active'   ? 'bg-green-500/20 text-green-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {g.status === 'finished' ? 'Finished' : g.status === 'active' ? 'Active' : g.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="sm:hidden space-y-2">
            {sorted.map((g, i) => {
              const won = g.isWinner;
              const winBirr = won ? Number(g.totalBets) - Number(g.houseCut) : 0;
              return (
                <div key={g.id} className="rounded-xl p-3 border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-slate-400 text-xs">#{g.gameNumber ?? (i + 1)}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                      g.status === 'finished' ? 'bg-slate-600 text-slate-200' :
                      g.status === 'active'   ? 'bg-green-500/20 text-green-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {g.status === 'finished' ? 'Finished' : g.status === 'active' ? 'Active' : g.status}
                    </span>
                  </div>
                  <div className="text-slate-400 text-xs mb-2">{fmt(g.createdAt)}</div>
                  {g.createdByUsername && (
                    <div className="text-slate-400 text-xs mb-2">By: <span className="text-slate-200 font-medium">{g.createdByUsername}</span></div>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-slate-500">Bet</span><div className="font-semibold text-white">{Number(g.betAmount).toFixed(2)}</div></div>
                    <div><span className="text-slate-500">Cartelas</span><div className="font-semibold text-slate-200">{g.cartelaCount}</div></div>
                    <div><span className="text-slate-500">House</span><div className="font-semibold text-orange-400">{Number(g.houseCut).toFixed(2)}</div></div>
                  </div>
                  {g.status === 'finished' && (
                    <div className="mt-2 text-xs font-semibold">
                      {won ? <span className="text-green-400">🏆 Won +{winBirr.toFixed(2)}</span> : <span className="text-red-400">Lost</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
