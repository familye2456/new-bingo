import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineUserApi } from '../../services/offlineApi';
import { api } from '../../services/api';

const COLS = ['B', 'I', 'N', 'G', 'O'];
const RANGES = [[1,15],[16,30],[31,45],[46,60],[61,75]];

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  numbers: number[];
  isActive: boolean;
  assignedAt: string;
}

// ── Bingo Card ────────────────────────────────────────────────────────────────
const BingoCard: React.FC<{ cartela: CartelaRecord }> = ({ cartela }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-20 h-20 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900 font-bold text-sm hover:scale-105 transition-transform shadow flex items-center justify-center">
        #{cartela.cardNumber ?? '?'}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-[#1e1e1e] rounded-2xl p-5 w-72 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
            <button onClick={() => setOpen(false)} className="mt-4 w-full bg-gray-700 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-600">Close</button>
          </div>
        </div>
      )}
    </>
  );
};

// ── Manual Grid Editor ────────────────────────────────────────────────────────
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

const ManualEditor: React.FC<{ onClose: () => void; onSave: (nums: number[]) => void; saving: boolean }> = ({ onClose, onSave, saving }) => {
  const [grid, setGrid] = useState<number[]>(generateNumbers);

  const setCell = (idx: number, val: string) => {
    const n = parseInt(val, 10);
    setGrid(g => { const next = [...g]; next[idx] = isNaN(n) ? 0 : n; return next; });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1e1e1e] rounded-2xl p-5 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-yellow-400 font-bold text-base">Edit Numbers</span>
          <button onClick={() => setGrid(generateNumbers())} className="text-xs text-gray-400 hover:text-yellow-400 px-2 py-1 rounded-lg bg-white/5">
            🔀 Randomize
          </button>
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
            const isFree = idx === 12;
            if (isFree) return (
              <div key={idx} className="flex items-center justify-center rounded-lg aspect-square text-xs font-black bg-gradient-to-b from-yellow-400 to-yellow-500 text-gray-900">FREE</div>
            );
            return (
              <input key={idx} type="number" value={num || ''} onChange={e => setCell(idx, e.target.value)}
                className="w-full aspect-square rounded-lg bg-[#2d2d2d] text-white text-center text-xs font-bold border border-white/10 focus:outline-none focus:border-yellow-400 p-0" />
            );
          })}
        </div>
        <div className="flex gap-2">
          <button onClick={() => onSave(grid)} disabled={saving}
            className="flex-1 bg-yellow-400 text-gray-900 py-2 rounded-xl text-sm font-bold hover:bg-yellow-300 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Cartela'}
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
  const [showModal, setShowModal] = useState<'generate' | 'manual' | null>(null);

  const { data: cartelas = [], isLoading } = useQuery<CartelaRecord[]>({
    queryKey: ['my-cartelas'],
    queryFn: async () => {
      const list = await offlineUserApi.myCartelas();
      return [...list].sort((a, b) => (a.cardNumber ?? 0) - (b.cardNumber ?? 0));
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/cartelas/generate'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-cartelas'] }); setShowModal(null); },
  });

  const manualMutation = useMutation({
    mutationFn: (numbers: number[]) => api.post('/cartelas/generate', { numbers }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-cartelas'] }); setShowModal(null); },
  });

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">My Cartelas</h1>
          <p className="text-sm text-gray-500 mt-0.5">{cartelas.length} cards assigned</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowModal('generate')}
            className="flex items-center gap-1.5 bg-yellow-400 text-gray-900 px-4 py-2 rounded-xl text-sm font-bold hover:bg-yellow-300 transition-colors shadow">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Generate
          </button>
          <button onClick={() => setShowModal('manual')}
            className="flex items-center gap-1.5 bg-white/10 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-white/20 transition-colors border border-white/10">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Manual
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : cartelas.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🎴</div>
          <div className="text-sm mb-4">No cartelas yet. Generate one to get started.</div>
          <button onClick={() => setShowModal('generate')}
            className="bg-yellow-400 text-gray-900 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-yellow-300">
            Generate Cartela
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {cartelas.map((c) => <BingoCard key={c.id} cartela={c} />)}
        </div>
      )}

      {/* Generate confirm modal */}
      {showModal === 'generate' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(null)}>
          <div className="bg-[#1e1e1e] rounded-2xl p-6 w-72 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">🎲</div>
            <div className="text-white font-bold text-base mb-1">Generate Cartela</div>
            <div className="text-gray-400 text-sm mb-5">A new bingo card with random numbers will be created for you.</div>
            <div className="flex gap-2">
              <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
                className="flex-1 bg-yellow-400 text-gray-900 py-2.5 rounded-xl font-bold text-sm hover:bg-yellow-300 disabled:opacity-50">
                {generateMutation.isPending ? 'Generating...' : 'Generate'}
              </button>
              <button onClick={() => setShowModal(null)} className="flex-1 bg-white/10 text-gray-300 py-2.5 rounded-xl text-sm hover:bg-white/20">Cancel</button>
            </div>
            {generateMutation.isError && <p className="text-red-400 text-xs mt-2">Failed. Try again.</p>}
          </div>
        </div>
      )}

      {/* Manual editor modal */}
      {showModal === 'manual' && (
        <ManualEditor
          onClose={() => setShowModal(null)}
          onSave={(nums) => manualMutation.mutate(nums)}
          saving={manualMutation.isPending}
        />
      )}
    </div>
  );
};
