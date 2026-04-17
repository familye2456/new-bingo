import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, cartelaAdminApi } from '../../services/api';

type Tab = 'cartelas' | 'transactions' | 'report';

interface UserRecord {
  id: string; username: string; email: string;
  status: string; paymentType: 'prepaid' | 'postpaid';
  balance: number; createdAt: string;
}
interface CartelaRecord { id: string; cardNumber?: number; isActive: boolean; assignedAt: string; numbers?: number[]; }
interface TxRecord {
  id: string; transactionType: string; status: string;
  amount: number; description?: string; createdAt: string; gameId?: string;
}

const TX_STYLES: Record<string, { color: string; bg: string; sign: string }> = {
  win:        { color: 'text-emerald-600', bg: 'bg-emerald-100', sign: '+' },
  bet:        { color: 'text-red-500',     bg: 'bg-red-100',     sign: '-' },
  deposit:    { color: 'text-blue-600',    bg: 'bg-blue-100',    sign: '+' },
  withdrawal: { color: 'text-orange-500',  bg: 'bg-orange-100',  sign: '-' },
  refund:     { color: 'text-purple-600',  bg: 'bg-purple-100',  sign: '+' },
  house_cut:  { color: 'text-gray-500',    bg: 'bg-gray-100',    sign: '-' },
};

export const UserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('cartelas');
  const [cardNumber, setCardNumber] = useState('');
  const [assignError, setAssignError] = useState('');
  const [copyFromUserId, setCopyFromUserId] = useState('');
  const [copyResult, setCopyResult] = useState<{ copied: number; total: number } | null>(null);
  const [viewCartela, setViewCartela] = useState<CartelaRecord | null>(null);

  const { data: user, isLoading: loadingUser } = useQuery<UserRecord>({
    queryKey: ['admin-user', id],
    queryFn: () => adminApi.getUser(id!).then((r) => r.data.data),
    enabled: !!id,
  });

  const { data: cartelas = [], isLoading: loadingCartelas } = useQuery<CartelaRecord[]>({
    queryKey: ['user-cartelas', id],
    queryFn: () => adminApi.getUserCartelas(id!).then((r) => r.data.data),
    enabled: !!id && (tab === 'cartelas' || tab === 'report'),
  });

  const { data: transactions = [], isLoading: loadingTx } = useQuery<TxRecord[]>({
    queryKey: ['user-transactions', id],
    queryFn: () => adminApi.getUserTransactions(id!).then((r) => r.data.data),
    enabled: !!id && (tab === 'transactions' || tab === 'report'),
  });

  const assignMutation = useMutation({
    mutationFn: () => cartelaAdminApi.assign({ userId: id!, cardNumber: parseInt(cardNumber, 10) }),
    onSuccess: () => { setCardNumber(''); setAssignError(''); qc.invalidateQueries({ queryKey: ['user-cartelas', id] }); },
    onError: (e: any) => setAssignError(e?.response?.data?.error?.message ?? 'Assignment failed'),
  });

  const unassignMutation = useMutation({
    mutationFn: (cartelaId: string) => cartelaAdminApi.unassign(cartelaId, id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-cartelas', id] }),
  });

  const { data: allUsers = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const copyMutation = useMutation({
    mutationFn: () => cartelaAdminApi.copyFrom(copyFromUserId, id!),
    onSuccess: (res) => {
      setCopyResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['user-cartelas', id] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => cartelaAdminApi.clearAll(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-cartelas', id] }),
  });

  const totalBet     = transactions.filter(t => t.transactionType === 'bet').reduce((s, t) => s + Number(t.amount), 0);
  const totalWin     = transactions.filter(t => t.transactionType === 'win').reduce((s, t) => s + Number(t.amount), 0);
  const totalDeposit = transactions.filter(t => t.transactionType === 'deposit').reduce((s, t) => s + Number(t.amount), 0);
  const gamesPlayed  = new Set(transactions.filter(t => t.gameId).map(t => t.gameId)).size;
  const netPnl       = totalWin - totalBet;

  if (loadingUser) return (
    <div className="p-8 flex items-center justify-center text-gray-400 text-sm">
      <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Loading...
    </div>
  );
  if (!user) return <div className="p-8 text-red-500 text-sm">User not found.</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'cartelas', label: 'Cartelas' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'report', label: 'Report' },
  ];

  return (
    <>
    <div className="p-4 sm:p-6 max-w-5xl space-y-5">
      {/* Back */}
      <button onClick={() => navigate('/admin/users')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Users
      </button>

      {/* Profile card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-xl">
              {user.username[0].toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-gray-900 text-lg">{user.username}</div>
              <div className="text-sm text-gray-400">{user.email}</div>
              <div className="text-xs text-gray-300 mt-0.5">
                Member since {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${user.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
              {user.status}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${user.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>
              {user.paymentType}
            </span>
            {user.paymentType === 'prepaid' && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ${Number(user.balance).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5 w-full sm:w-fit overflow-x-auto">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              tab === key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Cartelas tab */}
      {tab === 'cartelas' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="font-medium text-gray-700 mb-3 text-sm">Assign a card to {user.username}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="number" min={1} max={2000} placeholder="Card number (1–2000)"
                value={cardNumber}
                onChange={(e) => { setCardNumber(e.target.value); setAssignError(''); }}
                className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              />
              <button
                onClick={() => assignMutation.mutate()}
                disabled={!cardNumber || assignMutation.isPending}
                className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {assignMutation.isPending ? 'Assigning...' : 'Assign'}
              </button>
            </div>
            {assignError && <p className="text-xs text-red-500 mt-2">{assignError}</p>}
          </div>

          {/* Copy from user */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="font-medium text-gray-700 mb-1 text-sm">Copy cartelas from another user</div>
            <p className="text-xs text-gray-400 mb-3">All cartelas assigned to the selected user will be copied to {user.username}.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={copyFromUserId}
                onChange={(e) => { setCopyFromUserId(e.target.value); setCopyResult(null); }}
                className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400">
                <option value="">— select source user —</option>
                {allUsers.filter(u => u.id !== id).map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
              <button
                onClick={() => { setCopyResult(null); copyMutation.mutate(); }}
                disabled={!copyFromUserId || copyMutation.isPending}
                className="bg-purple-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copyMutation.isPending ? 'Copying...' : 'Copy'}
              </button>
            </div>
            {copyResult && (
              <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {copyResult.copied} new cartelas copied ({copyResult.total - copyResult.copied} already assigned).
              </div>
            )}
            {copyMutation.isError && (
              <p className="text-xs text-red-500 mt-2">{(copyMutation.error as any)?.response?.data?.error?.message ?? 'Copy failed'}</p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Assigned Cards</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{cartelas.length}</span>
                {cartelas.length > 0 && (
                  <button
                    onClick={() => { if (window.confirm(`Remove all ${cartelas.length} cartelas from ${user.username}?`)) clearAllMutation.mutate(); }}
                    disabled={clearAllMutation.isPending}
                    className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50">
                    {clearAllMutation.isPending ? 'Clearing...' : 'Clear All'}
                  </button>
                )}
              </div>
            </div>
            {loadingCartelas ? (
              <div className="py-10 text-center text-gray-400 text-sm">Loading...</div>
            ) : cartelas.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No cartelas assigned yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2.5 p-5">
                {cartelas.map((c) => (
                  <div key={c.id}
                    className="flex flex-col items-center gap-1 bg-gradient-to-b from-yellow-400 to-yellow-500 rounded-xl px-3.5 py-2.5 shadow-sm min-w-[56px]">
                    <button
                      onClick={() => setViewCartela(c)}
                      className="font-bold text-gray-900 text-sm hover:underline">
                      #{c.cardNumber ?? '?'}
                    </button>
                    <button
                      onClick={() => unassignMutation.mutate(c.id)}
                      disabled={unassignMutation.isPending}
                      className="text-[10px] text-red-700 hover:text-red-900 disabled:opacity-50 font-medium">
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transactions tab */}
      {tab === 'transactions' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loadingTx ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">No transactions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[540px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Type', 'Amount', 'Status', 'Description', 'Date'].map((h) => (
                    <th key={h} className="text-left px-6 py-3.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((tx) => {
                  const style = TX_STYLES[tx.transactionType] ?? { color: 'text-gray-700', bg: 'bg-gray-100', sign: '' };
                  return (
                    <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3.5">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${style.bg} ${style.color}`}>
                          {tx.transactionType.replace('_', ' ')}
                        </span>
                      </td>
                      <td className={`px-6 py-3.5 font-semibold ${style.color}`}>
                        {style.sign}${Number(tx.amount).toFixed(2)}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${tx.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-gray-400 text-xs truncate max-w-[180px]">{tx.description ?? '—'}</td>
                      <td className="px-6 py-3.5 text-gray-400 text-xs">{new Date(tx.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Report tab */}
      {tab === 'report' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Games Played', value: gamesPlayed, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Total Bet',    value: `$${totalBet.toFixed(2)}`,     color: 'text-red-500',     bg: 'bg-red-50' },
              { label: 'Total Won',    value: `$${totalWin.toFixed(2)}`,     color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Deposited',   value: `$${totalDeposit.toFixed(2)}`, color: 'text-violet-600',  bg: 'bg-violet-50' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-2xl p-5`}>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="text-xs text-gray-400 mb-1">Net P&L</div>
              <div className={`text-3xl font-bold ${netPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
              </div>
              <div className="text-xs text-gray-400 mt-1">Won minus bet</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="text-xs text-gray-400 mb-1">Assigned Cartelas</div>
              <div className="text-3xl font-bold text-amber-500">{cartelas.length}</div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="text-xs text-gray-400 mb-1">Member Since</div>
              <div className="text-base font-semibold text-gray-700 mt-1">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Cartela detail modal */}
    {viewCartela && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        onClick={() => setViewCartela(null)}>
        <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-xs"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <span className="font-bold text-gray-900 text-base">Card #{viewCartela.cardNumber ?? '?'}</span>
            <button onClick={() => setViewCartela(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-5 gap-1 mb-1">
            {['B','I','N','G','O'].map((col) => (
              <div key={col}
                className="flex items-center justify-center rounded-lg aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">
                {col}
              </div>
            ))}
          </div>

          {/* Grid */}
          {viewCartela.numbers && viewCartela.numbers.length === 25 ? (
            <div className="grid grid-cols-5 gap-1">
              {viewCartela.numbers.map((num, idx) => (
                <div key={idx}
                  className={`flex items-center justify-center rounded-lg aspect-square text-sm font-bold ${
                    idx === 12
                      ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                  {idx === 12 ? 'FREE' : num || '?'}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-gray-400 text-sm">Grid data not available</div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => { unassignMutation.mutate(viewCartela.id); setViewCartela(null); }}
              disabled={unassignMutation.isPending}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 border border-red-200">
              Remove
            </button>
            <button onClick={() => setViewCartela(null)}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};
