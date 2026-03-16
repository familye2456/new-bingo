import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, cartelaAdminApi } from '../../services/api';

interface UserRecord {
  id: string;
  username: string;
  email: string;
  status: string;
  paymentType: 'prepaid' | 'postpaid';
  balance: number;
}

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  userId?: string;
}

// Modal to assign a cartela to a user
const AssignCartelaModal: React.FC<{
  user: UserRecord;
  onClose: () => void;
  onAssigned: () => void;
}> = ({ user, onClose, onAssigned }) => {
  const [cardNumber, setCardNumber] = useState('');
  const [error, setError] = useState('');

  const assignMutation = useMutation({
    mutationFn: () => cartelaAdminApi.assign({ userId: user.id, cardNumber: parseInt(cardNumber, 10) }),
    onSuccess: () => { onAssigned(); onClose(); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Assignment failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-800 mb-1">Assign Cartela</h3>
        <p className="text-sm text-gray-500 mb-4">Assign a card number to <span className="font-medium text-gray-700">{user.username}</span></p>
        <label className="block text-xs text-gray-600 mb-1">Card Number (1–2000)</label>
        <input
          type="number" min={1} max={2000}
          value={cardNumber}
          onChange={(e) => { setCardNumber(e.target.value); setError(''); }}
          placeholder="e.g. 42"
          className="border rounded-lg px-3 py-2 w-full text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => assignMutation.mutate()}
            disabled={!cardNumber || assignMutation.isPending}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {assignMutation.isPending ? 'Assigning...' : 'Assign'}
          </button>
          <button onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-200">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

const emptyForm = { username: '', email: '', password: '', paymentType: 'prepaid' as 'prepaid' | 'postpaid' };

export const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [topUpUser, setTopUpUser] = useState<UserRecord | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [assignCartelaUser, setAssignCartelaUser] = useState<UserRecord | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => adminApi.createUser(form),
    onSuccess: () => { invalidate(); setShowCreate(false); setForm(emptyForm); },
  });

  const updateMutation = useMutation({
    mutationFn: () => adminApi.updateUser(editUser!.id, { email: form.email, username: form.username, paymentType: form.paymentType }),
    onSuccess: () => { invalidate(); setEditUser(null); setForm(emptyForm); },
  });

  const activateMutation = useMutation({ mutationFn: (id: string) => adminApi.activateUser(id), onSuccess: invalidate });
  const deactivateMutation = useMutation({ mutationFn: (id: string) => adminApi.deactivateUser(id), onSuccess: invalidate });
  const deleteMutation = useMutation({ mutationFn: (id: string) => adminApi.deleteUser(id), onSuccess: invalidate });

  const topUpMutation = useMutation({
    mutationFn: () => adminApi.topUpBalance(topUpUser!.id, parseFloat(topUpAmount)),
    onSuccess: () => { invalidate(); setTopUpUser(null); setTopUpAmount(''); },
  });

  const openEdit = (u: UserRecord) => {
    setEditUser(u); setShowCreate(false); setTopUpUser(null);
    setForm({ username: u.username, email: u.email, password: '', paymentType: u.paymentType });
  };

  const closeAll = () => {
    setShowCreate(false); setEditUser(null); setTopUpUser(null);
    setForm(emptyForm); setTopUpAmount('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">User Management</h1>
        <button onClick={() => { closeAll(); setShowCreate(true); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
          + New User
        </button>
      </div>

      {/* Create / Edit form */}
      {(showCreate || editUser) && (
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold mb-4">{editUser ? 'Edit User' : 'Create User'}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="username">Username</label>
              <input id="username" name="username" value={form.username} onChange={handleChange}
                className="border rounded-lg px-3 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" value={form.email} onChange={handleChange}
                className="border rounded-lg px-3 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="paymentType">User Type</label>
              <select id="paymentType" name="paymentType" value={form.paymentType} onChange={handleChange}
                className="border rounded-lg px-3 py-2 w-full text-sm">
                <option value="prepaid">Prepaid</option>
                <option value="postpaid">Postpaid</option>
              </select>
            </div>
            {showCreate && (
              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="password">Password</label>
                <input id="password" name="password" type="password" value={form.password} onChange={handleChange}
                  className="border rounded-lg px-3 py-2 w-full text-sm" />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => editUser ? updateMutation.mutate() : createMutation.mutate()}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
              {editUser ? 'Save Changes' : 'Create User'}
            </button>
            <button onClick={closeAll} className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-300">Cancel</button>
          </div>
        </div>
      )}

      {/* Top-up panel */}
      {topUpUser && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 border-l-4 border-green-500">
          <h3 className="font-semibold mb-1">Add Balance — {topUpUser.username}</h3>
          <p className="text-sm text-gray-500 mb-4">Current balance: <strong className="text-green-600">${Number(topUpUser.balance).toFixed(2)}</strong></p>
          <div className="flex items-end gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="topup-amount">Amount ($)</label>
              <input id="topup-amount" type="number" min="0.01" step="0.01" value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="border rounded-lg px-3 py-2 w-36 text-sm" placeholder="0.00" />
            </div>
            <button onClick={() => topUpMutation.mutate()}
              disabled={topUpMutation.isPending || !topUpAmount || parseFloat(topUpAmount) <= 0}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
              {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
            </button>
            <button onClick={closeAll} className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-300">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        {isLoading ? (
          <div className="text-center py-10 text-gray-500">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Username', 'Email', 'Type', 'Status', 'Balance', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-600 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <button
                      onClick={() => navigate(`/admin/users/${u.id}`)}
                      className="text-blue-600 hover:underline font-medium text-left">
                      {u.username}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.paymentType === 'prepaid' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
                      {u.paymentType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.paymentType === 'prepaid' ? <span className="text-green-700">${Number(u.balance).toFixed(2)}</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => openEdit(u)} className="text-blue-600 hover:underline text-xs">Edit</button>
                      {u.paymentType === 'prepaid' && (
                        <button onClick={() => { setTopUpUser(u); setEditUser(null); setShowCreate(false); }} className="text-green-600 hover:underline text-xs">+ Balance</button>
                      )}
                      {u.status === 'active'
                        ? <button onClick={() => deactivateMutation.mutate(u.id)} className="text-yellow-600 hover:underline text-xs">Deactivate</button>
                        : <button onClick={() => activateMutation.mutate(u.id)} className="text-green-600 hover:underline text-xs">Activate</button>
                      }
                      <button onClick={() => { if (window.confirm('Delete this user?')) deleteMutation.mutate(u.id); }} className="text-red-500 hover:underline text-xs">Delete</button>
                    </div>
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
