import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { offlineUserApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  status: string;
  createdAt: string;
}

function calcStats(txs: Transaction[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const filtered = txs.filter(
    (t) => t.status === 'completed' && new Date(t.createdAt) >= cutoff
  );
  const totalBet = filtered.filter((t) => t.transactionType === 'bet').reduce((s, t) => s + Number(t.amount), 0);
  const totalWin = filtered.filter((t) => t.transactionType === 'win').reduce((s, t) => s + Number(t.amount), 0);
  const games = filtered.filter((t) => t.transactionType === 'bet').length;
  return { totalBet, totalWin, profit: totalWin - totalBet, games };
}

// Simple inline SVG icons
const IconDollar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
const IconTrend = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
  </svg>
);
const IconClock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
  </svg>
);
const IconCalendar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" /><path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const IconCard = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="2" y="5" width="20" height="14" rx="2" /><path strokeLinecap="round" d="M2 10h20" />
  </svg>
);

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon }) => (
  <div className="bg-[#1e2235] rounded-xl p-4 flex items-start gap-3 border border-[#2a2f45]">
    <div className="mt-0.5 text-red-400">{icon}</div>
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  </div>
);

export const UserDashboard: React.FC = () => {
  const { user } = useAuthStore();

  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['my-transactions'],
    queryFn: () => offlineUserApi.myTransactions(),
  });

  const daily   = calcStats(txs, 1);
  const weekly  = calcStats(txs, 7);
  const fifteen = calcStats(txs, 15);

  const cards: StatCardProps[] = [
    { label: 'Daily Profit',   value: `${daily.profit.toFixed(0)} Birr`,    icon: <IconDollar /> },
    { label: 'Daily Total',    value: `${daily.totalBet.toFixed(0)} Birr`,   icon: <IconTrend /> },
    { label: 'Games Today',    value: `${daily.games}`,                      icon: <IconClock /> },
    { label: 'Weekly Total',   value: `${weekly.totalBet.toFixed(0)} Birr`,  icon: <IconCalendar /> },
    { label: 'Weekly Profit',  value: `${weekly.profit.toFixed(0)} Birr`,    icon: <IconCard /> },
    { label: '15 Day Profit',  value: `${fifteen.profit.toFixed(0)} Birr`,   icon: <IconCard /> },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Welcome back, {user?.username}</p>
        </div>
        <div className="bg-[#1e2235] rounded-xl px-4 py-2 text-right border border-[#2a2f45]">
          <div className="text-xs text-gray-400">Balance</div>
          <div className="text-yellow-400 font-bold text-lg">{Number(user?.balance ?? 0).toFixed(2)} Birr</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-gray-400">Loading stats...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => (
            <StatCard key={c.label} {...c} />
          ))}
        </div>
      )}
    </div>
  );
};
