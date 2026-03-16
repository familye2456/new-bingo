import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cartelaAdminApi, adminApi } from '../../services/api';

const COLS = ['B', 'I', 'N', 'G', 'O'];

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  userId?: string;
  gameId?: string;
  numbers: number[];
  isActive: boolean;
  isWinner: boolean;
  purchasedAt: string;
  user?: { username: string };
}

interface UserRecord {
  id: string;
  username: string;
}

type Tab = 'cartelas' | 'assign-range';

const BingoCardModal: React.FC<{
  cartela: CartelaRecord;
  users: UserRecord[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onSave: (id: string, numbers: number[]) => void;
  onAssign: (cartelaId: string, userId: string) => void;
  onUnassign: (cartelaId: string) => void;
  isDeleting: boolean;
  isSaving: boolean;
  isAssigning: boolean;
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

    if (isFree) {
      return (
        <div key={idx}
          className="flex items-center justify-center rounded-xl text-sm font-bold aspect-square bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 shadow-[0_0_8px_rgba(234,179,8,0.6)]">
          FREE
        </div>
      );
    }

    if (editMode) {
      return (
        <input key={idx} type="number" value={num || ''}
          onChange={(e) => setCell(idx, e.target.value)}
          className="w-full aspect-square rounded-xl bg-[#3a3a3a] text-white text-center text-xs font-bold border border-yellow-500/50 focus:outline-none focus:border-yellow-400 p-0"
        />
      );
    }

    return (
      <div key={idx}
        className="flex items-center justify-center rounded-xl text-sm font-bold aspect-square bg-[#3a3a3a] text-white">
        {num}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1e1e1e] rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-center text-yellow-400 font-bold text-lg mb-3 tracking-wide">
          Card #{cartela.cardNumber ?? '—'}
        </div>

        {/* Assignment section */}
        <div className="mb-4 p-3 bg-[#2a2a2a] rounded-xl">
          <div className="text-xs text-gray-400 mb-2">Assigned to</div>
          {cartela.userId ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-yellow-400 font-medium">
                {cartela.user?.username ?? users.find(u => u.id === cartela.userId)?.username ?? 'Unknown'}
              </span>
              <button
                onClick={() => onUnassign(cartela.id)}
                disabled={isAssigning}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 ml-2">
                Unassign
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 bg-[#3a3a3a] text-white text-xs rounded-lg px-2 py-1.5 border border-gray-600 focus:outline-none focus:border-yellow-500">
                <option value="">— select user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
              <button
                onClick={() => selectedUserId && onAssign(cartela.id, selectedUserId)}
                disabled={!selectedUserId || isAssigning}
                className="bg-yellow-500 text-gray-900 text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-yellow-400 disabled:opacity-40">
                {isAssigning ? '...' : 'Assign'}
              </button>
            </div>
          )}
        </div>

        {/* Bingo grid */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map((c) => (
            <div key={c}
              className="flex items-center justify-center rounded-xl aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">
              {c}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, col) => cell(row, col))
          )}
        </div>

        <div className="mt-4 flex gap-2">
          {editMode ? (
            <>
              <button onClick={() => onSave(cartela.id, grid)} disabled={isSaving}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditMode(false); setGrid([...cartela.numbers]); }}
                className="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-600">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditMode(true)}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700">
                Edit
              </button>
              <button
                onClick={() => { if (window.confirm(`Delete card #${cartela.cardNumber}?`)) onDelete(cartela.id); }}
                disabled={isDeleting}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {isDeleting ? '...' : 'Delete'}
              </button>
              <button onClick={onClose}
                className="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-600">
                Close
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
    page: String(page),
    limit: String(PAGE_SIZE),
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

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cartelaAdminApi.update(id, { isActive: false }),
    onSuccess: () => { invalidate(); setSelectedCartela(null); },
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, numbers }: { id: string; numbers: number[] }) =>
      cartelaAdminApi.update(id, { numbers }),
    onSuccess: () => { invalidate(); setSelectedCartela(null); },
  });

  const assignMutation = useMutation({
    mutationFn: ({ cartelaId, userId }: { cartelaId: string; userId: string }) =>
      cartelaAdminApi.update(cartelaId, { userId }),
    onSuccess: (_, vars) => {
      invalidate();
      // refresh the selected cartela with updated userId
      setSelectedCartela((prev) => prev ? { ...prev, userId: vars.userId, user: users.find(u => u.id === vars.userId) ? { username: users.find(u => u.id === vars.userId)!.username } : prev.user } : null);
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (cartelaId: string) => cartelaAdminApi.unassign(cartelaId),
    onSuccess: () => {
      invalidate();
      setSelectedCartela((prev) => prev ? { ...prev, userId: undefined, user: undefined } : null);
    },
  });

  const assignRangeMutation = useMutation({
    mutationFn: () => cartelaAdminApi.assignRange(rangeForm),
    onSuccess: (res) => { setRangeResult(res.data.data); invalidate(); },
  });

  return (
    <div className="p-6">
      {selectedCartela && (
        <BingoCardModal
          cartela={selectedCartela}
          users={users}
          onClose={() => setSelectedCartela(null)}
          onDelete={(id) => deleteMutation.mutate(id)}
          isDeleting={deleteMutation.isPending}
          onSave={(id, numbers) => saveMutation.mutate({ id, numbers })}
          isSaving={saveMutation.isPending}
          onAssign={(cartelaId, userId) => assignMutation.mutate({ cartelaId, userId })}
          onUnassign={(cartelaId) => unassignMutation.mutate(cartelaId)}
          isAssigning={assignMutation.isPending || unassignMutation.isPending}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Cartela Management</h1>
        <div className="flex gap-2">
          {(['cartelas', 'assign-range'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
              }`}>
              {t === 'assign-range' ? 'Assign by Range' : 'Cartelas'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'assign-range' && (
        <div className="bg-white rounded-xl shadow p-6 max-w-md">
          <h2 className="font-semibold mb-1">Assign Card Range to User</h2>
          <p className="text-sm text-gray-500 mb-4">
            All unassigned cards in the range will be assigned to the selected user.
          </p>
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">User</label>
              <select
                value={rangeForm.userId}
                onChange={(e) => setRangeForm((f) => ({ ...f, userId: e.target.value }))}
                className="border rounded-lg px-3 py-2 w-full text-sm">
                <option value="">— select user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Card from #</label>
                <input type="number" min={1} max={2000} value={rangeForm.fromCard}
                  onChange={(e) => setRangeForm((f) => ({ ...f, fromCard: +e.target.value }))}
                  className="border rounded-lg px-3 py-2 w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Card to #</label>
                <input type="number" min={1} max={2000} value={rangeForm.toCard}
                  onChange={(e) => setRangeForm((f) => ({ ...f, toCard: +e.target.value }))}
                  className="border rounded-lg px-3 py-2 w-full text-sm" />
              </div>
            </div>
          </div>
          <button
            onClick={() => { setRangeResult(null); assignRangeMutation.mutate(); }}
            disabled={assignRangeMutation.isPending || !rangeForm.userId}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {assignRangeMutation.isPending ? 'Assigning...' : 'Assign'}
          </button>
          {rangeResult && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              Done — {rangeResult.cardsAssigned} cards assigned to {rangeResult.username}.
            </div>
          )}
          {assignRangeMutation.isError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              Failed. Check the range and try again.
            </div>
          )}
        </div>
      )}

      {/* Cartelas tab */}
      {tab === 'cartelas' && (
        <>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select value={filterUserId} onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm w-48">
              <option value="">All cards</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showUnassigned} disabled={!!filterUserId}
                onChange={(e) => { setShowUnassigned(e.target.checked); setPage(1); }} />
              Unassigned only
            </label>
            <span className="ml-auto text-sm text-gray-500">{total} cards</span>
          </div>

          {isLoading ? (
            <div className="text-center py-10 text-gray-500">Loading...</div>
          ) : cartelas.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No cartelas found.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cartelas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCartela(c)}
                  title={c.user?.username ?? (c.userId ? 'Assigned' : 'Unassigned')}
                  className={`w-16 h-16 rounded-xl font-bold text-sm transition-all hover:scale-105 hover:shadow-lg flex flex-col items-center justify-center gap-0.5
                    ${c.userId
                      ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900'
                      : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#3a3a3a]'
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
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50">
                Prev
              </button>
              <span className="text-sm text-gray-600">Page {page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
