import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

  const { data: txs = [], isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['my-transactions'],
    queryFn: () => offlineUserApi.myTransactions(),
  });

  const { data: games = [], isLoading: gamesLoading } = useQuery<GameHistory[]>({
    queryKey: ['my-games'],
    queryFn: () => offlineGameApi.myGames(),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Balance History</h1>
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm">
          Balance: <span className="font-bold text-green-600">{Number(user?.balance ?? 0).toFixed(2)} Birr</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {([['games', 'Game History'], ['transactions', 'Transactions']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Game History Tab ── */}
      {tab === 'games' && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          {gamesLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : games.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No games played yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['#', 'Bet Birr', 'Total Cartelas', 'Total Bet', 'Win Birr', 'House Profit', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {games.map((g, i) => {
                  const won = g.isWinner;
                  const winBirr = won ? Number(g.totalBets) - Number(g.houseCut) : 0;
                  return (
                    <tr key={g.id} className="hover:bg-gray-50">
                      {/* Game number (newest = #1) */}
                      <td className="px-4 py-3 font-mono text-gray-500 text-xs">{i + 1}</td>

                      {/* Bet per cartela */}
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {Number(g.betAmount).toFixed(2)}
                      </td>

                      {/* Total cartelas in game */}
                      <td className="px-4 py-3 text-gray-700">{g.cartelaCount}</td>

                      {/* Total bets collected */}
                      <td className="px-4 py-3 text-gray-700">{Number(g.totalBets).toFixed(2)}</td>

                      {/* Win birr (prize share if winner, else —) */}
                      <td className="px-4 py-3 font-semibold">
                        {won
                          ? <span className="text-green-600">+{winBirr.toFixed(2)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>

                      {/* House profit */}
                      <td className="px-4 py-3 text-orange-600">{Number(g.houseCut).toFixed(2)}</td>

                      {/* Status + result badge */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${
                            g.status === 'finished'  ? 'bg-gray-200 text-gray-700' :
                            g.status === 'active'    ? 'bg-green-100 text-green-700' :
                            g.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                            'bg-blue-100 text-blue-600'
                          }`}>
                            {g.status === 'finished' ? 'Finished' :
                             g.status === 'active'   ? 'Active'   :
                             g.status === 'cancelled'? 'Cancelled': g.status}
                          </span>
                          {g.status === 'finished' && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${
                              won ? 'bg-yellow-100 text-yellow-700' : 'bg-red-50 text-red-500'
                            }`}>
                              {won ? '🏆 Won' : 'Lost'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Transactions Tab ── */}
      {tab === 'transactions' && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {txLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : txs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No transactions yet.</div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
};
