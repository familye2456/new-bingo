import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, gameApi } from '../../services/api';

interface UserRecord {
  id: string; username: string; email: string;
  paymentType: 'prepaid' | 'postpaid'; balance: number; status: string; role?: string;
}
interface Game {
  id: string; status: string; betAmount: number; cartelaCount: number;
  totalBets: number; prizePool: number; houseCut: number; housePercentage: number;
  winPattern: string; createdAt: string; finishedAt?: string; winnerIds: string[]; creatorId: string;
}

const fmtBirr = (n: number) =>
  n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Birr';

type DayRow = { date: string; ts: number; games: number; totalBet: number; totalPrize: number; houseCut: number };
type Group  = { label: string; ts: number; days: DayRow[]; games: number; totalBet: number; totalPrize: number; houseCut: number };
type ViewMode = 'daily' | 'weekly' | '15days' | 'monthly';

function buildDayMap(games: Game[], cutoffDays: number): DayRow[] {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - cutoffDays); cutoff.setHours(0,0,0,0);
  const map = new Map<string, DayRow>();
  games.filter(g => new Date(g.createdAt) >= cutoff).forEach(g => {
    const d = new Date(g.createdAt);
    const key = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const tb = Number(g.totalBets ?? g.betAmount * g.cartelaCount);
    const hc = g.houseCut != null && Number(g.houseCut) > 0 ? Number(g.houseCut) : tb * Number(g.housePercentage ?? 10) / 100;
    const p = map.get(key) ?? { date: key, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 };
    map.set(key, { ...p, games: p.games + 1, totalBet: p.totalBet + tb, totalPrize: p.totalPrize + (tb - hc), houseCut: p.houseCut + hc });
  });
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
}

function groupDays(days: DayRow[], groupFn: (ts: number) => { label: string; ts: number }): Group[] {
  const map = new Map<string, Group>();
  days.forEach(day => {
    const { label, ts } = groupFn(day.ts);
    const g = map.get(label) ?? { label, ts, days: [], games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 };
    g.days.push(day);
    g.games += day.games; g.totalBet += day.totalBet; g.totalPrize += day.totalPrize; g.houseCut += day.houseCut;
    map.set(label, g);
  });
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
}

function weekLabel(ts: number): { label: string; ts: number } {
  const d = new Date(ts);
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  const mon = new Date(d); mon.setDate(d.getDate() - day); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { label: mon.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' – ' + sun.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }), ts: mon.getTime() };
}

function period15Label(ts: number): { label: string; ts: number } {
  const d = new Date(ts);
  const half = d.getDate() <= 15 ? 1 : 2;
  const start = new Date(d.getFullYear(), d.getMonth(), half === 1 ? 1 : 16);
  const end   = new Date(d.getFullYear(), d.getMonth(), half === 1 ? 15 : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
  return { label: start.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' – ' + end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }), ts: start.getTime() };
}

function monthLabel(ts: number): { label: string; ts: number } {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  return { label: start.toLocaleDateString('en', { month: 'long', year: 'numeric' }), ts: start.getTime() };
}

const VIEW_CONFIG: Record<ViewMode, { label: string; cutoffDays: number; groupFn?: (ts: number) => { label: string; ts: number } }> = {
  daily:    { label: 'Daily',    cutoffDays: 30 },
  weekly:   { label: 'Weekly',   cutoffDays: 90,  groupFn: weekLabel },
  '15days': { label: '15 Days',  cutoffDays: 90,  groupFn: period15Label },
  monthly:  { label: 'Monthly',  cutoffDays: 365, groupFn: monthLabel },
};

// ── Shared table headers ──────────────────────────────────────────────────────
const TH = ['Date', 'Games', 'Total Bet', 'Prize / Win', 'Profit'];
const TA = ['text-left', 'text-center', 'text-right', 'text-right', 'text-right'];

// ── User Report Panel ─────────────────────────────────────────────────────────
const UserReportPanel: React.FC<{ user: UserRecord; onClose: () => void }> = ({ user, onClose }) => {
  const [view, setView] = useState<ViewMode>('daily');
  const printRef = useRef<HTMLDivElement>(null);

  const { data: allGames = [], isLoading } = useQuery<Game[]>({
    queryKey: ['admin-user-games', user.id],
    queryFn: () => gameApi.list(undefined, undefined, user.id).then(r => r.data.data),
    staleTime: 60_000,
  });

  const cfg = VIEW_CONFIG[view];
  const days = buildDayMap(allGames, cfg.cutoffDays);
  const groups: Group[] = cfg.groupFn ? groupDays(days, cfg.groupFn) : [];

  const grandTotal = days.reduce((s, r) => ({
    games: s.games + r.games, totalBet: s.totalBet + r.totalBet,
    totalPrize: s.totalPrize + r.totalPrize, houseCut: s.houseCut + r.houseCut,
  }), { games: 0, totalBet: 0, totalPrize: 0, houseCut: 0 });

  const kpiSource = cfg.groupFn ? groups : days;
  const kpiTotals = kpiSource.reduce((s, r) => ({ totalBet: s.totalBet + r.totalBet, totalPrize: s.totalPrize + r.totalPrize, houseCut: s.houseCut + r.houseCut }), { totalBet: 0, totalPrize: 0, houseCut: 0 });
  const periodLabel = cfg.groupFn ? `${cfg.cutoffDays}d` : '30d';

  const handlePrint = () => {
    const content = printRef.current?.innerHTML ?? '';
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(
      `<html><head><title>${user.username} – ${cfg.label} Report</title>` +
      `<style>body{font-family:Arial,sans-serif;padding:24px;color:#111}` +
      `table{width:100%;border-collapse:collapse;font-size:13px}` +
      `th{background:#f3f4f6;text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6b7280}` +
      `td{padding:8px 12px;border-bottom:1px solid #f3f4f6}` +
      `.gh td{background:#eff6ff;font-weight:700;color:#1d4ed8;border-top:2px solid #bfdbfe}` +
      `.gt td{background:#fef9c3;font-weight:700;color:#92400e;border-top:1px solid #fde68a}` +
      `.dr td{padding-left:24px}` +
      `tfoot td{font-weight:bold;background:#f9fafb;border-top:2px solid #e5e7eb}</style></head>` +
      `<body>${content}</body></html>`
    );
    win.document.close(); win.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-4xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', borderRadius: '16px 16px 0 0' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {user.username[0].toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-gray-900 text-sm sm:text-base">{user.username}</div>
                <div className="text-xs text-gray-400 hidden sm:block">{user.email} · {user.paymentType}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2">
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold">
                  {(Object.keys(VIEW_CONFIG) as ViewMode[]).map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`px-2.5 py-1.5 transition-colors ${view === v ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                      {VIEW_CONFIG[v].label}
                    </button>
                  ))}
                </div>
                <button onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Print
                </button>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0">✕</button>
            </div>
          </div>
          {/* Mobile controls */}
          <div className="flex items-center gap-2 sm:hidden mt-2">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold flex-1">
              {(Object.keys(VIEW_CONFIG) as ViewMode[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`flex-1 py-1.5 transition-colors ${view === v ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>
                  {VIEW_CONFIG[v].label}
                </button>
              ))}
            </div>
            <button onClick={handlePrint}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              Print
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 px-4 sm:px-6 py-3 shrink-0 border-b border-gray-50">
          {[
            { label: 'Total Games', value: allGames.length.toString(), color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: `Bet (${periodLabel})`, value: fmtBirr(kpiTotals.totalBet), color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: `Prize (${periodLabel})`, value: fmtBirr(kpiTotals.totalPrize), color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: `Profit (${periodLabel})`, value: fmtBirr(kpiTotals.houseCut), color: 'text-red-600', bg: 'bg-red-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl p-2.5 sm:p-3`}>
              <div className={`text-sm sm:text-base font-black ${color} leading-tight`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
          ) : days.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No data in the last {cfg.cutoffDays} days.</div>
          ) : (
            <div ref={printRef}>
              <h2 style={{ display: 'none' }}>{user.username} – {cfg.label} Report</h2>
              <p style={{ display: 'none' }}>Generated: {new Date().toLocaleString()}</p>

              {view === 'daily' ? (
                /* ── DAILY flat ── */
                <>
                  <div className="sm:hidden divide-y divide-gray-50">
                    {days.map((row, i) => (
                      <div key={i} className="px-4 py-3 space-y-1.5">
                        <div className="flex justify-between"><span className="text-xs font-semibold text-gray-700">{row.date}</span><span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">{row.games}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-gray-400">Bet</span><span className="font-bold text-blue-600">{fmtBirr(row.totalBet)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-gray-400">Prize</span><span className="font-bold text-amber-600">{fmtBirr(row.totalPrize)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-gray-400">Profit</span><span className="font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">{fmtBirr(row.houseCut)}</span></div>
                      </div>
                    ))}
                    <MobileTotals label="TOTAL" row={grandTotal} />
                  </div>
                  <table className="w-full text-sm hidden sm:table">
                    <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                      <tr>{TH.map((h,i)=><th key={h} className={`px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide ${TA[i]}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {days.map((row, i) => <DayTr key={i} row={row} indent={false} />)}
                    </tbody>
                    <tfoot><GrandTotalTr row={grandTotal} /></tfoot>
                  </table>
                </>
              ) : (
                /* ── GROUPED: weekly / 15days / monthly ── */
                <>
                  <div className="sm:hidden divide-y divide-gray-100">
                    {groups.map((grp, gi) => (
                      <div key={gi}>
                        <div className="px-4 py-2 bg-blue-50 flex justify-between">
                          <span className="text-xs font-bold text-blue-700">{grp.label}</span>
                          <span className="text-xs font-bold text-blue-600">{grp.games} games</span>
                        </div>
                        {grp.days.map((day, di) => (
                          <div key={di} className="px-6 py-2.5 space-y-1 border-b border-gray-50">
                            <div className="flex justify-between text-xs"><span className="font-medium text-gray-600">{day.date}</span><span className="text-indigo-500">{day.games}g</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-400">Bet</span><span className="font-semibold text-blue-600">{fmtBirr(day.totalBet)}</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-400">Prize</span><span className="font-semibold text-amber-600">{fmtBirr(day.totalPrize)}</span></div>
                            <div className="flex justify-between text-xs"><span className="text-gray-400">Profit</span><span className="font-semibold text-red-600">{fmtBirr(day.houseCut)}</span></div>
                          </div>
                        ))}
                        <MobileTotals label={`${cfg.label} Total`} row={grp} highlight />
                      </div>
                    ))}
                    <MobileTotals label="GRAND TOTAL" row={grandTotal} />
                  </div>
                  <table className="w-full text-sm hidden sm:table">
                    <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                      <tr>{TH.map((h,i)=><th key={h} className={`px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide ${TA[i]}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {groups.map((grp, gi) => (
                        <React.Fragment key={gi}>
                          <tr className="gh" style={{ background: '#eff6ff', borderTop: '2px solid #bfdbfe' }}>
                            <td colSpan={5} className="px-5 py-2 text-xs font-bold text-blue-700">{grp.label}</td>
                          </tr>
                          {grp.days.map((day, di) => <DayTr key={di} row={day} indent />)}
                          <tr className="gt" style={{ background: '#fef9c3', borderTop: '1px solid #fde68a' }}>
                            <td className="px-5 py-2.5 text-xs font-black text-yellow-800">{cfg.label} Total</td>
                            <td className="px-5 py-2.5 text-center text-xs font-black text-indigo-600">{grp.games}</td>
                            <td className="px-5 py-2.5 text-right text-xs font-black text-blue-600">{fmtBirr(grp.totalBet)}</td>
                            <td className="px-5 py-2.5 text-right text-xs font-black text-amber-600">{fmtBirr(grp.totalPrize)}</td>
                            <td className="px-5 py-2.5 text-right text-xs font-black text-red-600">{fmtBirr(grp.houseCut)}</td>
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot><GrandTotalTr row={grandTotal} /></tfoot>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────
const DayTr: React.FC<{ row: DayRow; indent: boolean }> = ({ row, indent }) => (
  <tr className="dr hover:bg-gray-50/50 border-b border-gray-50">
    <td className={`${indent ? 'pl-10 pr-5' : 'px-5'} py-2.5 text-xs text-gray-500 whitespace-nowrap`}>{row.date}</td>
    <td className="px-5 py-2.5 text-center"><span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-indigo-50 text-indigo-500 border border-indigo-100">{row.games}</span></td>
    <td className="px-5 py-2.5 text-right text-xs text-blue-500">{fmtBirr(row.totalBet)}</td>
    <td className="px-5 py-2.5 text-right text-xs text-amber-500">{fmtBirr(row.totalPrize)}</td>
    <td className="px-5 py-2.5 text-right text-xs text-red-500">{fmtBirr(row.houseCut)}</td>
  </tr>
);

const GrandTotalTr: React.FC<{ row: { games: number; totalBet: number; totalPrize: number; houseCut: number } }> = ({ row }) => (
  <tr className="border-t-2 border-gray-300 bg-gray-100">
    <td className="px-5 py-3 text-xs font-black text-gray-700">GRAND TOTAL</td>
    <td className="px-5 py-3 text-center text-xs font-black text-indigo-600">{row.games}</td>
    <td className="px-5 py-3 text-right text-xs font-black text-blue-600">{fmtBirr(row.totalBet)}</td>
    <td className="px-5 py-3 text-right text-xs font-black text-amber-600">{fmtBirr(row.totalPrize)}</td>
    <td className="px-5 py-3 text-right text-xs font-black text-red-600">{fmtBirr(row.houseCut)}</td>
  </tr>
);

const MobileTotals: React.FC<{ label: string; row: { games: number; totalBet: number; totalPrize: number; houseCut: number }; highlight?: boolean }> = ({ label, row, highlight }) => (
  <div className={`px-4 py-3 space-y-1.5 ${highlight ? 'bg-yellow-50' : 'bg-gray-50'}`}>
    <div className="flex justify-between text-xs font-black"><span className={highlight ? 'text-yellow-800' : 'text-gray-600'}>{label}</span><span className="text-indigo-600">{row.games} games</span></div>
    <div className="flex justify-between text-xs"><span className="text-gray-400">Bet</span><span className="font-black text-blue-600">{fmtBirr(row.totalBet)}</span></div>
    <div className="flex justify-between text-xs"><span className="text-gray-400">Prize</span><span className="font-black text-amber-600">{fmtBirr(row.totalPrize)}</span></div>
    <div className="flex justify-between text-xs"><span className="text-gray-400">Profit</span><span className="font-black text-red-600">{fmtBirr(row.houseCut)}</span></div>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
export const AdminBalancePage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [topUpUser, setTopUpUser] = useState<UserRecord | null>(null);
  const [amount, setAmount] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: allUsers = [], isLoading: loadingUsers } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then(r => r.data.data),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const { data: todayGames = [], isLoading: loadingToday } = useQuery<Game[]>({
    queryKey: ['games-today'],
    queryFn: () => gameApi.list(undefined, 'today').then(r => r.data.data),
    staleTime: 30_000, refetchInterval: 60_000,
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

  const todayProfitMap = todayGames.reduce<Record<string, { games: number; totalBet: number; profit: number }>>((acc, g) => {
    const uid = g.creatorId;
    if (!acc[uid]) acc[uid] = { games: 0, totalBet: 0, profit: 0 };
    acc[uid].games += 1; acc[uid].totalBet += Number(g.totalBets); acc[uid].profit += Number(g.houseCut);
    return acc;
  }, {});

  const prepaidUsers = allUsers.filter(u => u.paymentType === 'prepaid');
  const postpaidUsers = allUsers.filter(u => u.paymentType === 'postpaid');
  const totalBalance = prepaidUsers.reduce((s, u) => s + Number(u.balance), 0);
  const todayTotalProfit = Object.values(todayProfitMap).reduce((s, v) => s + v.profit, 0);
  const rows = allUsers.filter(u => u.role !== 'admin')
    .map(u => ({ ...u, today: todayProfitMap[u.id] ?? { games: 0, totalBet: 0, profit: 0 } }))
    .sort((a, b) => b.today.profit - a.today.profit);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: 'Prepaid Users', value: String(prepaidUsers.length), color: 'from-violet-500 to-violet-600' },
          { label: 'Postpaid Users', value: String(postpaidUsers.length), color: 'from-orange-500 to-orange-600' },
          { label: 'Total Prepaid Balance', value: fmtBirr(totalBalance), color: 'from-blue-500 to-blue-600' },
          { label: "Today's Total Profit", value: fmtBirr(todayTotalProfit), color: 'from-emerald-500 to-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-gradient-to-br ${color} rounded-2xl p-3 sm:p-4`}>
            <div className="text-base sm:text-xl font-black text-white leading-tight break-words">{value}</div>
            <div className="text-xs text-white/75 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm sm:text-base">All Users — Daily Profit</h2>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        {loadingUsers || loadingToday ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <>
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-gray-50">
              {rows.map(u => (
                <div key={u.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setSelectedUser(u)} className="flex items-center gap-2 group">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">{u.username[0].toUpperCase()}</div>
                      <span className="font-semibold text-blue-600 group-hover:underline text-sm">{u.username}</span>
                    </button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>{u.paymentType}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    {u.paymentType === 'prepaid' && <span className="text-emerald-600 font-semibold">{fmtBirr(Number(u.balance))}</span>}
                    {u.today.games > 0 && <span className="text-indigo-600 font-medium">{u.today.games} games</span>}
                    {u.today.totalBet > 0 && <span className="text-blue-600 font-medium">{fmtBirr(u.today.totalBet)}</span>}
                    {u.today.profit > 0 && <span className="font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{fmtBirr(u.today.profit)}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setSelectedUser(u)} className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 font-medium">Report</button>
                    {u.paymentType === 'prepaid' && <button onClick={() => { setTopUpUser(u); setAmount(''); setSuccessMsg(''); }} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium">Top Up</button>}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50">
                    {['Username','Type','Balance','Games Today','Bet Today',"Today's Profit",'Actions'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <button onClick={() => setSelectedUser(u)} className="flex items-center gap-2.5 group">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">{u.username[0].toUpperCase()}</div>
                          <span className="font-semibold text-blue-600 group-hover:underline text-sm">{u.username}</span>
                        </button>
                      </td>
                      <td className="px-5 py-3.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>{u.paymentType}</span></td>
                      <td className="px-5 py-3.5 font-semibold text-emerald-600 text-xs">{u.paymentType === 'prepaid' ? fmtBirr(Number(u.balance)) : '—'}</td>
                      <td className="px-5 py-3.5 text-center">{u.today.games > 0 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">{u.today.games}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                      <td className="px-5 py-3.5 text-xs font-medium text-blue-600">{u.today.totalBet > 0 ? fmtBirr(u.today.totalBet) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-3.5">{u.today.profit > 0 ? <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{fmtBirr(u.today.profit)}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setSelectedUser(u)} className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 transition-colors font-medium">Report</button>
                          {u.paymentType === 'prepaid' && <button onClick={() => { setTopUpUser(u); setAmount(''); setSuccessMsg(''); }} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 transition-colors font-medium">Top Up</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Top-up modal */}
      {topUpUser && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setTopUpUser(null)}>
          <div className="bg-white w-full sm:max-w-sm shadow-2xl p-5 sm:p-6" style={{ borderRadius: '16px 16px 0 0' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Add Balance</h3>
              <button onClick={() => setTopUpUser(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white text-sm font-bold shrink-0">{topUpUser.username[0].toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{topUpUser.username}</div>
                <div className="text-xs text-gray-400">Current: {fmtBirr(Number(topUpUser.balance))}</div>
              </div>
            </div>
            <input type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (Birr)"
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" autoFocus />
            {amount && parseFloat(amount) > 0 && <div className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">New balance: {fmtBirr(Number(topUpUser.balance) + parseFloat(amount))}</div>}
            {successMsg && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{successMsg}</div>}
            <button onClick={() => topUpMutation.mutate()} disabled={!amount || parseFloat(amount) <= 0 || topUpMutation.isPending}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
            </button>
          </div>
        </div>
      )}

      {selectedUser && <UserReportPanel user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
};
