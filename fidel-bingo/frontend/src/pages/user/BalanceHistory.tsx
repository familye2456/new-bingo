import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface Transaction {
  id: string;
  transactionType: string;
  amount: number;
  status: string;
  description?: string;
  createdAt: string;
}

const typeStyle: Record<string, string> = {
  deposit: 'bg-green-100 text-green-700',
  win:     'bg-yellow-100 text-yellow-700',
  bet:     'bg-red-100 text-red-600',
  withdrawal: 'bg-orange-100 text-orange-700',
  refund:  'bg-blue-100 text-blue-700',
  house_cut: 'bg-gray-100 text-gray-500',
};

const typeSign: Record<string, string> = {
  deposit: '+', win: '+', refund: '+',
  bet: '-', withdrawal: '-', house_cut: '-',
};

export const BalanceHistory: React.FC = () => {
  const { user } = useAuthStore();
  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['my-transactions'],
    queryFn: () => userApi.myTransactions().then((r) => r.data.data),
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Balance History</h1>
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm">
          Current balance: <span className="font-bold text-green-600">${Number(user?.balance ?? 0).toFixed(2)}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        {isLoading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : txs.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">No transactions yet.</div>
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
              {txs.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${typeStyle[tx.transactionType] ?? 'bg-gray-100 text-gray-500'}`}>
                      {tx.transactionType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-semibold ${
                    (typeSign[tx.transactionType] ?? '+') === '+' ? 'text-green-600' : 'text-red-500'
                  }`}>
                    {typeSign[tx.transactionType] ?? '+'}{Number(tx.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      tx.status === 'completed' ? 'bg-green-100 text-green-700' :
                      tx.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-600'
                    }`}>{tx.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{tx.description ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
