import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../services/api';

interface UserRecord {
  id: string; username: string; email: string;
  paymentType: 'prepaid' | 'postpaid'; balance: number; status: string;
}

const inputCls = "border border-gray-200 rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors";

export const PackageManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: allUsers = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const prepaidUsers = allUsers.filter((u) => u.paymentType === 'prepaid');
  const selectedUser = prepaidUsers.find((u) => u.id === selectedUserId) ?? null;

  const topUpMutation = useMutation({
    mutationFn: () => adminApi.topUpBalance(selectedUserId, parseFloat(amount)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      const newBal = (Number(selectedUser?.balance ?? 0) + parseFloat(amount)).toFixed(2);
      setSuccessMsg(`Balance updated. New balance: $${newBal}`);
      setAmount('');
      setTimeout(() => setSuccessMsg(''), 4000);
    },
  });

  const canSubmit = selectedUserId && amount && parseFloat(amount) > 0 && !topUpMutation.isPending;
  const totalPrepaidBalance = prepaidUsers.reduce((s, u) => s + Number(u.balance), 0);

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Prepaid Users', value: prepaidUsers.length, color: 'from-violet-500 to-violet-600' },
          { label: 'Active Prepaid', value: prepaidUsers.filter(u => u.status === 'active').length, color: 'from-emerald-500 to-emerald-600' },
          { label: 'Total Balance', value: `$${totalPrepaidBalance.toFixed(2)}`, color: 'from-blue-500 to-blue-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-gradient-to-br ${color} rounded-2xl p-5`}>
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-sm text-white/80 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top-up form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Add Balance</h2>
          <p className="text-sm text-gray-400 mb-5">Top up a prepaid user's account balance.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Select User</label>
              {isLoading ? (
                <div className="text-sm text-gray-400 py-2">Loading users...</div>
              ) : prepaidUsers.length === 0 ? (
                <div className="text-sm text-gray-400 py-2">No prepaid users found.</div>
              ) : (
                <select
                  value={selectedUserId}
                  onChange={(e) => { setSelectedUserId(e.target.value); setAmount(''); setSuccessMsg(''); }}
                  className={inputCls}
                >
                  <option value="">— Select a prepaid user —</option>
                  {prepaidUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.email})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedUser && (
              <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{selectedUser.username}</div>
                    <div className="text-xs text-gray-400">{selectedUser.email}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">Current balance</div>
                  <div className="text-lg font-bold text-emerald-600">${Number(selectedUser.balance).toFixed(2)}</div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount ($)</label>
              <input
                type="number" min="0.01" step="0.01" value={amount}
                onChange={(e) => { setAmount(e.target.value); setSuccessMsg(''); }}
                placeholder="0.00" className={inputCls}
              />
            </div>

            {selectedUser && amount && parseFloat(amount) > 0 && (
              <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
                New balance will be: <strong>${(Number(selectedUser.balance) + parseFloat(amount)).toFixed(2)}</strong>
              </div>
            )}

            <button
              onClick={() => topUpMutation.mutate()}
              disabled={!canSubmit}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
            </button>

            {successMsg && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {successMsg}
              </div>
            )}
            {topUpMutation.isError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                Failed to add balance. Please try again.
              </div>
            )}
          </div>
        </div>

        {/* Prepaid users table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Prepaid Users</h2>
          </div>
          {prepaidUsers.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No prepaid users.</div>
          ) : (
            <div className="overflow-y-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-100">
                  <tr>
                    {['User', 'Status', 'Balance'].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {prepaidUsers.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => { setSelectedUserId(u.id); setAmount(''); setSuccessMsg(''); }}
                      className={`cursor-pointer transition-colors ${selectedUserId === u.id ? 'bg-violet-50' : 'hover:bg-gray-50/50'}`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {u.username[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-gray-800 text-xs">{u.username}</div>
                            <div className="text-[11px] text-gray-400 truncate max-w-[120px]">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-emerald-600">${Number(u.balance).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
