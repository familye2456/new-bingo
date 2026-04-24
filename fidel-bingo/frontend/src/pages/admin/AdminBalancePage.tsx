import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, gameApi } from '../../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserRecord {
  id: string; username: string; email: string;
  paymentType: 'prepaid' | 'postpaid'; balance: number; status: string; role?: string;
}
interface Game {
  id: string; status: string; betAmount: number; cartelaCount: number;
  totalBets: number; prizePool: number; houseCut: number;
  housePercentage: number; winPattern: string;
  createdAt: string; finishedAt?: string; winnerIds: string[]; creatorId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtBirr = (n: number) =>
  n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Birr';

function buildDailyRows(games: Game[]) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30); cutoff.setHours(0, 0, 0, 0);
  const map = new Map<string, { date: string; ts: number; games: number; totalBet: number; totalPrize: number; houseCut: number }>();
  games.filter(g => new Date(g.createdAt) >= cutoff).forEach(g => {
    const d = new Date(g.createdAt);
    const key = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const tb = Number(g.totalBets ?? g.betAmount * g.cartelaCount);
    const hc = g.houseCut != null && Number(g.houseCut) > 0 ? Number(g.houseCut) : tb * Number(g.housePercentage ?? 10) / 100;
    const prize = tb - hc;
    const p = map.get(key) ?? { date: key, ts: d.getTime(), games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 };
    map.set(key, { ...p, games: p.games + 1, totalBet: p.totalBet + tb, totalPrize: p.totalPrize + prize, houseCut: p.houseCut + hc });
  });
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
}

function buildWeeklyRows(games: Game[]) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90); cutoff.setHours(0, 0, 0, 0);
  const map = new Map<string, { week: string; ts: number; games: number; totalBet: number; totalPrize: number; houseCut: number }>();
  games.filter(g => new Date(g.createdAt) >= cutoff).forEach(g => {
    const d = new Date(g.createdAt);
    // ISO week start (Monday)
    const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const mon = new Date(d); mon.setDate(d.getDate() - day); mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const key = mon.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' – ' + sun.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const tb = Number(g.totalBets ?? g.betAmount * g.cartelaCount);
    const hc = g.houseCut != null && Number(g.houseCut) > 0 ? Number(g.houseCut) : tb * Number(g.housePercentage ?? 10) / 100;
    const prize = tb - hc;
    const p = map.get(key) ?? { week: key, ts: mon.getTime(), games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 };
    map.set(key, { ...p, games: p.games + 1, totalBet: p.totalBet + tb, totalPrize: p.totalPrize + prize, houseCut: p.houseCut + hc });
  });
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
}

// ── User Report Panel ─────────────────────────────────────────────────────────
const UserReportPanel: React.FC<{ user: UserRecord; onClose: () => void }> = ({ user, onClose }) => {
  const [view, setView] = useState<'daily' | 'weekly'>('daily');
  const printRef = useRef<HTMLDivElement>(null);

  const { data: allGames = [], isLoading } = useQuery<Game[]>({
    queryKey: ['admin-user-games', user.id],
    queryFn: () => gameApi.list(undefined, undefined, user.id).then((r) => r.data.data),
    staleTime: 60_000,
  });

  const daily = buildDailyRows(allGames);
  const weekly = buildWeeklyRows(allGames);
  const rows = view === 'daily' ? daily : weekly;

  const totals = rows.reduce((s, r) => ({
    games: s.games + r.games,
    totalBet: s.totalBet + r.totalBet,
    totalPrize: s.totalPrize + r.totalPrize,
    houseCut: s.houseCut + r.houseCut,
  }), { games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 });

  const handlePrint = () => {
    const content = printRef.current?.innerHTML ?? '';
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>${user.username} – ${view === 'weekly' ? 'Weekly' : 'Daily'} Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h2 { margin-bottom: 4px; } p { color: #555; margin-bottom: 16px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f3f4f6; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
        td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
        tfoot td { font-weight: bold; background: #f9fafb; border-top: 2px solid #e5e7eb; }
        .profit { color: #dc2626; } .bet { color: #2563eb; } .prize { color: #d97706; }
      </style></head><body>${content}</body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-base">
              {user.username[0].toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-gray-900">{user.username}</div>
              <div className="text-xs text-gray-400">{user.email} · {user.paymentType}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold">
              {(['daily', 'weekly'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 transition-colors capitalize ${view === v ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                  {v}
                </button>
              ))}
            </div>
            {/* Print/Download */}
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Report
            </button>
            <button onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              ✕
            </button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 shrink-0 border-b border-gray-50">
          {[
            { label: 'Total Games', value: allGames.length.toString(), color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: `Total Bet (${view === 'daily' ? '30d' : '90d'})`, value: fmtBirr(rows.reduce((s,r)=>s+r.totalBet,0)), color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: `Total Prize (${view === 'daily' ? '30d' : '90d'})`, value: fmtBirr(rows.reduce((s,r)=>s+r.totalPrize,0)), color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: `Total Profit (${view === 'daily' ? '30d' : '90d'})`, value: fmtBirr(rows.reduce((s,r)=>s+r.houseCut,0)), color: 'text-red-600', bg: 'bg-red-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl p-3`}>
              <div className={`text-base font-black ${color} leading-tight`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No data in the last {view === 'daily' ? '30' : '90'} days.</div>
          ) : (
            <div ref={printRef}>
              <h2 style={{ display: 'none' }}>{user.username} – {view === 'weekly' ? 'Weekly' : 'Daily'} Report</h2>
              <p style={{ display: 'none' }}>Generated: {new Date().toLocaleString()}</p>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                  <tr>
                    {[
                      [view === 'daily' ? 'Date' : 'Week', 'text-left'],
                      ['Games', 'text-center'],
                      ['Total Bet', 'text-right'],
                      ['Total Prize / Win', 'text-right'],
                      [view === 'daily' ? 'Daily Profit' : 'Weekly Profit', 'text-right'],
                    ].map(([h, a]) => (
                      <th key={h} className={`px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide ${a}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 text-xs font-medium text-gray-600 whitespace-nowrap">
                        {view === 'daily' ? (row as any).date : (row as any).week}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                          {row.games}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs font-bold text-blue-600">{fmtBirr(row.totalBet)}</td>
                      <td className="px-5 py-3 text-right text-xs font-bold text-amber-600">{fmtBirr(row.totalPrize)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-100">
                          {fmtBirr(row.houseCut)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-5 py-3 text-xs font-black text-gray-600">TOTAL</td>
                    <td className="px-5 py-3 text-center text-xs font-black text-indigo-600">{totals.games}</td>
                    <td className="px-5 py-3 text-right text-xs font-black text-blue-600">{fmtBirr(totals.totalBet)}</td>
                    <td className="px-5 py-3 text-right text-xs font-black text-amber-600">{fmtBirr(totals.totalPrize)}</td>
                    <td className="px-5 py-3 text-right text-xs font-black text-red-600">{fmtBirr(totals.houseCut)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export const AdminBalancePage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [topUpUser, setTopUpUser] = useState<UserRecord | null>(null);
  const [amount, setAmount] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: allUsers = [], isLoading: loadingUsers } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  // Today's games for all users
  const { data: todayGames = [], isLoading: loadingToday } = useQuery<Game[]>({
    queryKey: ['games-today'],
    queryFn: () => gameApi.list(undefined, 'today').then((r) => r.data.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const topUpMutation = useMutation({
    mutationFn: () => adminApi.topUpBalance(topUpUser!.id, parseFloat(amount)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSuccessMsg(`Balance updated for ${topUpUser?.username}`);
      setAmount('');
      setTimeout(() => { setSuccessMsg(''); setTopUpUser(null); }, 3000);
    },
  });

  // Build today's profit per user
  const todayProfitMap = todayGames.reduce<Record<string, { games: number; totalBet: number; profit: number }>>((acc, g) => {
    const uid = g.creatorId;
    if (!acc[uid]) acc[uid] = { games: 0, totalBet: 0, profit: 0 };
    acc[uid].games += 1;
    acc[uid].totalBet += Number(g.totalBets);
    acc[uid].profit += Number(g.houseCut);
    return acc;
  }, {});

  const prepaidUsers = allUsers.filter(u => u.paymentType === 'prepaid');
  const postpaidUsers = allUsers.filter(u => u.paymentType === 'postpaid');
  const totalBalance = prepaidUsers.reduce((s, u) => s + Number(u.balance), 0);
  const todayTotalProfit = Object.values(todayProfitMap).reduce((s, v) => s + v.profit, 0);

  // Merge users with today's stats, sort by today's profit desc
  const rows = allUsers
    .filter(u => u.role !== 'admin')
    .map(u => ({ ...u, today: todayProfitMap[u.id] ?? { games: 0, totalBet: 0, profit: 0 } }))
    .sort((a, b) => b.today.profit - a.today.profit);

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Prepaid Users', value: prepaidUsers.length, color: 'from-violet-500 to-violet-600' },
          { label: 'Postpaid Users', value: postpaidUsers.length, color: 'from-orange-500 to-orange-600' },
          { label: 'Total Prepaid Balance', value: fmtBirr(totalBalance), color: 'from-blue-500 to-blue-600' },
          { label: "Today's Total Profit", value: fmtBirr(todayTotalProfit), color: 'from-emerald-500 to-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-gradient-to-br ${color} rounded-2xl p-4`}>
            <div className="text-xl font-black text-white leading-tight">{value}</div>
            <div className="text-xs text-white/75 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* All users table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">All Users — Daily Profit</h2>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>

        {loadingUsers || loadingToday ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  {['Username', 'Type', 'Balance', 'Games Today', 'Bet Today', "Today's Profit", 'Actions'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/40 transition-colors">
                    {/* Username — clickable to open report */}
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => setSelectedUser(u)}
                        className="flex items-center gap-2.5 group">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {u.username[0].toUpperCase()}
                        </div>
                        <span className="font-semibold text-blue-600 group-hover:underline text-sm">{u.username}</span>
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>
                        {u.paymentType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-emerald-600 text-xs">
                      {u.paymentType === 'prepaid' ? fmtBirr(Number(u.balance)) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {u.today.games > 0 ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                          {u.today.games}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium text-blue-600">
                      {u.today.totalBet > 0 ? fmtBirr(u.today.totalBet) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.today.profit > 0 ? (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {fmtBirr(u.today.profit)}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSelectedUser(u)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 transition-colors font-medium">
                          Report
                        </button>
                        {u.paymentType === 'prepaid' && (
                          <button
                            onClick={() => { setTopUpUser(u); setAmount(''); setSuccessMsg(''); }}
                            className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 transition-colors font-medium">
                            Top Up
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top-up modal */}
      {topUpUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setTopUpUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Add Balance</h3>
              <button onClick={() => setTopUpUser(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
                {topUpUser.username[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-800">{topUpUser.username}</div>
                <div className="text-xs text-gray-400">Current: {fmtBirr(Number(topUpUser.balance))}</div>
              </div>
            </div>
            <input
              type="number" min="1" step="1" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount (Birr)"
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              autoFocus
            />
            {amount && parseFloat(amount) > 0 && (
              <div className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                New balance: {fmtBirr(Number(topUpUser.balance) + parseFloat(amount))}
              </div>
            )}
            {successMsg && (
              <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{successMsg}</div>
            )}
            <button
              onClick={() => topUpMutation.mutate()}
              disabled={!amount || parseFloat(amount) <= 0 || topUpMutation.isPending}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
            </button>
          </div>
        </div>
      )}

      {/* User report panel */}
      {selectedUser && (
        <UserReportPanel user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
};
