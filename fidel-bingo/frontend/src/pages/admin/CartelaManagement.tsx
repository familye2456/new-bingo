import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cartelaAdminApi, adminApi } from '../../services/api';

const COLS = ['B', 'I', 'N', 'G', 'O'];

interface CartelaRecord {
  id: string; cardNumber?: number; userId?: string; gameId?: string;
  numbers: number[]; isActive: boolean; isWinner: boolean;
  purchasedAt: string; user?: { username: string };
}
interface UserRecord { id: string; username: string; }
type Tab = 'cartelas' | 'assign-range';

const BingoCardModal: React.FC<{
  cartela: CartelaRecord; users: UserRecord[]; onClose: () => void;
  onDelete: (id: string) => void; onSave: (id: string, numbers: number[]) => void;
  onAssign: (cartelaId: string, userId: string) => void; onUnassign: (cartelaId: string, userId: string) => void;
  isDeleting: boolean; isSaving: boolean; isAssigning: boolean;
}> = ({ cartela, users, onClose, onDelete, onSave, onAssign, onUnassign, isDeleting, isSaving, isAssigning }) => {
  const [editMode, setEditMode] = useState(false);
  const [grid, setGrid] = useState<number[]>([...cartela.numbers]);
  const [selectedUserId, setSelectedUserId] = useState(cartela.userId ?? '');

  const setCell = (idx: number, val: string) => {
    const n = parseInt(val, 10);
    setGrid((g) => { const next = [...g]; next[idx] = isNaN(n) ? 0 : n; return next; });
  };

  const cell = (row: number, col: number) => {
    const idx = row * 5 + col;
    const isFree = row === 2 && col === 2;
    const num = grid[idx];
    if (isFree) return (
      <div key={idx} className="flex items-center justify-center rounded-xl text-xs font-black aspect-square bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 shadow-inner">
        FREE
      </div>
    );
    if (editMode) return (
      <input key={idx} type="number" value={num || ''}
        onChange={(e) => setCell(idx, e.target.value)}
        className="w-full aspect-square rounded-xl bg-[#2d2d2d] text-white text-center text-xs font-bold border border-yellow-500/40 focus:outline-none focus:border-yellow-400 p-0"
      />
    );
    return (
      <div key={idx} className="flex items-center justify-center rounded-xl text-sm font-bold aspect-square bg-[#2d2d2d] text-white">
        {num}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1a1a1a] rounded-2xl p-6 w-80 shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-yellow-400 font-bold text-lg">Card #{cartela.cardNumber ?? '—'}</div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Assignment */}
        <div className="mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
          <div className="text-xs text-gray-500 mb-2">Assigned to</div>
          {cartela.userId ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-yellow-400 font-medium">
                {cartela.user?.username ?? users.find(u => u.id === cartela.userId)?.username ?? 'Unknown'}
              </span>
              <button onClick={() => onUnassign(cartela.id, cartela.userId!)} disabled={isAssigning}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
                Unassign
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 bg-[#2d2d2d] text-white text-xs rounded-lg px-2 py-1.5 border border-white/10 focus:outline-none focus:border-yellow-500">
                <option value="">— select user —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
              <button onClick={() => selectedUserId && onAssign(cartela.id, selectedUserId)}
                disabled={!selectedUserId || isAssigning}
                className="bg-yellow-500 text-gray-900 text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-yellow-400 disabled:opacity-40 transition-colors">
                {isAssigning ? '...' : 'Assign'}
              </button>
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map((c) => (
            <div key={c} className="flex items-center justify-center rounded-xl aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">
              {c}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => cell(row, col)))}
        </div>

        <div className="mt-4 flex gap-2">
          {editMode ? (
            <>
              <button onClick={() => onSave(cartela.id, grid)} disabled={isSaving}
                className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditMode(false); setGrid([...cartela.numbers]); }}
                className="flex-1 bg-white/10 text-gray-300 py-2 rounded-xl text-sm hover:bg-white/20 transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditMode(true)}
                className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
                Edit
              </button>
              <button onClick={() => { if (window.confirm(`Delete card #${cartela.cardNumber}?`)) onDelete(cartela.id); }}
                disabled={isDeleting}
                className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                {isDeleting ? '...' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const CartelaManagement: React.FC = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-cartelas'] });

  const [tab, setTab] = useState<Tab>('cartelas');
  const [filterUserId, setFilterUserId] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const [selectedCartela, setSelectedCartela] = useState<CartelaRecord | null>(null);
  const [rangeForm, setRangeForm] = useState({ fromCard: 1, toCard: 100, userId: '' });
  const [rangeResult, setRangeResult] = useState<{ cardsAssigned: number; username: string } | null>(null);

  const queryParams: Record<string, string> = {
    page: String(page), limit: String(PAGE_SIZE),
    ...(filterUserId ? { userId: filterUserId } : {}),
    ...(showUnassigned && !filterUserId ? { unassigned: 'true' } : {}),
  };

  const { data: resp, isLoading } = useQuery<{ data: CartelaRecord[]; total: number }>({
    queryKey: ['admin-cartelas', filterUserId, showUnassigned, page],
    queryFn: () => cartelaAdminApi.list(queryParams).then((r) => r.data),
  });

  const cartelas = resp?.data ?? [];
  const total = resp?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const assignedCount = cartelas.filter(c => c.userId).length;

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cartelaAdminApi.update(id, { isActive: false }),
    onSuccess: () => { invalidate(); setSelectedCartela(null); },
  });
  const saveMutation = useMutation({
    mutationFn: ({ id, numbers }: { id: string; numbers: number[] }) => cartelaAdminApi.update(id, { numbers }),
    onSuccess: () => { invalidate(); setSelectedCartela(null); },
  });
  const assignMutation = useMutation({
    mutationFn: ({ cartelaId, userId }: { cartelaId: string; userId: string }) => cartelaAdminApi.update(cartelaId, { userId }),
    onSuccess: (_, vars) => {
      invalidate();
      setSelectedCartela((prev) => prev ? { ...prev, userId: vars.userId, user: users.find(u => u.id === vars.userId) ? { username: users.find(u => u.id === vars.userId)!.username } : prev.user } : null);
    },
  });
  const unassignMutation = useMutation({
    mutationFn: ({ cartelaId, userId }: { cartelaId: string; userId: string }) =>
      cartelaAdminApi.unassign(cartelaId, userId),
    onSuccess: () => { invalidate(); setSelectedCartela((prev) => prev ? { ...prev, userId: undefined, user: undefined } : null); },
  });
  const assignRangeMutation = useMutation({
    mutationFn: () => cartelaAdminApi.assignRange(rangeForm),
    onSuccess: (res) => { setRangeResult(res.data.data); invalidate(); },
  });

  const inputCls = "border border-gray-200 rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors";

  return (
    <div className="p-6">
      {selectedCartela && (
        <BingoCardModal
          cartela={selectedCartela} users={users}
          onClose={() => setSelectedCartela(null)}
          onDelete={(id) => deleteMutation.mutate(id)} isDeleting={deleteMutation.isPending}
          onSave={(id, numbers) => saveMutation.mutate({ id, numbers })} isSaving={saveMutation.isPending}
          onAssign={(cartelaId, userId) => assignMutation.mutate({ cartelaId, userId })}
          onUnassign={(cartelaId, userId) => unassignMutation.mutate({ cartelaId, userId })}
          isAssigning={assignMutation.isPending || unassignMutation.isPending}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5">
          {(['cartelas', 'assign-range'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === t ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              {t === 'assign-range' ? 'Assign by Range' : 'All Cartelas'}
            </button>
          ))}
        </div>
        {tab === 'cartelas' && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded-full text-xs font-medium">{assignedCount} assigned</span>
            <span className="bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full text-xs font-medium">{total - assignedCount} free</span>
            <span className="text-gray-400 text-xs">{total} total</span>
          </div>
        )}
      </div>

      {/* Assign range tab */}
      {tab === 'assign-range' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-lg">
          <h2 className="font-semibold text-gray-800 mb-1">Assign Card Range to User</h2>
          <p className="text-sm text-gray-400 mb-5">All unassigned cards in the range will be assigned to the selected user.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">User</label>
              <select value={rangeForm.userId} onChange={(e) => setRangeForm((f) => ({ ...f, userId: e.target.value }))} className={inputCls}>
                <option value="">— select user —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">From card #</label>
                <input type="number" min={1} max={2000} value={rangeForm.fromCard}
                  onChange={(e) => setRangeForm((f) => ({ ...f, fromCard: +e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">To card #</label>
                <input type="number" min={1} max={2000} value={rangeForm.toCard}
                  onChange={(e) => setRangeForm((f) => ({ ...f, toCard: +e.target.value }))} className={inputCls} />
              </div>
            </div>
            <button
              onClick={() => { setRangeResult(null); assignRangeMutation.mutate(); }}
              disabled={assignRangeMutation.isPending || !rangeForm.userId}
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {assignRangeMutation.isPending ? 'Assigning...' : 'Assign Range'}
            </button>
            {rangeResult && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {rangeResult.cardsAssigned} cards assigned to {rangeResult.username}.
              </div>
            )}
            {assignRangeMutation.isError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                Failed. Check the range and try again.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cartelas tab */}
      {tab === 'cartelas' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex flex-wrap gap-3 items-center">
            <select value={filterUserId} onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-w-[160px]">
              <option value="">All cards</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showUnassigned} disabled={!!filterUserId}
                onChange={(e) => { setShowUnassigned(e.target.checked); setPage(1); }}
                className="rounded" />
              Unassigned only
            </label>
            {(filterUserId || showUnassigned) && (
              <button onClick={() => { setFilterUserId(''); setShowUnassigned(false); setPage(1); }}
                className="text-xs text-gray-400 hover:text-gray-600">Clear filter</button>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded bg-gradient-to-b from-yellow-400 to-yellow-500"></div>
              Assigned
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded bg-[#2a2a2a]"></div>
              Unassigned
            </div>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
          ) : cartelas.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No cartelas found.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cartelas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCartela(c)}
                  title={c.user?.username ?? (c.userId ? 'Assigned' : 'Unassigned')}
                  className={`w-[68px] h-[68px] rounded-xl font-bold text-sm transition-all hover:scale-105 hover:shadow-lg flex flex-col items-center justify-center gap-0.5
                    ${c.userId
                      ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 shadow-sm'
                      : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#333]'
                    }`}>
                  <span>#{c.cardNumber ?? '?'}</span>
                  {c.user?.username && (
                    <span className="text-[9px] font-normal truncate w-14 text-center leading-tight opacity-80">
                      {c.user.username}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center gap-3 mt-6 justify-center">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">
                Previous
              </button>
              <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
