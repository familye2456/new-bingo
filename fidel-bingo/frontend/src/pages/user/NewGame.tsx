import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userApi, gameApi } from '../../services/api';

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  numbers: number[];
  isActive: boolean;
}

const PATTERNS = [
  'Any', 'One Line', 'Two Lines', 'Three Lines',
  'Four Corners', 'Diagonal', 'Blackout',
];

const MIN_CARTELAS = 3;

export const NewGame: React.FC = () => {
  const navigate = useNavigate();

  const [bet, setBet] = useState(5);
  const [pattern, setPattern] = useState('Two Lines');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rememberActive, setRememberActive] = useState(true);
  const [fastIdInput, setFastIdInput] = useState('');
  const [showCartelaCheck, setShowCartelaCheck] = useState(false);

  const { data: cartelas = [], isLoading } = useQuery<CartelaRecord[]>({
    queryKey: ['my-cartelas'],
    queryFn: () => userApi.myCartelas().then((r) => r.data.data),
  });

  // Filter: if rememberActive, only show active cartelas
  const visibleCartelas = useMemo(
    () => rememberActive ? cartelas.filter((c) => c.isActive) : cartelas,
    [cartelas, rememberActive]
  );

  const createMutation = useMutation({
    mutationFn: () =>
      gameApi.create({
        cartelaIds: Array.from(selectedIds),
        betAmountPerCartela: bet,
        winPattern: pattern.toLowerCase().replace(' ', ''),
      }),
    onSuccess: (res) => navigate(`/dashboard/play?gameId=${res.data.data.id}`),
  });

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Fast ID entry — select cartela by card number
  const handleFastId = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const num = parseInt(fastIdInput.trim(), 10);
    const found = cartelas.find((c) => c.cardNumber === num);
    if (found) {
      setSelectedIds((prev) => { const n = new Set(prev); n.add(found.id); return n; });
      setFastIdInput('');
    }
  };

  const canStart = selectedIds.size >= MIN_CARTELAS;
  const needed = Math.max(0, MIN_CARTELAS - selectedIds.size);

  return (
    <div className="min-h-full flex flex-col" style={{ background: '#0e1a35', color: '#fff' }}>

      {/* ── Toolbar ── */}
      <div className="px-5 pt-4 pb-3 border-b border-white/10 space-y-3">

        {/* Row 1: Bet + House + Pattern */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Bet */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300">Bet Birr:</span>
            <button onClick={() => setBet((b) => Math.max(1, b - 1))}
              className="w-7 h-7 rounded-md bg-red-600 hover:bg-red-500 text-white font-bold text-lg flex items-center justify-center">−</button>
            <span className="w-10 text-center font-bold text-white text-base">{bet}</span>
            <button onClick={() => setBet((b) => b + 1)}
              className="w-7 h-7 rounded-md bg-green-600 hover:bg-green-500 text-white font-bold text-lg flex items-center justify-center">+</button>
          </div>

          {/* House */}
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <span>House</span>
            <span className="text-gray-500">🔒</span>
            <span>👑</span>
          </div>

          {/* Pattern */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300">Pattern:</span>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="bg-[#1a2a4a] border border-white/20 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-yellow-400"
            >
              {PATTERNS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowCartelaCheck((v) => !v)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-lg text-sm">
            Cartela Check ✓
          </button>

          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Enter ID (Fast)"
              value={fastIdInput}
              onChange={(e) => setFastIdInput(e.target.value)}
              onKeyDown={handleFastId}
              className="bg-[#1a2a4a] border border-white/20 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:border-yellow-400"
            />
          </div>

          {/* Status chip */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${
            canStart ? 'bg-green-700 text-white' : 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40'
          }`}>
            {!canStart && <span>⚠</span>}
            {canStart
              ? `✓ ${selectedIds.size} cartelas ready`
              : `${selectedIds.size}/${MIN_CARTELAS} cartelas (need ${needed} more)`}
          </div>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!canStart || createMutation.isPending}
            className="bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors">
            {createMutation.isPending ? 'Starting...' : `Start Game (${selectedIds.size}/${MIN_CARTELAS})`}
          </button>

          {createMutation.isError && (
            <span className="text-red-400 text-xs">
              {(createMutation.error as any)?.response?.data?.message ?? 'Error'}
            </span>
          )}
        </div>

        {/* Row 3: Selected count + Remember Active */}
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300">Selected Cards ({selectedIds.size})</span>
          <button
            onClick={() => setRememberActive((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              rememberActive ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}>
            {rememberActive ? '✓' : ''} Remember Active
          </button>
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-400 hover:text-red-400 underline">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Cartela Check Modal ── */}
      {showCartelaCheck && (
        <CartelaCheckModal
          cartelas={cartelas}
          selectedIds={selectedIds}
          onClose={() => setShowCartelaCheck(false)}
        />
      )}

      {/* ── Card Grid ── */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {isLoading ? (
          <div className="text-center py-20 text-gray-400">Loading cartelas...</div>
        ) : visibleCartelas.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <div className="text-4xl mb-3">🎴</div>
            <div>No cartelas assigned. Contact admin.</div>
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-400 mb-3">Total Cartelas: {visibleCartelas.length}</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
              {visibleCartelas.map((c) => {
                const sel = selectedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={`rounded-xl font-bold text-sm py-3 transition-all border-2 ${
                      sel
                        ? 'bg-blue-600 border-blue-400 text-white scale-105 shadow-lg shadow-blue-900/50'
                        : 'bg-[#d0d4dc] border-transparent text-gray-900 hover:bg-[#b8bcc8]'
                    }`}
                  >
                    {c.cardNumber ?? '?'}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Cartela Check Modal ───────────────────────────────────────────────────────

const COLS = ['B', 'I', 'N', 'G', 'O'];

const CartelaCheckModal: React.FC<{
  cartelas: CartelaRecord[];
  selectedIds: Set<string>;
  onClose: () => void;
}> = ({ cartelas, selectedIds, onClose }) => {
  const [search, setSearch] = useState('');
  const num = parseInt(search, 10);
  const found = cartelas.find((c) => c.cardNumber === num);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1a2a4a] rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-yellow-400 font-bold text-lg mb-4">Cartela Check</div>
        <input
          autoFocus
          type="number"
          placeholder="Enter card number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0e1a35] border border-white/20 text-white rounded-xl px-4 py-2 mb-4 focus:outline-none focus:border-yellow-400"
        />
        {found ? (
          <div>
            <div className="text-center text-yellow-400 font-bold mb-2">
              Card #{found.cardNumber}
              {selectedIds.has(found.id) && <span className="ml-2 text-green-400 text-xs">✓ Selected</span>}
            </div>
            <div className="grid grid-cols-5 gap-1 mb-1">
              {COLS.map((c) => (
                <div key={c} className="text-center text-xs font-bold text-gray-900 bg-yellow-400 rounded py-1">{c}</div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {found.numbers.map((n, i) => (
                <div key={i} className={`text-center text-xs rounded py-1.5 font-medium ${
                  i === 12 ? 'bg-yellow-400 text-gray-900 font-bold' : 'bg-[#0e1a35] text-gray-200'
                }`}>
                  {i === 12 ? '★' : n}
                </div>
              ))}
            </div>
          </div>
        ) : search ? (
          <div className="text-center text-gray-400 text-sm">Card #{search} not found in your cartelas</div>
        ) : null}
        <button onClick={onClose} className="mt-4 w-full bg-gray-700 text-gray-300 py-2 rounded-xl text-sm hover:bg-gray-600">
          Close
        </button>
      </div>
    </div>
  );
};
