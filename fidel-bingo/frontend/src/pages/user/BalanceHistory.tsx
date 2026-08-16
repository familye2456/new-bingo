import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineGameApi, offlineUserApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';

interface GameHistory {
  id: string; gameNumber?: number; status: string; betAmount: number;
  totalBets: number; prizePool: number; houseCut: number; cartelaCount: number;
  winPattern: string; isWinner: boolean; winnerIds: string[]; createdAt: string;
}

interface TxRecord {
  id: string; transactionType: string; status: string;
  amount: number; description?: string; createdAt: string; gameId?: string;
}

const TX_LABEL: Record<string, { label: string; sign: string; color: string }> = {
  deposit:    { label: 'Top-up',    sign: '+', color: '#4ade80' },
  withdrawal: { label: 'Deduction', sign: '-', color: '#f87171' },
  win:        { label: 'Win',       sign: '+', color: '#4ade80' },
  bet:        { label: 'House Fee', sign: '-', color: '#f87171' },
  bonus:      { label: 'Bonus',     sign: '+', color: '#fbbf24' },
  refund:     { label: 'Refund',    sign: '+', color: '#a78bfa' },
  house_cut:  { label: 'House Cut', sign: '-', color: '#f87171' },
};

const fmt = (d: string) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

type Tab = 'transactions' | 'games';

export const BalanceHistory: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('transactions');

  const { data: transactions = [], isLoading: txLoading } = useQuery<TxRecord[]>({
    queryKey: ['my-transactions'],
    queryFn: () => offlineUserApi.myTransactions(),
    refetchInterval: 30_000,
  });

  const { data: games = [], isLoading: gamesLoading } = useQuery<GameHistory[]>({
    queryKey: ['my-games'],
    queryFn: () => offlineGameApi.myGames() as Promise<GameHistory[]>,
  });

  const activeGames = games.filter(g => g.status === 'active');

  const finishAllMutation = useMutation({
    mutationFn: async () => {
      for (const g of activeGames) await offlineGameApi.finish(g.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-games'] }),
  });

  // Sort transactions newest-first, filter out internal alerts
  const visibleTx = [...transactions]
    .filter(t => t.description !== 'NEGATIVE_BALANCE_ALERT')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const sortedGames = [...games].sort((a, b) => (b.gameNumber ?? 0) - (a.gameNumber ?? 0));

  // Balance summary from transactions
  const totalDeposited = visibleTx
    .filter(t => t.transactionType === 'deposit' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalWon = visibleTx
    .filter(t => t.transactionType === 'win' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalBet = visibleTx
    .filter(t => t.transactionType === 'bet' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalBonus = visibleTx
    .filter(t => t.transactionType === 'bonus' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="h-full overflow-auto" style={{ background: '#0b1120', scrollbarWidth: 'none' }}>
      <div className="px-4 sm:px-5 pt-5 pb-4 space-y-4">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-white">Balance History</h1>
          <div className="flex items-center gap-2">
            {activeGames.length > 0 && (
              <button
                onClick={() => finishAllMutation.mutate()}
                disabled={finishAllMutation.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                {finishAllMutation.isPending ? 'Finishing…' : `Finish All (${activeGames.length})`}
              </button>
            )}
            <div className="font-bold px-4 py-1.5 rounded-xl text-sm"
              style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>
              {Number(user?.balance ?? 0).toFixed(2)} Birr
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Deposited', value: totalDeposited, color: '#4ade80' },
            { label: 'Total Won',       value: totalWon,       color: '#60a5fa' },
            { label: 'House Fees Paid', value: totalBet,       color: '#f87171' },
            { label: 'Bonuses',         value: totalBonus,     color: '#fbbf24' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl px-4 py-3"
              style={{ background: '#131b2e', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs mb-1" style={{ color: '#4b5563' }}>{label}</div>
              <div className="font-bold text-base" style={{ color }}>
                {value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-xs ml-1" style={{ color: `${color}60` }}>Birr</span>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', width: 'fit-content' }}>
          {(['transactions', 'games'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize"
              style={tab === t
                ? { background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }
                : { color: '#6b7280' }}>
              {t}
            </button>
          ))}
        </div>

        {/* Transactions tab */}
        {tab === 'transactions' && (
          txLoading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>
          ) : visibleTx.length === 0 ? (
            <div className="text-center py-12 text-gray-600 text-sm">No transactions yet.</div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#0d1424', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      {['Date', 'Type', 'Amount', 'Description', 'Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                          style={{ color: '#1f2937' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTx.map((tx, i) => {
                      const meta = TX_LABEL[tx.transactionType] ?? { label: tx.transactionType, sign: '', color: '#9ca3af' };
                      return (
                        <tr key={tx.id}
                          style={{ background: i % 2 === 0 ? '#131b2e' : '#0f1628', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#6b7280' }}>{fmt(tx.createdAt)}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                              style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30` }}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-sm" style={{ color: meta.color }}>
                            {meta.sign}{Number(tx.amount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: '#6b7280' }}>
                            {tx.description ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs" style={{ color: tx.status === 'completed' ? '#4ade80' : '#fbbf24' }}>
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="sm:hidden divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {visibleTx.map(tx => {
                  const meta = TX_LABEL[tx.transactionType] ?? { label: tx.transactionType, sign: '', color: '#9ca3af' };
                  return (
                    <div key={tx.id} className="px-4 py-3 flex items-center justify-between gap-3"
                      style={{ background: '#131b2e' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: `${meta.color}18`, color: meta.color }}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="text-xs truncate" style={{ color: '#4b5563' }}>
                          {tx.description ?? fmt(tx.createdAt)}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: '#374151' }}>{fmt(tx.createdAt)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-base" style={{ color: meta.color }}>
                          {meta.sign}{Number(tx.amount).toFixed(2)}
                        </div>
                        <div className="text-xs" style={{ color: '#374151' }}>Birr</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* Games tab */}
        {tab === 'games' && (
          gamesLoading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>
          ) : sortedGames.length === 0 ? (
            <div className="text-center py-12 text-gray-600 text-sm">No games played yet.</div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#0d1424', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      {['#', 'Date', 'Cartelas', 'Total Bet', 'House Fee', 'Prize', 'Result'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                          style={{ color: '#1f2937' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGames.map((g, i) => {
                      const won = g.isWinner;
                      const prize = Number(g.prizePool ?? 0);
                      return (
                        <tr key={g.id}
                          style={{ background: i % 2 === 0 ? '#131b2e' : '#0f1628', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td className="px-4 py-3 font-mono text-xs" style={{ color: '#6b7280' }}>
                            #{g.gameNumber ?? (i + 1)}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#6b7280' }}>
                            {fmt(g.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-sm" style={{ color: '#9ca3af' }}>{g.cartelaCount}</td>
                          <td className="px-4 py-3 font-semibold text-sm" style={{ color: '#34d399' }}>
                            {Number(g.totalBets).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm" style={{ color: '#f87171' }}>
                            {Number(g.houseCut).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-sm">
                            {won
                              ? <span style={{ color: '#60a5fa' }}>+{prize.toFixed(2)}</span>
                              : <span style={{ color: '#374151' }}>—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                              style={
                                g.status === 'finished'
                                  ? { background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }
                                  : g.status === 'active'
                                  ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                                  : { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
                              }>
                              {g.status === 'active' ? 'Active' : g.status === 'finished' ? 'Finished' : g.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile games */}
              <div className="sm:hidden divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {sortedGames.map((g, i) => {
                  const won = g.isWinner;
                  const prize = Number(g.prizePool ?? 0);
                  return (
                    <div key={g.id} className="px-4 py-3" style={{ background: '#131b2e' }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-xs" style={{ color: '#6b7280' }}>#{g.gameNumber ?? (i + 1)}</span>
                        <span className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                          style={g.status === 'active'
                            ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                            : { background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }}>
                          {g.status}
                        </span>
                      </div>
                      <div className="text-xs mb-2" style={{ color: '#4b5563' }}>{fmt(g.createdAt)}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div style={{ color: '#374151' }}>Total Bet</div>
                          <div className="font-bold" style={{ color: '#34d399' }}>{Number(g.totalBets).toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ color: '#374151' }}>House Fee</div>
                          <div className="font-bold" style={{ color: '#f87171' }}>{Number(g.houseCut).toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ color: '#374151' }}>Result</div>
                          <div className="font-bold" style={{ color: won ? '#60a5fa' : '#374151' }}>
                            {won ? `+${prize.toFixed(2)}` : 'Loss'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};
