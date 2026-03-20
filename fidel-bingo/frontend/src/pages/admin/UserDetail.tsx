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
interface CartelaRecord { id: string; cardNumber?: number; isActive: boolean; assignedAt: string; }
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
    <div className="p-6 max-w-5xl space-y-5">
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
      <div className="flex gap-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5 w-fit">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${
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
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={2000} placeholder="Card number (1–2000)"
                value={cardNumber}
                onChange={(e) => { setCardNumber(e.target.value); setAssignError(''); }}
                className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
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

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Assigned Cards</span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{cartelas.length}</span>
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
                    <span className="font-bold text-gray-900 text-sm">#{c.cardNumber ?? '?'}</span>
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
            <table className="w-full text-sm">
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
  );
};
