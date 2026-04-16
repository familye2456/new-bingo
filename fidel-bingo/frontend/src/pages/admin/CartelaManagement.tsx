import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cartelaAdminApi } from '../../services/api';

const COLS = ['B', 'I', 'N', 'G', 'O'];

interface CartelaRecord {
  id: string; cardNumber?: number;
  numbers: number[]; isActive: boolean; isWinner: boolean;
  purchasedAt: string;
}

const BingoCardModal: React.FC<{
  cartela: CartelaRecord; onClose: () => void;
  onSave: (id: string, numbers: number[]) => void;
  isSaving: boolean;
}> = ({ cartela, onClose, onSave, isSaving }) => {
  const [editMode, setEditMode] = useState(false);
  const [grid, setGrid] = useState<number[]>([...cartela.numbers]);

  const setCell = (idx: number, val: string) => {
    const n = parseInt(val, 10);
    setGrid((g) => { const next = [...g]; next[idx] = isNaN(n) ? 0 : n; return next; });
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

        {/* Grid */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map((c) => (
            <div key={c} className="flex items-center justify-center rounded-xl aspect-square text-sm font-extrabold text-gray-900 bg-gradient-to-b from-yellow-400 to-yellow-500">{c}</div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {grid.map((num, idx) => {
            const isFree = idx === 12;
            if (isFree) return (
              <div key={idx} className="flex items-center justify-center rounded-xl text-xs font-black aspect-square bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900">FREE</div>
            );
            if (editMode) return (
              <input key={idx} type="number" value={num || ''}
                onChange={(e) => setCell(idx, e.target.value)}
                className="w-full aspect-square rounded-xl bg-[#2d2d2d] text-white text-center text-xs font-bold border border-yellow-500/40 focus:outline-none focus:border-yellow-400 p-0" />
            );
            return (
              <div key={idx} className="flex items-center justify-center rounded-xl text-sm font-bold aspect-square bg-[#2d2d2d] text-white">{num}</div>
            );
          })}
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
            <button onClick={() => setEditMode(true)}
              className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
              Edit Numbers
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const CartelaManagement: React.FC = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-cartelas'] });

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const [selectedCartela, setSelectedCartela] = useState<CartelaRecord | null>(null);

  const { data: resp, isLoading } = useQuery<{ data: CartelaRecord[]; total: number }>({
    queryKey: ['admin-cartelas', page],
    queryFn: () => cartelaAdminApi.list({ page: String(page), limit: String(PAGE_SIZE) }).then((r) => r.data),
  });

  const cartelas = resp?.data ?? [];
  const total = resp?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const saveMutation = useMutation({
    mutationFn: ({ id, numbers }: { id: string; numbers: number[] }) => cartelaAdminApi.update(id, { numbers }),
    onSuccess: () => { invalidate(); setSelectedCartela(null); },
  });

  return (
    <div className="p-4 sm:p-6">
      {selectedCartela && (
        <BingoCardModal
          cartela={selectedCartela}
          onClose={() => setSelectedCartela(null)}
          onSave={(id, numbers) => saveMutation.mutate({ id, numbers })}
          isSaving={saveMutation.isPending}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Cartela Database</h1>
          <p className="text-sm text-gray-400 mt-0.5">Cards 1–2000 · click a card to view or edit numbers</p>
        </div>
        <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-xs font-medium">{total} cards</span>
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
              className="w-[68px] h-[68px] rounded-xl font-bold text-sm transition-all hover:scale-105 hover:shadow-lg flex items-center justify-center bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 shadow-sm">
              #{c.cardNumber ?? '?'}
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
          <span className="text-sm text-gray-500">Page {page} of {totalPages} · cards {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">
            Next
          </button>
        </div>
      )}
    </div>
  );
};
