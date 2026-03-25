import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { offlineUserApi, offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface Game {
  id: string;
  gameNumber?: number;
  status: string;
  betAmount: number;
  cartelaCount: number;
  totalBets: number;
  prizePool: number;
  houseCut: number;
  housePercentage: number;
  winPattern: string;
  createdAt: string;
  winnerIds: string[];
}

function calcStats(games: Game[], days: number) {
  const cutoff = new Date();
  if (days === 1) {
    cutoff.setHours(0, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
  }
  const filteredGames = games.filter((g) => new Date(g.createdAt) >= cutoff);

  const totalBet = filteredGames.reduce((s, g) =>
    s + Math.round(Number(g.totalBets ?? (g.betAmount * g.cartelaCount))), 0);

  const gamesCount = filteredGames.length;

  // Use houseCut directly from the game object (same as the table does)
  // Fall back to calculating only if houseCut is missing
  const houseCut = filteredGames.reduce((s, g) => {
    if (g.houseCut != null && Number(g.houseCut) > 0) {
      return s + Math.round(Number(g.houseCut));
    }
    const tb = Math.round(Number(g.totalBets ?? (g.betAmount * g.cartelaCount)));
    const hp = Number(g.housePercentage ?? 10);
    return s + Math.round(tb * hp / 100);
  }, 0);

  return { totalBet, houseCut, games: gamesCount };
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
    refetchInterval: 3000,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: games = [], isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ['my-games'],
    queryFn: () => offlineGameApi.myGames(),
    refetchInterval: 3000,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    staleTime: 0,
    gcTime: 0,
  });

  const daily   = calcStats(games, 1);
  const weekly  = calcStats(games, 7);
  const fifteen = calcStats(games, 15);

  const cards: StatCardProps[] = [
    { label: 'Daily Profit',   value: `${daily.houseCut.toLocaleString()} Birr`,    icon: <IconDollar /> },
    { label: 'Daily Total',    value: `${daily.totalBet.toLocaleString()} Birr`,    icon: <IconTrend /> },
    { label: 'Games Today',    value: `${daily.games}`,                             icon: <IconClock /> },
    { label: 'Weekly Total',   value: `${weekly.totalBet.toLocaleString()} Birr`,   icon: <IconCalendar /> },
    { label: 'Weekly Profit',  value: `${weekly.houseCut.toLocaleString()} Birr`,   icon: <IconCard /> },
    { label: '15 Day Profit',  value: `${fifteen.houseCut.toLocaleString()} Birr`,  icon: <IconCard /> },
  ];

  const recentGames = [...games]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  // Group games by day (last 30 days)
  const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
  const dailyMap = new Map<string, { games: number; totalBet: number; totalPrize: number; houseCut: number }>();
  [...games]
    .filter((g) => new Date(g.createdAt) >= cutoff30)
    .forEach((g) => {
      const day = new Date(g.createdAt).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const tb = Number(g.totalBets ?? (g.betAmount * g.cartelaCount));
      const hp = Number(g.housePercentage ?? 10);
      const hc = Math.round(tb * hp / 100);
      const prize = Math.round(tb - hc);
      const prev = dailyMap.get(day) ?? { games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 };
      dailyMap.set(day, {
        games: prev.games + 1,
        totalBet: prev.totalBet + Math.round(tb),
        totalPrize: prev.totalPrize + prize,
        houseCut: prev.houseCut + hc,
      });
    });
  const dailySummary = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Welcome back, {user?.username}</p>
        </div>
        <div className="bg-[#1e2235] rounded-xl px-3 sm:px-4 py-2 text-right border border-[#2a2f45]">
          <div className="text-xs text-gray-400">Balance</div>
          <div className="text-yellow-400 font-bold text-lg">{Number(user?.balance ?? 0).toFixed(2)} Birr</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-400">Loading stats...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {cards.map((c) => (
            <StatCard key={c.label} {...c} />
          ))}
        </div>
      )}

      {/* ── House Profit Chart ── */}
      {!gamesLoading && dailySummary.length > 0 && (
        <div className="mb-6">
          <HouseProfitChart data={dailySummary.slice(0, 10).reverse()} />
        </div>
      )}

      {/* ── Game Summary Table ── */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Game Summary</h2>
        <span className="text-xs text-gray-500">Last 30 days</span>
      </div>

      {gamesLoading ? (
        <div className="text-center py-10 text-gray-400">Loading...</div>
      ) : recentGames.length === 0 ? (
        <div className="text-center py-10 text-gray-500 bg-[#1e2235] rounded-xl border border-[#2a2f45]">
          No games yet
        </div>
      ) : (
        <div className="rounded-xl border border-[#2a2f45] overflow-hidden">
          <div className="overflow-x-auto -mx-0">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr style={{ background: '#161929', borderBottom: '1px solid #2a2f45' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Games</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Players Bet</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Players Won</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">House Profit</th>
                </tr>
              </thead>
              <tbody>
                {dailySummary.map((row, i) => (
                  <tr key={row.date}
                    style={{
                      background: i % 2 === 0 ? '#1e2235' : '#1a1e30',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.date}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold text-white"
                        style={{ background: 'rgba(99,102,241,0.3)' }}>
                        {row.games}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#4ade80' }}>
                      {row.totalBet.toLocaleString()} Birr
                    </td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#fbbf24' }}>
                      {row.totalPrize.toLocaleString()} Birr
                    </td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#f87171' }}>
                      {row.houseCut.toLocaleString()} Birr
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ── HouseProfitChart ──────────────────────────────────────────────────────────
const HouseProfitChart: React.FC<{
  data: { date: string; houseCut: number; games: number }[];
}> = ({ data }) => {
  const W = 600, H = 220, PL = 56, PR = 16, PT = 20, PB = 36;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const maxVal = Math.max(...data.map((d) => d.houseCut), 1);
  // Round up to a nice number
  const yMax = Math.ceil(maxVal / 100) * 100 || 100;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t));

  const barW = Math.min(48, (chartW / data.length) * 0.6);
  const gap = chartW / data.length;

  return (
    <div className="rounded-xl p-5" style={{ background: '#161929', border: '1px solid #2a2f45' }}>
      <div className="mb-1 text-sm font-bold text-white">House Profit Column Chart</div>
      <div className="mb-4 text-xs text-gray-500">Last 10 days performance</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
        {/* Y grid lines + labels */}
        {yTicks.map((tick) => {
          const y = PT + chartH - (tick / yMax) * chartH;
          return (
            <g key={tick}>
              <line x1={PL} x2={W - PR} y1={y} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={PL - 6} y={y + 4} textAnchor="end"
                fontSize={9} fill="#4b5563">{tick}</text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = Math.max(2, (d.houseCut / yMax) * chartH);
          const x = PL + i * gap + gap / 2 - barW / 2;
          const y = PT + chartH - barH;
          const label = new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barW} height={barH} rx={4}
                fill="#10b981" opacity={0.85} />
              {/* Value on hover via title */}
              <title>{d.houseCut} Birr ({d.games} games)</title>
              {/* X label */}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle"
                fontSize={9} fill="#6b7280">{label}</text>
            </g>
          );
        })}

        {/* Y axis label */}
        <text x={10} y={H / 2} textAnchor="middle" fontSize={9} fill="#4b5563"
          transform={`rotate(-90, 10, ${H / 2})`}>Amount (Birr)</text>

        {/* Axes */}
        <line x1={PL} x2={PL} y1={PT} y2={PT + chartH} stroke="#2a2f45" strokeWidth={1} />
        <line x1={PL} x2={W - PR} y1={PT + chartH} y2={PT + chartH} stroke="#2a2f45" strokeWidth={1} />
      </svg>
    </div>
  );
};
