import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineUserApi } from '../../services/offlineApi';
import { api, userApi } from '../../services/api';
import { dbDelete, dbPut } from '../../services/db';

const COLS = ['B', 'I', 'N', 'G', 'O'];
const RANGES = [[1,15],[16,30],[31,45],[46,60],[61,75]];

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  numbers: number[];
  isActive: boolean;
  assignedAt: string;
}

function generateNumbers(): number[] {
  const grid = Array(25).fill(0);
  for (let col = 0; col < 5; col++) {
    const [min, max] = RANGES[col];
    const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const picked: number[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    for (let row = 0; row < 5; row++) grid[row * 5 + col] = picked[row];
  }
  grid[12] = 0;
  return grid;
}

// ── Bingo Card ────────────────────────────────────────────────────────────────
const BingoCard: React.FC<{
  cartela: CartelaRecord;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}> = ({ cartela, onEdit, onDelete, deleting }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative group">
        <button
          onClick={() => setOpen(true)}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 font-bold text-sm hover:scale-105 transition-transform shadow flex items-center justify-center">
          #{cartela.cardNumber ?? '?'}
        </button>
        {/* action buttons */}
        <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-1">
          <button onClick={onEdit}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
            style={{ background: '#3b82f6', color: '#fff' }}
            title="Edit">✎</button>
          <button onClick={onDelete} disabled={deleting}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs disabled:opacity-50"
            style={{ background: '#ef4444', color: '#fff' }}
            title="Remove">✕</button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-[#1e1e1e] rounded-2xl p-4 w-[90vw] max-w-xs shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-yellow-400 font-bold text-lg mb-3">Card #{cartela.cardNumber}</div>
            <div className="grid grid-cols-5 gap-1 mb-1">
              {COLS.map((c) => (
                <div key={c} className="flex items-center justify-center rounded-lg aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">{c}</div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {cartela.numbers.map((num, idx) => (
                <div key={idx} className={`flex items-center justify-center rounded-lg aspect-square text-sm font-bold ${idx === 12 ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900' : 'bg-[#3a3a3a] text-white'}`}>
                  {idx === 12 ? 'FREE' : num}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setOpen(false); onEdit(); }}
                className="flex-1 py-2 rounded-xl text-sm font-medium"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>
                Edit
              </button>
              <button onClick={() => setOpen(false)}
                className="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-600">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Editor Modal (create or edit) ────────────────────────────────────────────
const EditorModal: React.FC<{
  initial?: CartelaRecord;
  onClose: () => void;
  onSave: (nums: number[], cardNumber: number) => void;
  saving: boolean;
  error?: string;
}> = ({ initial, onClose, onSave, saving, error }) => {
  const [grid, setGrid] = useState<number[]>(initial?.numbers ?? generateNumbers);
  const [cardNum, setCardNum] = useState<string>(initial?.cardNumber?.toString() ?? '');

  const setCell = (idx: number, val: string) => {
    const n = parseInt(val, 10);
    setGrid(g => { const next = [...g]; next[idx] = isNaN(n) ? 0 : n; return next; });
  };

  const canSave = cardNum !== '' && parseInt(cardNum, 10) > 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1e1e1e] rounded-2xl p-5 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-yellow-400 font-bold text-base">{initial ? 'Edit Cartela' : 'New Cartela'}</span>
          <button onClick={() => setGrid(generateNumbers())} className="text-xs text-gray-400 hover:text-yellow-400 px-2 py-1 rounded-lg bg-white/5">
            🔀 Randomize
          </button>
        </div>

        {/* Card number input */}
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Card Number</label>
          <input
            type="number"
            value={cardNum}
            onChange={e => setCardNum(e.target.value)}
            placeholder="e.g. 42"
            className="w-full rounded-xl px-3 py-2 text-sm font-bold focus:outline-none"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}
          />
        </div>

        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map((c, ci) => (
            <div key={c} className="flex items-center justify-center rounded-lg aspect-square text-xs font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">
              {c}<span className="text-[8px] ml-0.5 opacity-60">{RANGES[ci][0]}-{RANGES[ci][1]}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1 mb-4">
          {grid.map((num, idx) => {
            if (idx === 12) return (
              <div key={idx} className="flex items-center justify-center rounded-lg aspect-square text-xs font-black bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900">FREE</div>
            );
            return (
              <input key={idx} type="number" value={num || ''} onChange={e => setCell(idx, e.target.value)}
                className="w-full aspect-square rounded-lg bg-[#2d2d2d] text-white text-center text-xs font-bold border border-white/10 focus:outline-none focus:border-yellow-400 p-0" />
            );
          })}
        </div>

        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

        <div className="flex gap-2">
          <button onClick={() => onSave(grid, parseInt(cardNum, 10))} disabled={saving || !canSave}
            className="flex-1 bg-yellow-400 text-gray-900 py-2 rounded-xl text-sm font-bold hover:bg-yellow-300 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="flex-1 bg-white/10 text-gray-300 py-2 rounded-xl text-sm hover:bg-white/20">Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export const MyCartelas: React.FC = () => {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editCartela, setEditCartela] = useState<CartelaRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mutError, setMutError] = useState('');

  const { data: cartelas = [], isLoading } = useQuery<CartelaRecord[]>({
    queryKey: ['my-cartelas'],
    queryFn: async () => {
      const list = await offlineUserApi.myCartelas();
      return [...list].sort((a: CartelaRecord, b: CartelaRecord) => (a.cardNumber ?? 0) - (b.cardNumber ?? 0));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-cartelas'] });

  const createMutation = useMutation({
    mutationFn: ({ numbers, cardNumber }: { numbers: number[]; cardNumber: number }) =>
      api.post('/cartelas/generate', { numbers, cardNumber }),
    onSuccess: async (res) => {
      const created = res?.data?.data;
      if (created) await dbPut('cartelas', created);
      invalidate(); setShowCreate(false); setMutError('');
    },
    onError: (e: any) => setMutError(e?.response?.data?.error?.message ?? 'Failed to create'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, numbers, cardNumber }: { id: string; numbers: number[]; cardNumber: number }) =>
      userApi.updateCartela(id, { numbers, cardNumber }),
    onSuccess: async (res, vars) => {
      const updated = res?.data?.data;
      if (updated) await dbPut('cartelas', updated);
      invalidate(); setEditCartela(null); setMutError('');
    },
    onError: (e: any) => setMutError(e?.response?.data?.error?.message ?? 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userApi.deleteCartela(id),
    onSuccess: async (_, id) => {
      // Remove from IndexedDB immediately so offline reads don't show stale data
      await dbDelete('cartelas', id);
      invalidate();
    },
  });

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">My Cartelas</h1>
          <p className="text-sm text-gray-500 mt-0.5">{cartelas.length} cards assigned</p>
        </div>
        <button onClick={() => { setMutError(''); setShowCreate(true); }}
          className="flex items-center gap-1.5 bg-yellow-400 text-gray-900 px-4 py-2 rounded-xl text-sm font-bold hover:bg-yellow-300 transition-colors shadow">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Cartela
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : cartelas.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🎴</div>
          <div className="text-sm mb-4">No cartelas yet.</div>
          <button onClick={() => setShowCreate(true)}
            className="bg-yellow-400 text-gray-900 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-yellow-300">
            Add Cartela
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {cartelas.map((c) => (
            <BingoCard
              key={c.id}
              cartela={c}
              onEdit={() => { setMutError(''); setEditCartela(c); }}
              onDelete={() => setConfirmDeleteId(c.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === c.id}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <EditorModal
          onClose={() => setShowCreate(false)}
          onSave={(nums, cardNumber) => createMutation.mutate({ numbers: nums, cardNumber })}
          saving={createMutation.isPending}
          error={mutError}
        />
      )}

      {editCartela && (
        <EditorModal
          initial={editCartela}
          onClose={() => setEditCartela(null)}
          onSave={(nums, cardNumber) => editMutation.mutate({ id: editCartela.id, numbers: nums, cardNumber })}
          saving={editMutation.isPending}
          error={mutError}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmDeleteId(null)}>
          <div className="bg-[#1e1e1e] rounded-2xl p-6 w-72 shadow-2xl text-center"
            onClick={e => e.stopPropagation()}>
            <div className="text-3xl mb-3">🗑️</div>
            <div className="text-white font-bold text-base mb-1">Remove Cartela?</div>
            <div className="text-gray-400 text-sm mb-5">This will unassign the card from your account.</div>
            <div className="flex gap-2">
              <button
                onClick={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-red-600 disabled:opacity-50">
                Yes, Remove
              </button>
              <button onClick={() => setConfirmDeleteId(null)}
                className="flex-1 bg-white/10 text-gray-300 py-2.5 rounded-xl text-sm hover:bg-white/20">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
