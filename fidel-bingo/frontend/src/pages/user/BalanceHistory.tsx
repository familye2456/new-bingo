import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineUserApi, offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  status: string;
  description?: string;
  createdAt: string;
}

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
}

const typeStyle: Record<string, string> = {
  deposit:    'bg-green-100 text-green-700',
  win:        'bg-yellow-100 text-yellow-700',
  bet:        'bg-red-100 text-red-600',
  withdrawal: 'bg-orange-100 text-orange-700',
  refund:     'bg-blue-100 text-blue-700',
  house_cut:  'bg-gray-100 text-gray-500',
};
const typeSign: Record<string, string> = {
  deposit: '+', win: '+', refund: '+',
  bet: '-', withdrawal: '-', house_cut: '-',
};
const fmt = (d: string) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const BalanceHistory: React.FC = () => {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'transactions' | 'games'>('games');
  const qc = useQueryClient();

  const { data: txs = [], isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['my-transactions'],
    queryFn: () => offlineUserApi.myTransactions(),
  });

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

  return (
    <div className="h-full overflow-auto p-3 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-lg sm:text-xl font-semibold">Balance History</h1>
        <div className="flex flex-wrap items-center gap-2">
          {activeGames.length > 0 && (
            <button
              onClick={() => finishAllMutation.mutate()}
              disabled={finishAllMutation.isLoading}
              className="bg-red-500 hover:bg-red-600 text-white text-xs sm:text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
            >
              {finishAllMutation.isLoading ? 'Finishing...' : `Finish All (${activeGames.length})`}
            </button>
          )}
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-1.5 text-xs sm:text-sm">
            Balance: <span className="font-bold text-green-600">{Number(user?.balance ?? 0).toFixed(2)} Birr</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {([['games', 'Game History'], ['transactions', 'Transactions']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Game History ── */}
      {tab === 'games' && (
        <>
          {gamesLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : games.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No games played yet.</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block bg-white rounded-xl shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {['#', 'Date', 'Bet', 'Cartelas', 'Total Bet', 'Win', 'House', 'Status'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium text-xs whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...games].sort((a, b) => (b.gameNumber ?? 0) - (a.gameNumber ?? 0)).map((g, i) => {
                      const won = g.isWinner;
                      const winBirr = won ? Number(g.totalBets) - Number(g.houseCut) : 0;
                      return (
                        <tr key={g.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-gray-500 text-xs">#{g.gameNumber ?? (i + 1)}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(g.createdAt)}</td>
                          <td className="px-4 py-3 font-semibold text-gray-800">{Number(g.betAmount).toFixed(2)}</td>
                          <td className="px-4 py-3 text-gray-700">{g.cartelaCount}</td>
                          <td className="px-4 py-3 text-gray-700">{Number(g.totalBets).toFixed(2)}</td>
                          <td className="px-4 py-3 font-semibold">
                            {won ? <span className="text-green-600">+{winBirr.toFixed(2)}</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-orange-600">{Number(g.houseCut).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              g.status === 'finished' ? 'bg-gray-200 text-gray-700' :
                              g.status === 'active'   ? 'bg-green-100 text-green-700' :
                              'bg-red-100 text-red-600'
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
                {[...games].sort((a, b) => (b.gameNumber ?? 0) - (a.gameNumber ?? 0)).map((g, i) => {
                  const won = g.isWinner;
                  const winBirr = won ? Number(g.totalBets) - Number(g.houseCut) : 0;
                  return (
                    <div key={g.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-gray-500 text-xs">#{g.gameNumber ?? (i + 1)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          g.status === 'finished' ? 'bg-gray-200 text-gray-700' :
                          g.status === 'active'   ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {g.status === 'finished' ? 'Finished' : g.status === 'active' ? 'Active' : g.status}
                        </span>
                      </div>
                      <div className="text-gray-400 text-xs mb-2">{fmt(g.createdAt)}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><span className="text-gray-400">Bet</span><div className="font-semibold">{Number(g.betAmount).toFixed(2)}</div></div>
                        <div><span className="text-gray-400">Cartelas</span><div className="font-semibold">{g.cartelaCount}</div></div>
                        <div><span className="text-gray-400">House</span><div className="font-semibold text-orange-600">{Number(g.houseCut).toFixed(2)}</div></div>
                      </div>
                      {g.status === 'finished' && (
                        <div className="mt-2 text-xs font-semibold">
                          {won ? <span className="text-green-600">🏆 Won +{winBirr.toFixed(2)}</span> : <span className="text-red-400">Lost</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Transactions ── */}
      {tab === 'transactions' && (
        <>
          {txLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : txs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No transactions yet.</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {['Type', 'Amount', 'Status', 'Description', 'Date'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {txs.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${typeStyle[tx.transactionType] ?? 'bg-gray-100 text-gray-500'}`}>
                            {tx.transactionType.replace('_', ' ')}
                          </span>
                        </td>
                        <td className={`px-4 py-3 font-semibold ${(typeSign[tx.transactionType] ?? '+') === '+' ? 'text-green-600' : 'text-red-500'}`}>
                          {typeSign[tx.transactionType] ?? '+'}{Number(tx.amount).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            tx.status === 'completed' ? 'bg-green-100 text-green-700' :
                            tx.status === 'pending'   ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-600'
                          }`}>{tx.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{tx.description ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{fmt(tx.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="sm:hidden space-y-2">
                {txs.map((tx) => (
                  <div key={tx.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${typeStyle[tx.transactionType] ?? 'bg-gray-100 text-gray-500'}`}>
                        {tx.transactionType.replace('_', ' ')}
                      </span>
                      <span className={`font-bold text-sm ${(typeSign[tx.transactionType] ?? '+') === '+' ? 'text-green-600' : 'text-red-500'}`}>
                        {typeSign[tx.transactionType] ?? '+'}{Number(tx.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-gray-400 text-xs">{tx.description ?? '—'}</div>
                    <div className="text-gray-400 text-xs mt-1">{fmt(tx.createdAt)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
