import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

interface Game {
  id: string;
  gameNumber?: number;
  status: string;
  betAmount: number;
  cartelaCount: number;
  totalBets: number;
  houseCut: number;
  prizePool: number;
  createdAt: string;
}

const fmt = (d: string) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const isToday = (d: string) => {
  const dt = new Date(d);
  const now = new Date();
  return dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
};

export const OwnerDashboard: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'today'>('today');

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ['owner-games'],
    queryFn: async () => {
      const res = await api.get('/games');
      const raw = res.data?.data ?? res.data ?? [];
      return Array.isArray(raw) ? raw : [];
    },
    staleTime: 30_000,
  });

  const displayed = filter === 'today' ? games.filter(g => isToday(g.createdAt)) : games;
  const finished = displayed.filter(g => g.status === 'finished');

  const totalGames = displayed.length;
  const totalBet = displayed.reduce((s, g) => s + Number(g.totalBets), 0);
  const totalProfit = finished.reduce((s, g) => s + Number(g.houseCut), 0);

  const sorted = [...displayed].sort((a, b) => (b.gameNumber ?? 0) - (a.gameNumber ?? 0));

  return (
    <div className="h-full overflow-auto p-3 sm:p-6 w-full" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h1 className="text-lg sm:text-xl font-bold text-white">Owner Dashboard</h1>
        <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
          {(['today', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}>
              {f === 'today' ? 'Today' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-slate-400 text-xs mb-1">Total Games</div>
          <div className="text-white text-xl font-bold">{totalGames}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-slate-400 text-xs mb-1">Total Bet</div>
          <div className="text-white text-xl font-bold">{totalBet.toFixed(2)}</div>
          <div className="text-slate-500 text-xs">Birr</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-slate-400 text-xs mb-1">
            {filter === 'today' ? 'Daily Profit' : 'Total Profit'}
          </div>
          <div className="text-green-400 text-xl font-bold">{totalProfit.toFixed(2)}</div>
          <div className="text-slate-500 text-xs">Birr (house cut)</div>
        </div>
      </div>

      {/* Game history table */}
      {isLoading ? (
        <div className="text-center py-10 text-slate-400">Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">No games found.</div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden sm:block rounded-xl overflow-hidden border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  {['#', 'Date', 'Bet', 'Cartelas', 'Total Bet', 'House Cut', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => (
                  <tr key={g.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-400 text-xs">#{g.gameNumber ?? (i + 1)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmt(g.createdAt)}</td>
                    <td className="px-4 py-3 font-semibold text-white">{Number(g.betAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-300">{g.cartelaCount}</td>
                    <td className="px-4 py-3 text-slate-300">{Number(g.totalBets).toFixed(2)}</td>
                    <td className="px-4 py-3 text-green-400 font-semibold">{Number(g.houseCut).toFixed(2)}</td>
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="sm:hidden space-y-2">
            {sorted.map((g, i) => (
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
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-slate-500">Bet</span><div className="font-semibold text-white">{Number(g.betAmount).toFixed(2)}</div></div>
                  <div><span className="text-slate-500">Total Bet</span><div className="font-semibold text-slate-200">{Number(g.totalBets).toFixed(2)}</div></div>
                  <div><span className="text-slate-500">House Cut</span><div className="font-semibold text-green-400">{Number(g.houseCut).toFixed(2)}</div></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
