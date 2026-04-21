import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, cartelaAdminApi } from '../../services/api';
import { ALL_VOICE_CATEGORIES, VoiceCategory } from '../../store/gameSettingsStore';
import { useAuthStore } from '../../store/authStore';

interface UserRecord {
  id: string; username: string; email: string;
  status: string; paymentType: 'prepaid' | 'postpaid'; balance: number;
}

const emptyForm = { username: '', email: '', password: '', paymentType: 'prepaid' as 'prepaid' | 'postpaid', voice: 'boy sound' as VoiceCategory, role: 'player' as 'player' | 'agent' };
const emptyAgentForm = { username: '', email: '', password: '', firstName: '', lastName: '', phone: '' };
type ModalType = 'create' | 'create-agent' | 'edit' | 'topup' | 'deduct' | 'cartela' | 'assign-agent' | null;

interface CartelaRecord { id: string; cardNumber?: number; isActive: boolean; assignedAt: string; }

const inputCls = "border border-gray-200 rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors";

const ModalWrap: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);


export const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === 'admin';
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const [modal, setModal] = useState<ModalType>(null);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [topUpUser, setTopUpUser] = useState<UserRecord | null>(null);
  const [deductUser, setDeductUser] = useState<UserRecord | null>(null);
  const [cartelaUser, setCartelaUser] = useState<UserRecord | null>(null);
  const [assignAgentUser, setAssignAgentUser] = useState<UserRecord | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [assignCartelaError, setAssignCartelaError] = useState('');
  const [assignCartelaSuccess, setAssignCartelaSuccess] = useState('');
  const [removeFrom, setRemoveFrom] = useState('');
  const [removeTo, setRemoveTo] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [removeSuccess, setRemoveSuccess] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [agentForm, setAgentForm] = useState(emptyAgentForm);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [deductAmount, setDeductAmount] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'prepaid' | 'postpaid'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'suspended'>('all');

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const filtered = useMemo(() => users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !search || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchType = filterType === 'all' || u.paymentType === filterType;
    const matchStatus = filterStatus === 'all' || u.status === filterStatus;
    return matchSearch && matchType && matchStatus;
  }), [users, search, filterType, filterStatus]);

  const createMutation = useMutation({
    mutationFn: () => adminApi.createUser({ ...form, role: form.role }),
    onSuccess: (res) => {
      const username = res.data?.data?.username ?? form.username;
      if (username) localStorage.setItem(`default_voice_${username}`, form.voice);
      invalidate(); closeModal();
    },
  });

  const createAgentMutation = useMutation({
    mutationFn: () => adminApi.createUser({ ...agentForm, role: 'agent', paymentType: 'prepaid' }),
    onSuccess: () => { invalidate(); closeModal(); },
  });
  const updateMutation = useMutation({
    mutationFn: () => adminApi.updateUser(editUser!.id, { email: form.email, username: form.username, paymentType: form.paymentType }),
    onSuccess: () => { invalidate(); closeModal(); },
  });
  const activateMutation = useMutation({ mutationFn: (id: string) => adminApi.activateUser(id), onSuccess: invalidate });
  const deactivateMutation = useMutation({ mutationFn: (id: string) => adminApi.deactivateUser(id), onSuccess: invalidate });
  const deleteMutation = useMutation({ mutationFn: (id: string) => adminApi.deleteUser(id), onSuccess: invalidate });
  const topUpMutation = useMutation({
    mutationFn: () => adminApi.topUpBalance(topUpUser!.id, parseFloat(topUpAmount)),
    onSuccess: () => { invalidate(); closeModal(); },
  });
  const deductMutation = useMutation({
    mutationFn: () => adminApi.deductBalance(deductUser!.id, parseFloat(deductAmount)),
    onSuccess: () => { invalidate(); closeModal(); },
  });

  const { data: userCartelas = [], isLoading: loadingCartelas } = useQuery<CartelaRecord[]>({
    queryKey: ['user-cartelas', cartelaUser?.id],
    queryFn: () => adminApi.getUserCartelas(cartelaUser!.id).then((r) => r.data.data),
    enabled: !!cartelaUser && modal === 'cartela',
  });

  const assignCartelaMutation = useMutation({
    mutationFn: () => cartelaAdminApi.assignRange({
      userId: cartelaUser!.id,
      fromCard: parseInt(rangeFrom, 10),
      toCard: parseInt(rangeTo, 10),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['user-cartelas', cartelaUser?.id] });
      const count = res.data.data?.cardsAssigned ?? 0;
      const requested = parseInt(rangeTo, 10) - parseInt(rangeFrom, 10) + 1;
      const skipped = requested - count;
      setRangeFrom(''); setRangeTo('');
      setAssignCartelaError('');
      setAssignCartelaSuccess(
        skipped > 0
          ? `${count} assigned, ${skipped} skipped (already assigned to another user).`
          : `${count} card${count !== 1 ? 's' : ''} assigned.`
      );
      setTimeout(() => setAssignCartelaSuccess(''), 5000);
    },
    onError: (e: any) => {
      setAssignCartelaSuccess('');
      setAssignCartelaError(e?.response?.data?.error?.message ?? 'Assignment failed');
    },
  });

  const removeCartelaMutation = useMutation({
    mutationFn: (cartelaId: string) => cartelaAdminApi.unassign(cartelaId, cartelaUser!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-cartelas', cartelaUser?.id] }),
  });

  const removeRangeMutation = useMutation({
    mutationFn: () => cartelaAdminApi.unassignRange({
      userId: cartelaUser!.id,
      fromCard: parseInt(removeFrom, 10),
      toCard: parseInt(removeTo, 10),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['user-cartelas', cartelaUser?.id] });
      const count = res.data.data?.cardsUnassigned ?? 0;
      setRemoveFrom(''); setRemoveTo(''); setRemoveError('');
      setRemoveSuccess(`${count} card${count !== 1 ? 's' : ''} removed.`);
      setTimeout(() => setRemoveSuccess(''), 3000);
    },
    onError: (e: any) => {
      setRemoveSuccess('');
      setRemoveError(e?.response?.data?.error?.message ?? 'Failed to remove');
    },
  });

  const { data: agents = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ['admin-agents'],
    queryFn: () => adminApi.listAgents().then((r) => r.data.data),
    enabled: isAdmin,
  });

  const assignAgentMutation = useMutation({
    mutationFn: () => adminApi.assignAgent(assignAgentUser!.id, selectedAgentId || null),
    onSuccess: () => { invalidate(); closeModal(); },
  });

  const closeModal = () => {
    setModal(null); setEditUser(null); setTopUpUser(null); setDeductUser(null); setCartelaUser(null);
    setAssignAgentUser(null); setSelectedAgentId('');
    setForm(emptyForm); setAgentForm(emptyAgentForm);
    setTopUpAmount(''); setDeductAmount(''); setRangeFrom(''); setRangeTo(''); setAssignCartelaError(''); setAssignCartelaSuccess('');
    setRemoveFrom(''); setRemoveTo(''); setRemoveError(''); setRemoveSuccess('');
  };

  const openEdit = (u: UserRecord) => {
    setEditUser(u);
    setForm({ username: u.username, email: u.email, password: '', paymentType: u.paymentType, voice: 'boy sound', role: 'player' });
    setModal('edit');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="p-4 sm:p-6">
      {/* ... modals unchanged ... */}
      {(modal === 'create' || modal === 'edit') && (
        <ModalWrap title={modal === 'edit' ? `Edit — ${editUser?.username}` : 'Create New User'} onClose={closeModal}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Username</label>
                <input name="username" value={form.username} onChange={handleChange} className={inputCls} placeholder="johndoe" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} className={inputCls} placeholder="john@example.com" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Payment Type</label>
              <select name="paymentType" value={form.paymentType} onChange={handleChange} className={inputCls}>
                <option value="prepaid">Prepaid</option>
                <option value="postpaid">Postpaid</option>
              </select>
            </div>
            {modal === 'create' && isAdmin && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Role</label>
                <select name="role" value={form.role} onChange={handleChange} className={inputCls}>
                  <option value="player">Player</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
            )}
            {modal === 'create' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Default Caller Voice</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_VOICE_CATEGORIES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, voice: value }))}
                      className="py-2.5 rounded-xl text-sm font-medium border-2 transition-colors"
                      style={form.voice === value
                        ? { borderColor: '#3b82f6', background: '#eff6ff', color: '#1d4ed8' }
                        : { borderColor: '#e5e7eb', background: '#fff', color: '#6b7280' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modal === 'create' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
                <input name="password" type="password" value={form.password} onChange={handleChange} className={inputCls} placeholder="••••••••" />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => modal === 'edit' ? updateMutation.mutate() : createMutation.mutate()}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Create User'}
              </button>
              <button onClick={closeModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      {modal === 'topup' && topUpUser && (
        <ModalWrap title={`Add Balance — ${topUpUser.username}`} onClose={closeModal}>
          <div className="space-y-4">
            <div className="bg-emerald-50 rounded-xl p-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">Current balance</span>
              <span className="text-lg font-bold text-emerald-600">${Number(topUpUser.balance).toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount to Add ($)</label>
              <input type="number" min="0.01" step="0.01" value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
            {topUpAmount && parseFloat(topUpAmount) > 0 && (
              <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
                New balance: <strong>${(Number(topUpUser.balance) + parseFloat(topUpAmount)).toFixed(2)}</strong>
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => topUpMutation.mutate()}
                disabled={topUpMutation.isPending || !topUpAmount || parseFloat(topUpAmount) <= 0}
                className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {topUpMutation.isPending ? 'Adding...' : 'Add Balance'}
              </button>
              <button onClick={closeModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </ModalWrap>
      )}


      {modal === 'deduct' && deductUser && (
        <ModalWrap title={`Deduct Balance — ${deductUser.username}`} onClose={closeModal}>
          <div className="space-y-4">
            <div className="bg-red-50 rounded-xl p-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">Current balance</span>
              <span className="text-lg font-bold text-red-500">${Number(deductUser.balance).toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount to Deduct ($)</label>
              <input type="number" min="0.01" step="0.01" value={deductAmount}
                onChange={(e) => setDeductAmount(e.target.value)} className={inputCls} placeholder="0.00" />
            </div>
            {deductAmount && parseFloat(deductAmount) > 0 && (
              <div className={`rounded-xl p-3 text-sm ${parseFloat(deductAmount) > Number(deductUser.balance) ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>
                {parseFloat(deductAmount) > Number(deductUser.balance)
                  ? 'Amount exceeds current balance'
                  : <>New balance: <strong>${(Number(deductUser.balance) - parseFloat(deductAmount)).toFixed(2)}</strong></>}
              </div>
            )}
            {deductMutation.isError && (
              <p className="text-xs text-red-500">{(deductMutation.error as any)?.response?.data?.error?.message ?? 'Deduction failed'}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => deductMutation.mutate()}
                disabled={deductMutation.isPending || !deductAmount || parseFloat(deductAmount) <= 0 || parseFloat(deductAmount) > Number(deductUser.balance)}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deductMutation.isPending ? 'Deducting...' : 'Deduct Balance'}
              </button>
              <button onClick={closeModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      {modal === 'cartela' && cartelaUser && (
        <ModalWrap title={`Cartelas — ${cartelaUser.username}`} onClose={closeModal}>
          <div className="space-y-4">
            {/* Bulk assign by range */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Assign card range</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number" min={1} max={2000} value={rangeFrom}
                  onChange={e => { setRangeFrom(e.target.value); setAssignCartelaError(''); setAssignCartelaSuccess(''); }}
                  placeholder="From #" className={`${inputCls} text-center`}
                />
                <span className="text-gray-400 text-sm shrink-0">—</span>
                <input
                  type="number" min={1} max={2000} value={rangeTo}
                  onChange={e => { setRangeTo(e.target.value); setAssignCartelaError(''); setAssignCartelaSuccess(''); }}
                  placeholder="To #" className={`${inputCls} text-center`}
                />
                <button
                  onClick={() => assignCartelaMutation.mutate()}
                  disabled={!rangeFrom || !rangeTo || parseInt(rangeFrom) > parseInt(rangeTo) || assignCartelaMutation.isPending}
                  className="shrink-0 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {assignCartelaMutation.isPending ? '...' : 'Assign'}
                </button>
              </div>
              {assignCartelaError && <p className="text-xs text-red-500 mt-1.5">{assignCartelaError}</p>}
              {assignCartelaSuccess && (
                <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {assignCartelaSuccess}
                </p>
              )}
            </div>

            {/* Bulk remove by range */}
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Remove card range</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number" min={1} max={2000} value={removeFrom}
                  onChange={e => { setRemoveFrom(e.target.value); setRemoveError(''); setRemoveSuccess(''); }}
                  placeholder="From #" className={`${inputCls} text-center`}
                />
                <span className="text-gray-400 text-sm shrink-0">—</span>
                <input
                  type="number" min={1} max={2000} value={removeTo}
                  onChange={e => { setRemoveTo(e.target.value); setRemoveError(''); setRemoveSuccess(''); }}
                  placeholder="To #" className={`${inputCls} text-center`}
                />
                <button
                  onClick={() => removeRangeMutation.mutate()}
                  disabled={!removeFrom || !removeTo || parseInt(removeFrom) > parseInt(removeTo) || removeRangeMutation.isPending}
                  className="shrink-0 bg-red-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {removeRangeMutation.isPending ? '...' : 'Remove'}
                </button>
              </div>
              {removeError && <p className="text-xs text-red-500 mt-1.5">{removeError}</p>}
              {removeSuccess && (
                <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {removeSuccess}
                </p>
              )}
            </div>

            {/* Assigned cards */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Assigned Cards</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{userCartelas.length}</span>
              </div>
              {loadingCartelas ? (
                <div className="py-6 text-center text-gray-400 text-sm">Loading...</div>
              ) : userCartelas.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-sm bg-gray-50 rounded-xl">No cartelas assigned yet.</div>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                  {userCartelas.map((c) => (
                    <div key={c.id}
                      className="flex items-center gap-1.5 bg-gradient-to-b from-yellow-400 to-yellow-500 rounded-xl px-2.5 py-1.5 shadow-sm">
                      <span className="font-bold text-gray-900 text-xs">#{c.cardNumber ?? '?'}</span>
                      <button
                        onClick={() => removeCartelaMutation.mutate(c.id)}
                        disabled={removeCartelaMutation.isPending}
                        className="w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white disabled:opacity-50 transition-colors"
                        title="Remove"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalWrap>
      )}


      {modal === 'assign-agent' && assignAgentUser && isAdmin && (
        <ModalWrap title={`Assign Agent — ${assignAgentUser.username}`} onClose={closeModal}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Select an agent to manage this user, or leave blank to unassign.</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Agent</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className={inputCls}
              >
                <option value="">— No agent (unassign) —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
            </div>
            {agents.length === 0 && (
              <p className="text-xs text-amber-600">No agents found. Create an agent first.</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => assignAgentMutation.mutate()}
                disabled={assignAgentMutation.isPending}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {assignAgentMutation.isPending ? 'Saving...' : 'Assign'}
              </button>
              <button onClick={closeModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      {modal === 'create-agent' && isAdmin && (
        <ModalWrap title="Create New Agent" onClose={closeModal}>
          <div className="space-y-4">
            <div className="rounded-xl px-4 py-3 text-sm text-purple-700 mb-1"
              style={{ background: 'rgba(147,51,234,0.08)', border: '1px solid rgba(147,51,234,0.2)' }}>
              Agents can create and manage their own users with full admin permissions.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Username *</label>
                <input value={agentForm.username} onChange={e => setAgentForm(f => ({ ...f, username: e.target.value }))}
                  className={inputCls} placeholder="agent_john" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Email *</label>
                <input type="email" value={agentForm.email} onChange={e => setAgentForm(f => ({ ...f, email: e.target.value }))}
                  className={inputCls} placeholder="john@example.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">First Name</label>
                <input value={agentForm.firstName} onChange={e => setAgentForm(f => ({ ...f, firstName: e.target.value }))}
                  className={inputCls} placeholder="John" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Last Name</label>
                <input value={agentForm.lastName} onChange={e => setAgentForm(f => ({ ...f, lastName: e.target.value }))}
                  className={inputCls} placeholder="Doe" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
              <input value={agentForm.phone} onChange={e => setAgentForm(f => ({ ...f, phone: e.target.value }))}
                className={inputCls} placeholder="+251..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Password *</label>
              <input type="password" value={agentForm.password} onChange={e => setAgentForm(f => ({ ...f, password: e.target.value }))}
                className={inputCls} placeholder="••••••••" />
            </div>
            {createAgentMutation.isError && (
              <p className="text-xs text-red-500">{(createAgentMutation.error as any)?.response?.data?.error?.message ?? 'Failed to create agent'}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => createAgentMutation.mutate()}
                disabled={createAgentMutation.isPending || !agentForm.username || !agentForm.email || !agentForm.password}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors text-white"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
              >
                {createAgentMutation.isPending ? 'Creating...' : 'Create Agent'}
              </button>
              <button onClick={closeModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <p className="text-sm text-gray-500">{users.length} total users</p>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => { setModal('create-agent'); setAgentForm(emptyAgentForm); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm text-white"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Agent
            </button>
          )}
          <button
            onClick={() => { setModal('create'); setForm(emptyForm); }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New User
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-4 mb-4 flex flex-wrap gap-2 sm:gap-3 items-center">
        <div className="relative flex-1 min-w-[140px]">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          <option value="all">All Types</option>
          <option value="prepaid">Prepaid</option>
          <option value="postpaid">Postpaid</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {(search || filterType !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setSearch(''); setFilterType('all'); setFilterStatus('all'); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Clear</button>
        )}
        <span className="ml-auto text-xs text-gray-400">{filtered.length} results</span>
      </div>

      {/* Table — desktop */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hidden sm:block">
        {isLoading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading users...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['User', 'Type', 'Status', 'Balance', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-6 py-3.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <button onClick={() => navigate(`/admin/users/${u.id}`)}
                            className="font-medium text-gray-800 hover:text-blue-600 transition-colors text-left">
                            {u.username}
                          </button>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${u.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>
                        {u.paymentType}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {u.paymentType === 'prepaid'
                        ? <span className="font-medium text-emerald-600">${Number(u.balance).toFixed(2)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => navigate(`/admin/users/${u.id}`)} title="View"
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        <button onClick={() => openEdit(u)} title="Edit"
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => { setCartelaUser(u); setModal('cartela'); }} title="Manage cartelas"
                          className="p-1.5 rounded-lg hover:bg-yellow-50 text-gray-400 hover:text-yellow-600 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                        </button>
                        {isAdmin && (
                          <button onClick={() => { setAssignAgentUser(u); setSelectedAgentId(''); setModal('assign-agent'); }} title="Assign to agent"
                            className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                          </button>
                        )}
                        {u.paymentType === 'prepaid' && (
                          <button onClick={() => { setTopUpUser(u); setModal('topup'); }} title="Add balance"
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </button>
                        )}
                        {u.paymentType === 'prepaid' && (
                          <button onClick={() => { setDeductUser(u); setModal('deduct'); }} title="Deduct balance"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                          </button>
                        )}
                        {u.status === 'active' ? (
                          <button onClick={() => deactivateMutation.mutate(u.id)} title="Deactivate"
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                          </button>
                        ) : (
                          <button onClick={() => activateMutation.mutate(u.id)} title="Activate"
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </button>
                        )}
                        <button onClick={() => { if (window.confirm(`Delete ${u.username}?`)) deleteMutation.mutate(u.id); }} title="Delete"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cards — mobile */}
      <div className="sm:hidden space-y-3">
        {isLoading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading users...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No users found.</div>
        ) : filtered.map((u) => (
          <div key={u.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {u.username[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <button onClick={() => navigate(`/admin/users/${u.id}`)}
                  className="font-medium text-gray-800 hover:text-blue-600 transition-colors text-left block truncate w-full">
                  {u.username}
                </button>
                <div className="text-xs text-gray-400 truncate">{u.email}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {u.status}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.paymentType === 'prepaid' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}>
                  {u.paymentType}
                </span>
              </div>
            </div>
            {u.paymentType === 'prepaid' && (
              <div className="text-xs text-gray-500 mb-3">Balance: <span className="font-semibold text-emerald-600">${Number(u.balance).toFixed(2)}</span></div>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <button onClick={() => navigate(`/admin/users/${u.id}`)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                View
              </button>
              <button onClick={() => openEdit(u)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit
              </button>
              <button onClick={() => { setCartelaUser(u); setModal('cartela'); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-50 text-yellow-700 text-xs font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                Cartelas
              </button>
              {u.paymentType === 'prepaid' && (
                <button onClick={() => { setTopUpUser(u); setModal('topup'); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Top Up
                </button>
              )}
              {u.paymentType === 'prepaid' && (
                <button onClick={() => { setDeductUser(u); setModal('deduct'); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                  Deduct
                </button>
              )}
              {u.status === 'active' ? (
                <button onClick={() => deactivateMutation.mutate(u.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium">
                  Suspend
                </button>
              ) : (
                <button onClick={() => activateMutation.mutate(u.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                  Activate
                </button>
              )}
              <button onClick={() => { if (window.confirm(`Delete ${u.username}?`)) deleteMutation.mutate(u.id); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-medium">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
