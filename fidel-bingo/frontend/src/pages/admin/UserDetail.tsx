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

const TX_COLOR: Record<string, string> = {
  win: 'text-green-600', bet: 'text-red-500',
  deposit: 'text-blue-600', withdrawal: 'text-orange-500',
  refund: 'text-purple-600', house_cut: 'text-gray-500',
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
    onSuccess: () => {
      setCardNumber(''); setAssignError('');
      qc.invalidateQueries({ queryKey: ['user-cartelas', id] });
    },
    onError: (e: any) => setAssignError(e?.response?.data?.error?.message ?? 'Assignment failed'),
  });

  const unassignMutation = useMutation({
    mutationFn: (cartelaId: string) => cartelaAdminApi.unassign(cartelaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-cartelas', id] }),
  });

  // Report stats derived from transactions
  const totalBet = transactions.filter(t => t.transactionType === 'bet').reduce((s, t) => s + Number(t.amount), 0);
  const totalWin = transactions.filter(t => t.transactionType === 'win').reduce((s, t) => s + Number(t.amount), 0);
  const totalDeposit = transactions.filter(t => t.transactionType === 'deposit').reduce((s, t) => s + Number(t.amount), 0);
  const gamesPlayed = new Set(transactions.filter(t => t.gameId).map(t => t.gameId)).size;

  if (loadingUser) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!user) return <div className="p-8 text-red-500">User not found.</div>;

  return (
    <div className="p-6 max-w-4xl">
      {/* Back + header */}
      <button onClick={() => navigate('/admin/users')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
        ← Back to Users
      </button>

      <div className="bg-white rounded-2xl shadow p-5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-800 text-lg">{user.username}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {user.status}
          </span>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${user.paymentType === 'prepaid' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
            {user.paymentType}
          </span>
          {user.paymentType === 'prepaid' && (
            <span className="text-green-700 font-semibold">${Number(user.balance).toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {(['cartelas', 'transactions', 'report'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'cartelas' ? '🎴 Assign Cartela' : t === 'transactions' ? '💳 Transactions' : '📊 Report'}
          </button>
        ))}
      </div>

      {/* ── Cartelas tab ── */}
      {tab === 'cartelas' && (
        <div className="space-y-4">
          {/* Assign form */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="font-medium text-gray-700 mb-3">Assign a card to {user.username}</div>
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={2000} placeholder="Card number (1–2000)"
                value={cardNumber}
                onChange={(e) => { setCardNumber(e.target.value); setAssignError(''); }}
                className="border rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => assignMutation.mutate()}
                disabled={!cardNumber || assignMutation.isPending}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {assignMutation.isPending ? 'Assigning...' : 'Assign'}
              </button>
            </div>
            {assignError && <p className="text-xs text-red-500 mt-2">{assignError}</p>}
          </div>

          {/* Assigned cards list */}
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-5 py-3 border-b text-sm font-medium text-gray-600">
              Assigned Cards ({cartelas.length})
            </div>
            {loadingCartelas ? (
              <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>
            ) : cartelas.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">No cartelas assigned yet.</div>
            ) : (
              <div className="flex flex-wrap gap-3 p-5">
                {cartelas.map((c) => (
                  <div key={c.id}
                    className="flex flex-col items-center gap-1 bg-gradient-to-b from-yellow-400 to-yellow-500 rounded-xl px-3 py-2 shadow-sm">
                    <span className="font-bold text-gray-900 text-sm">#{c.cardNumber ?? '?'}</span>
                    <button
                      onClick={() => unassignMutation.mutate(c.id)}
                      disabled={unassignMutation.isPending}
                      className="text-[10px] text-red-700 hover:text-red-900 disabled:opacity-50">
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Transactions tab ── */}
      {tab === 'transactions' && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {loadingTx ? (
            <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No transactions yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Type', 'Amount', 'Status', 'Description', 'Date'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`font-medium capitalize ${TX_COLOR[tx.transactionType] ?? 'text-gray-700'}`}>
                        {tx.transactionType.replace('_', ' ')}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-semibold ${TX_COLOR[tx.transactionType] ?? 'text-gray-700'}`}>
                      {['bet', 'withdrawal'].includes(tx.transactionType) ? '-' : '+'}${Number(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${tx.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[180px]">{tx.description ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(tx.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Report tab ── */}
      {tab === 'report' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Games Played', value: gamesPlayed, color: 'text-blue-600' },
              { label: 'Total Bet', value: `$${totalBet.toFixed(2)}`, color: 'text-red-500' },
              { label: 'Total Won', value: `$${totalWin.toFixed(2)}`, color: 'text-green-600' },
              { label: 'Total Deposited', value: `$${totalDeposit.toFixed(2)}`, color: 'text-purple-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl shadow p-5">
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="font-medium text-gray-700 mb-3 text-sm">Net P&L</div>
            <div className={`text-3xl font-bold ${totalWin - totalBet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {totalWin - totalBet >= 0 ? '+' : ''}${(totalWin - totalBet).toFixed(2)}
            </div>
            <div className="text-xs text-gray-400 mt-1">Total won minus total bet</div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="font-medium text-gray-700 mb-3 text-sm">Assigned Cartelas</div>
            <div className="text-3xl font-bold text-yellow-500">{cartelas.length}</div>
          </div>

          <div className="bg-white rounded-xl shadow p-5 text-sm text-gray-500">
            Member since {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
          </div>
        </div>
      )}
    </div>
  );
};
