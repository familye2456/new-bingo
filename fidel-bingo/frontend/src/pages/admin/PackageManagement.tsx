import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../services/api';

interface UserRecord {
  id: string;
  username: string;
  email: string;
  paymentType: 'prepaid' | 'postpaid';
  balance: number;
  status: string;
}

export const PackageManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [amount, setAmount] = useState('');

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
      setAmount('');
    },
  });

  const canSubmit = selectedUserId && amount && parseFloat(amount) > 0 && !topUpMutation.isPending;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-2">Package Management</h1>
      <p className="text-sm text-gray-500 mb-6">Add balance to prepaid users.</p>

      <div className="bg-white rounded-xl shadow p-6 max-w-md">
        {/* User selector */}
        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1" htmlFor="user-select">Prepaid User</label>
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading users...</p>
          ) : prepaidUsers.length === 0 ? (
            <p className="text-sm text-gray-400">No prepaid users found.</p>
          ) : (
            <select
              id="user-select"
              value={selectedUserId}
              onChange={(e) => { setSelectedUserId(e.target.value); setAmount(''); }}
              className="border rounded-lg px-3 py-2 w-full text-sm"
            >
              <option value="">— Select a user —</option>
              {prepaidUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.email})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Current balance */}
        {selectedUser && (
          <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-600">
            Current balance: <span className="font-semibold text-green-600">${Number(selectedUser.balance).toFixed(2)}</span>
          </div>
        )}

        {/* Amount input */}
        <div className="mb-5">
          <label className="block text-sm text-gray-600 mb-1" htmlFor="amount">Amount ($)</label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="border rounded-lg px-3 py-2 w-full text-sm"
          />
        </div>

        <button
          onClick={() => topUpMutation.mutate()}
          disabled={!canSubmit}
          className="w-full bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
        </button>

        {topUpMutation.isSuccess && (
          <p className="text-green-600 text-sm mt-3 text-center">
            Balance added successfully. New balance: <strong>${Number(selectedUser?.balance ?? 0 + parseFloat(amount || '0')).toFixed(2)}</strong>
          </p>
        )}
        {topUpMutation.isError && (
          <p className="text-red-500 text-sm mt-3 text-center">Failed to add balance. Please try again.</p>
        )}
      </div>

      {/* Prepaid users overview */}
      {prepaidUsers.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 text-gray-700">Prepaid Users Overview</h2>
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Username', 'Email', 'Status', 'Balance'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-gray-600 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {prepaidUsers.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className={`cursor-pointer hover:bg-gray-50 ${selectedUserId === u.id ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-green-700 font-medium">${Number(u.balance).toFixed(2)}</td>
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
