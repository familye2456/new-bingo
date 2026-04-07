import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface Game {
  id: string; status: string; betAmount: number; cartelaCount: number;
  totalBets: number; prizePool: number; houseCut: number;
  housePercentage: number; winPattern: string; createdAt: string; winnerIds: string[];
}

const fmt = (n: number) => n.toLocaleString();
const fmtBirr = (n: number) => `${n.toLocaleString()} Birr`;

function calcStats(games: Game[], days: number) {
  const cutoff = new Date();
  if (days === 1) cutoff.setHours(0, 0, 0, 0);
  else { cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0); }
  const f = games.filter((g) => new Date(g.createdAt) >= cutoff);
  const totalBet = f.reduce((s, g) => s + Number(g.totalBets ?? g.betAmount * g.cartelaCount), 0);
  const houseCut = f.reduce((s, g) => {
    if (g.houseCut != null && Number(g.houseCut) > 0) return s + Number(g.houseCut);
    return s + Number(g.totalBets ?? g.betAmount * g.cartelaCount) * Number(g.housePercentage ?? 10) / 100;
  }, 0);
  return { totalBet: Math.round(totalBet), houseCut: Math.round(houseCut), count: f.length };
}

function buildDaily(games: Game[]) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30); cutoff.setHours(0, 0, 0, 0);
  const map = new Map<string, { games: number; totalBet: number; totalPrize: number; houseCut: number; ts: number }>();
  games.filter((g) => new Date(g.createdAt) >= cutoff).forEach((g) => {
    const d = new Date(g.createdAt);
    const key = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const tb = Number(g.totalBets ?? g.betAmount * g.cartelaCount);
    const hc = g.houseCut != null && Number(g.houseCut) > 0 ? Number(g.houseCut) : tb * Number(g.housePercentage ?? 10) / 100;
    const p = map.get(key) ?? { games: 0, totalBet: 0, totalPrize: 0, houseCut: 0, ts: d.getTime() };
    map.set(key, { games: p.games + 1, totalBet: p.totalBet + Math.round(tb), totalPrize: p.totalPrize + Math.round(tb - hc), houseCut: p.houseCut + Math.round(hc), ts: p.ts });
  });
  return Array.from(map.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => b.ts - a.ts);
}

// ── SVG Bar Chart (full-width, professional) ──────────────────────────────────
const BarChart: React.FC<{ data: { date: string; houseCut: number; totalBet: number; games: number }[] }> = ({ data }) => {
  const [hov, setHov] = useState<number | null>(null);
  if (!data.length) return <div className="flex items-center justify-center h-40 text-xs" style={{ color: '#374151' }}>No data yet</div>;

  const maxHC = Math.max(...data.map((d) => d.houseCut), 1);
  const maxBet = Math.max(...data.map((d) => d.totalBet), 1);
  const H = 160, PB = 28, PT = 12, PL = 8, PR = 8;
  const chartH = H - PB - PT;
  const barGroupW = 100 / data.length;
  const barW = Math.min(barGroupW * 0.35, 3.5);
  const gap = barW * 0.6;

  return (
    <div className="relative w-full" style={{ height: H }}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PT + chartH * (1 - t);
          return <line key={t} x1={PL} x2={100 - PR} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={0.3} />;
        })}
        {data.map((d, i) => {
          const cx = PL + (i + 0.5) * ((100 - PL - PR) / data.length);
          const hcH = Math.max(1, (d.houseCut / maxHC) * chartH);
          const betH = Math.max(1, (d.totalBet / maxBet) * chartH);
          const isHov = hov === i;
          return (
            <g key={d.date}>
              {/* Bet bar (behind) */}
              <rect
                x={cx - gap / 2 - barW} y={PT + chartH - betH}
                width={barW} height={betH} rx={0.8}
                fill={isHov ? 'rgba(52,211,153,0.9)' : 'rgba(52,211,153,0.3)'}
              />
              {/* House cut bar (front) */}
              <rect
                x={cx + gap / 2} y={PT + chartH - hcH}
                width={barW} height={hcH} rx={0.8}
                fill={isHov ? '#f87171' : 'rgba(248,113,113,0.7)'}
              />
              {/* Hover hit area */}
              <rect
                x={cx - barW - gap / 2 - 1} y={PT}
                width={barW * 2 + gap + 2} height={chartH}
                fill="transparent"
                onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          );
        })}
        {/* X labels */}
        {data.map((d, i) => {
          const cx = PL + (i + 0.5) * ((100 - PL - PR) / data.length);
          const label = new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
          return (
            <text key={d.date} x={cx} y={H - 4} textAnchor="middle" fontSize={2.8} fill="#374151">{label}</text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hov !== null && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none z-20
          rounded-xl px-4 py-2.5 shadow-2xl text-xs"
          style={{ background: '#0d1424', border: '1px solid rgba(255,255,255,0.1)', minWidth: 160 }}>
          <div className="font-semibold text-white mb-1.5">{data[hov].date}</div>
          <div className="flex items-center justify-between gap-4">
            <span style={{ color: '#34d399' }}>Bet</span>
            <span className="font-bold text-white">{fmtBirr(data[hov].totalBet)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 mt-0.5">
            <span style={{ color: '#f87171' }}>House</span>
            <span className="font-bold text-white">{fmtBirr(data[hov].houseCut)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 mt-0.5">
            <span style={{ color: '#60a5fa' }}>Games</span>
            <span className="font-bold text-white">{data[hov].games}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-0 right-0 flex items-center gap-3 pb-0.5">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(52,211,153,0.6)' }} />
          <span className="text-xs" style={{ color: '#4b5563' }}>Bet</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(248,113,113,0.7)' }} />
          <span className="text-xs" style={{ color: '#4b5563' }}>House</span>
        </div>
      </div>
    </div>
  );
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KPI: React.FC<{
  label: string; value: string; unit: string; sub: string;
  accent: string; icon: React.ReactNode;
}> = ({ label, value, unit, sub, accent, icon }) => (
  <div className="relative rounded-2xl p-4 overflow-hidden flex flex-col gap-3"
    style={{ background: '#131b2e', border: `1px solid ${accent}1a` }}>
    {/* Glow */}
    <div className="absolute -right-4 -bottom-4 w-20 h-20 rounded-full blur-2xl pointer-events-none"
      style={{ background: accent, opacity: 0.07 }} />
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold tracking-wide" style={{ color: '#4b5563' }}>{label}</span>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}15`, border: `1px solid ${accent}25` }}>
        <span style={{ color: accent }}>{icon}</span>
      </div>
    </div>
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-black tracking-tight" style={{ color: accent }}>{value}</span>
        <span className="text-xs font-semibold" style={{ color: `${accent}80` }}>{unit}</span>
      </div>
      <div className="text-xs mt-1" style={{ color: '#374151' }}>{sub}</div>
    </div>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
export const UserDashboard: React.FC = () => {
  const { user } = useAuthStore();

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ['my-games'],
    queryFn: () => offlineGameApi.myGames() as Promise<Game[]>,
  });

  const daily   = calcStats(games, 1);
  const weekly  = calcStats(games, 7);
  const fifteen = calcStats(games, 15);
  const d30     = calcStats(games, 30);

  const daily30 = buildDaily(games);
  const chartData = [...daily30].reverse().slice(-14).map((r) => ({
    date: r.date, houseCut: r.houseCut, totalBet: r.totalBet, games: r.games,
  }));

  const kpis = [
    { label: 'Daily Profit',   value: fmt(daily.houseCut),   unit: 'Birr', sub: `${daily.count} games today`,       accent: '#f87171', icon: <IcProfit /> },
    { label: 'Daily Bet',      value: fmt(daily.totalBet),   unit: 'Birr', sub: 'total bets today',                 accent: '#34d399', icon: <IcTrend /> },
    { label: 'Games Today',    value: fmt(daily.count),      unit: '',     sub: 'games played',                     accent: '#60a5fa', icon: <IcGames /> },
    { label: 'Weekly Profit',  value: fmt(weekly.houseCut),  unit: 'Birr', sub: `${weekly.count} games this week`,  accent: '#fbbf24', icon: <IcProfit /> },
    { label: 'Weekly Bet',     value: fmt(weekly.totalBet),  unit: 'Birr', sub: 'total bets this week',             accent: '#a78bfa', icon: <IcCalendar /> },
    { label: '15-Day Profit',  value: fmt(fifteen.houseCut), unit: 'Birr', sub: `${fifteen.count} games`,           accent: '#fb923c', icon: <IcProfit /> },
  ];

  const totals = {
    games: daily30.reduce((s, r) => s + r.games, 0),
    bet:   daily30.reduce((s, r) => s + r.totalBet, 0),
    prize: daily30.reduce((s, r) => s + r.totalPrize, 0),
    house: daily30.reduce((s, r) => s + r.houseCut, 0),
  };

  return (
    <div className="h-full overflow-auto" style={{ background: '#0b1120' }}>
      <div className="p-5 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">Dashboard</h1>
            <p className="text-xs mt-0.5" style={{ color: '#374151' }}>
              {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Balance */}
            <div className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5"
              style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.12),rgba(251,191,36,0.03))', border: '1px solid rgba(251,191,36,0.2)' }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(251,191,36,0.12)' }}>
                <IcWallet />
              </div>
              <div>
                <div className="text-xs font-medium" style={{ color: 'rgba(251,191,36,0.45)' }}>Balance</div>
                <div className="font-black text-yellow-400 text-base leading-none">
                  {Number(user?.balance ?? 0).toFixed(2)}<span className="text-xs ml-1 opacity-50 font-semibold">Birr</span>
                </div>
              </div>
            </div>
            {/* Total games */}
            <div className="rounded-2xl px-4 py-2.5 text-center"
              style={{ background: '#131b2e', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs" style={{ color: '#374151' }}>All Games</div>
              <div className="font-black text-white text-base leading-none mt-0.5">{games.length}</div>
            </div>
          </div>
        </div>

        {/* ── KPI grid ── */}
        {isLoading
          ? <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl animate-pulse" style={{ background: '#131b2e', height: 108 }} />
              ))}
            </div>
          : <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {kpis.map((k) => <KPI key={k.label} {...k} />)}
            </div>
        }

        {/* ── Chart ── */}
        {!isLoading && (
          <div className="rounded-2xl p-5" style={{ background: '#131b2e', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
              <div>
                <div className="text-sm font-bold text-white">Revenue Overview</div>
                <div className="text-xs mt-0.5" style={{ color: '#374151' }}>Last 14 days · Bet vs House Profit</div>
              </div>
              <div className="flex items-center gap-5">
                {[
                  { label: '30d Bet',   value: fmtBirr(d30.totalBet),  color: '#34d399' },
                  { label: '30d House', value: fmtBirr(d30.houseCut),  color: '#f87171' },
                  { label: '30d Games', value: fmt(d30.count),          color: '#60a5fa' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="text-xs" style={{ color: '#374151' }}>{label}</div>
                    <div className="text-sm font-bold mt-0.5" style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
            <BarChart data={chartData} />
          </div>
        )}

        {/* ── Table ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#1f2937' }}>Daily Breakdown</span>
            <span className="text-xs px-3 py-1 rounded-full font-medium" style={{ background: '#131b2e', color: '#374151' }}>Last 30 days</span>
          </div>

          {isLoading
            ? <div className="rounded-2xl animate-pulse" style={{ background: '#131b2e', height: 120 }} />
            : daily30.length === 0
              ? <div className="rounded-2xl py-16 flex flex-col items-center gap-2"
                  style={{ background: '#131b2e', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: '#1f2937' }}><IcGames /></span>
                  <span className="text-sm" style={{ color: '#1f2937' }}>No games in the last 30 days</span>
                </div>
              : <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  {/* Desktop */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ background: '#0d1424', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          {[['Date','text-left'],['Games','text-center'],['Players Bet','text-right'],['Players Won','text-right'],['House Profit','text-right']].map(([h, a]) => (
                            <th key={h} className={`px-5 py-3.5 text-xs font-bold uppercase tracking-widest ${a}`} style={{ color: '#1f2937' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {daily30.map((row, i) => (
                          <tr key={row.date} className="group transition-colors"
                            style={{ background: i % 2 === 0 ? '#131b2e' : '#0f1628', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <td className="px-5 py-3 text-xs font-medium whitespace-nowrap" style={{ color: '#6b7280' }}>{row.date}</td>
                            <td className="px-5 py-3 text-center">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                                style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                                {row.games}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right text-xs font-bold" style={{ color: '#34d399' }}>{fmtBirr(row.totalBet)}</td>
                            <td className="px-5 py-3 text-right text-xs font-bold" style={{ color: '#fbbf24' }}>{fmtBirr(row.totalPrize)}</td>
                            <td className="px-5 py-3 text-right">
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                                style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.15)' }}>
                                {fmtBirr(row.houseCut)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#0d1424', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <td className="px-5 py-3.5 text-xs font-black" style={{ color: '#4b5563' }}>TOTAL</td>
                          <td className="px-5 py-3.5 text-center text-xs font-black" style={{ color: '#818cf8' }}>{totals.games}</td>
                          <td className="px-5 py-3.5 text-right text-xs font-black" style={{ color: '#34d399' }}>{fmtBirr(totals.bet)}</td>
                          <td className="px-5 py-3.5 text-right text-xs font-black" style={{ color: '#fbbf24' }}>{fmtBirr(totals.prize)}</td>
                          <td className="px-5 py-3.5 text-right text-xs font-black" style={{ color: '#f87171' }}>{fmtBirr(totals.house)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {/* Mobile */}
                  <div className="sm:hidden divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    {daily30.map((row) => (
                      <div key={row.date} className="px-4 py-4" style={{ background: '#131b2e' }}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold" style={{ color: '#6b7280' }}>{row.date}</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{row.games} games</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'Bet',   value: fmt(row.totalBet),   color: '#34d399', bg: 'rgba(52,211,153,0.07)' },
                            { label: 'Won',   value: fmt(row.totalPrize), color: '#fbbf24', bg: 'rgba(251,191,36,0.07)' },
                            { label: 'House', value: fmt(row.houseCut),   color: '#f87171', bg: 'rgba(248,113,113,0.07)' },
                          ].map(({ label, value, color, bg }) => (
                            <div key={label} className="rounded-xl p-2.5 text-center" style={{ background: bg }}>
                              <div className="text-xs mb-1" style={{ color: '#374151' }}>{label}</div>
                              <div className="text-xs font-bold" style={{ color }}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
          }
        </div>

      </div>
    </div>
  );
};

// ── Icons ─────────────────────────────────────────────────────────────────────
const IcProfit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
const IcTrend = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
  </svg>
);
const IcGames = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
  </svg>
);
const IcCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <rect x="3" y="4" width="18" height="18" rx="2" /><path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const IcWallet = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={2} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h5v4h-5a2 2 0 010-4z" />
  </svg>
);
