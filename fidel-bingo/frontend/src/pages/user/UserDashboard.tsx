import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface PeriodStats {
  totalBet: number;
  totalWin: number;
  profit: number;
  games: number;
}

function calcStats(txs: Transaction[], days: number): PeriodStats {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const filtered = txs.filter(
    (t) => t.status === 'completed' && new Date(t.createdAt) >= cutoff
  );

  const totalBet = filtered
    .filter((t) => t.transactionType === 'bet')
    .reduce((s, t) => s + Number(t.amount), 0);

  const totalWin = filtered
    .filter((t) => t.transactionType === 'win')
    .reduce((s, t) => s + Number(t.amount), 0);

  const games = filtered.filter((t) => t.transactionType === 'bet').length;

  return { totalBet, totalWin, profit: totalWin - totalBet, games };
}

const StatCard: React.FC<{
  label: string;
  bet: number;
  win: number;
  profit: number;
  games: number;
}> = ({ label, bet, win, profit, games }) => (
  <div className="bg-white rounded-2xl shadow p-5 flex flex-col gap-4">
    <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-red-50 rounded-xl p-3">
        <div className="text-xs text-red-400 mb-1">Total Bet</div>
        <div className="text-xl font-bold text-red-600">${bet.toFixed(2)}</div>
      </div>
      <div className="bg-green-50 rounded-xl p-3">
        <div className="text-xs text-green-400 mb-1">Total Win</div>
        <div className="text-xl font-bold text-green-600">${win.toFixed(2)}</div>
      </div>
      <div className={`rounded-xl p-3 col-span-2 ${profit >= 0 ? 'bg-yellow-50' : 'bg-orange-50'}`}>
        <div className={`text-xs mb-1 ${profit >= 0 ? 'text-yellow-500' : 'text-orange-400'}`}>
          Net Profit / Loss
        </div>
        <div className={`text-2xl font-bold ${profit >= 0 ? 'text-yellow-600' : 'text-orange-600'}`}>
          {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
        </div>
      </div>
    </div>
    <div className="text-xs text-gray-400 text-right">{games} game{games !== 1 ? 's' : ''} played</div>
  </div>
);

export const UserDashboard: React.FC = () => {
  const { user } = useAuthStore();

  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['my-transactions'],
    queryFn: () => userApi.myTransactions().then((r) => r.data.data),
  });

  const daily   = calcStats(txs, 1);
  const weekly  = calcStats(txs, 7);
  const fifteen = calcStats(txs, 15);

  const periods = [
    { label: 'Today',    ...daily },
    { label: 'This Week', ...weekly },
    { label: 'Last 15 Days', ...fifteen },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Welcome back, {user?.username}</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-xl px-4 py-2 text-right">
          <div className="text-xs text-gray-400">Balance</div>
          <div className="text-yellow-400 font-bold text-lg">${Number(user?.balance ?? 0).toFixed(2)}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-gray-400">Loading stats...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {periods.map((p) => (
              <StatCard key={p.label} label={p.label} bet={p.totalBet} win={p.totalWin} profit={p.profit} games={p.games} />
            ))}
          </div>

          {/* Summary bar */}
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="text-sm font-semibold text-gray-500 mb-4">All-Time Summary</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: 'Total Bet', value: calcStats(txs, 99999).totalBet, color: 'text-red-600' },
                { label: 'Total Won', value: calcStats(txs, 99999).totalWin, color: 'text-green-600' },
                { label: 'Net P&L',   value: calcStats(txs, 99999).profit,   color: calcStats(txs, 99999).profit >= 0 ? 'text-yellow-600' : 'text-orange-600' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className={`text-2xl font-bold ${color}`}>
                    {value >= 0 && label === 'Net P&L' ? '+' : ''}{value.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
