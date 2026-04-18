import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineUserApi, offlineGameApi } from '../../services/offlineApi';
import { useGameSettings } from '../../store/gameSettingsStore';
import { useAuthStore } from '../../store/authStore';
import { playCachedSound, isVoiceFullyCached } from '../../services/db';

let _userInteracted = false;
if (typeof window !== 'undefined') {
  const mark = () => { _userInteracted = true; };
  window.addEventListener('click', mark, { once: true });
  window.addEventListener('keydown', mark, { once: true });
}

// Always reads latest voice from store — never stale
function playSound(name: string) {
  if (!_userInteracted) return;
  const category = useGameSettings.getState().voice;
  const ext = category === 'boy sound' ? '.wav' : '.mp3';
  const file = name.includes('.') ? name : `${name}${ext}`;
  playCachedSound(`/sounds/${encodeURIComponent(category)}/${file}`).catch(() => {});
}

// Play a root-level sound (not category-specific), works offline via cache
function playRootSound(filename: string): Promise<void> {
  if (!_userInteracted) return Promise.resolve();
  return playCachedSound(`/sounds/${filename}`);
}

interface CartelaRecord {
  id: string;
  cardNumber?: number;
  numbers: number[];
  isActive: boolean;
}

const PATTERNS: { label: string; value: string; icon: string }[] = [
  { label: 'One Line',     value: 'line1',       icon: '━' },
  { label: 'Two Lines',    value: 'line2',       icon: '≡' },
  { label: 'Three Lines',  value: 'line3',       icon: '☰' },
  { label: 'Full House',   value: 'fullhouse',   icon: '⬛' },
  { label: 'Four Corners', value: 'fourCorners', icon: '⬜' },
  { label: 'X Shape',      value: 'X',           icon: '✕' },
  { label: 'Plus',         value: 'plus',        icon: '✚' },
  { label: 'T Shape',      value: 'T',           icon: '⊤' },
  { label: 'L Shape',      value: 'L',           icon: '⌐' },
  { label: 'Frame',        value: 'frame',         icon: '▣' },
  { label: 'Middle Corners', value: 'middleCorners', icon: '✦' },
];

const MIN_CARTELAS = 3;

const LS_KEY = 'newgame_prefs';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { bet: number; pattern: string; selectedIds: string[]; houseCut: number | '' };
  } catch { return null; }
}

function savePrefs(bet: number, pattern: string, selectedIds: Set<string>, houseCut: number | '') {
  localStorage.setItem(LS_KEY, JSON.stringify({ bet, pattern, selectedIds: Array.from(selectedIds), houseCut }));
}

export const NewGame: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { voice } = useGameSettings();
  const { user, refreshBalance } = useAuthStore();
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const _prefs = loadPrefs();
  const [bet, setBet] = useState(_prefs?.bet ?? 10);
  const [houseCut, setHouseCut] = useState<number | ''>(_prefs?.houseCut ?? 25);
  const [pattern, setPattern] = useState(_prefs?.pattern ?? 'line2');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(_prefs?.selectedIds ?? []));
  const [rememberActive, setRememberActive] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState('');
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [voiceCached, setVoiceCached] = useState(true); // optimistic

  useEffect(() => {
    if (!navigator.onLine) {
      isVoiceFullyCached(voice).then(setVoiceCached);
    } else {
      setVoiceCached(true);
    }
  }, [voice]);

  // Persist whenever any selection changes
  useEffect(() => { savePrefs(bet, pattern, selectedIds, houseCut); }, [bet, pattern, selectedIds, houseCut]);

  const { data: cartelas = [], isLoading } = useQuery<CartelaRecord[]>({
    queryKey: ['my-cartelas', user?.id],
    queryFn: () => offlineUserApi.myCartelas(),
  });

  // Remove stale selectedIds that no longer exist in the user's cartela list
  useEffect(() => {
    if (cartelas.length === 0) return;
    const validIds = new Set(cartelas.map(c => c.id));
    setSelectedIds(prev => {
      const filtered = new Set([...prev].filter(id => validIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [cartelas]);

  const visibleCartelas = useMemo(() => {
    const list = rememberActive ? cartelas.filter((c) => c.isActive) : cartelas;
    return [...list].sort((a, b) => (a.cardNumber ?? 0) - (b.cardNumber ?? 0));
  }, [cartelas, rememberActive]);

  const createMutation = useMutation({
    mutationFn: () => {
      // Filter out any stale IDs that are no longer in the user's cartela list
      const validIds = Array.from(selectedIds).filter(id => cartelas.some(c => c.id === id));
      return offlineGameApi.create({
        cartelaIds: validIds,
        betAmountPerCartela: bet,
        winPattern: pattern,
        housePercentage: houseCut as number,
      });
    },
    onSuccess: (res) => {
      playRootSound('start.wav');
      const game = res?.data?.data?.data ?? res?.data?.data ?? res?.data;
      const id = game?.id;
      if (id) {
        const hc = typeof houseCut === 'number' ? houseCut : 10;
        const totalBets = bet * selectedIds.size;
        const houseCutAmt = totalBets * hc / 100;
        const newGame = {
          ...game,
          betAmount: bet,
          cartelaCount: selectedIds.size,
          totalBets,
          houseCut: houseCutAmt,
          housePercentage: hc,
          prizePool: totalBets - houseCutAmt,
          winPattern: pattern,
          status: game.status ?? 'active',
          createdAt: game.createdAt ?? new Date().toISOString(),
        };
        // Inject into query cache so PlayBingo sees it immediately
        queryClient.setQueryData(['games'], (old: any[] = []) =>
          old.some((g) => g.id === newGame.id) ? old : [newGame, ...old]
        );
        queryClient.setQueryData(['my-games'], (old: any[] = []) =>
          old.some((g) => g.id === newGame.id) ? old : [newGame, ...old]
        );
        navigate(`/play?gameId=${id}`);
      }
    },
    onError: (err: any) => {
      console.error('[createGame]', err?.response?.data ?? err.message);
    },
  });

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleQuickAdd = (val: string) => {
    const num = parseInt(val, 10);
    const found = cartelas.find((c) => c.cardNumber === num);
    if (found) {
      toggle(found.id);
      setQuickAddValue('');
    }
  };
  const houseCutValid = typeof houseCut === 'number' && houseCut >= 10 && houseCut <= 45;
  const canStart = selectedIds.size >= MIN_CARTELAS && houseCutValid && voiceCached;
  const totalPrize = bet * selectedIds.size;

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a1220', color: '#fff' }}>

      {/* ── Header ── */}
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white font-extrabold text-xl tracking-wide">New Game</h1>
            <p className="text-gray-500 text-xs mt-0.5">Configure and launch a bingo session</p>
          </div>

        </div>

        {/* Config row */}
        <div className="flex items-center gap-2 flex-wrap">

          {/* Bet control */}
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Bet</span>
            <button onClick={() => setBet((b) => Math.max(5, b - 5))}
              className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:brightness-125"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              −
            </button>
            <span className="w-10 text-center font-extrabold text-yellow-400 text-sm">{bet}</span>
            <button onClick={() => setBet((b) => b + 5)}
              className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-sm transition-all hover:brightness-125"
              style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
              +
            </button>
            <span className="text-gray-600 text-[10px] ml-1">BIRR</span>
          </div>

          {/* House cut */}
          <HouseCutPicker value={houseCut} onChange={setHouseCut} />

          {/* Pattern select */}
          <div className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Pattern</span>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="bg-transparent text-white text-sm font-semibold focus:outline-none cursor-pointer"
              style={{ color: '#fbbf24' }}>
              {PATTERNS.map((p) => (
                <option key={p.value} value={p.value} style={{ background: '#0f1e35' }}>
                  {p.icon} {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Start Game */}
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canStart || createMutation.isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-all hover:brightness-125 disabled:opacity-30 disabled:cursor-not-allowed ml-auto"
            style={canStart ? {
              background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
              color: '#111',
              boxShadow: '0 2px 12px rgba(251,191,36,0.3)',
            } : {
              background: 'rgba(255,255,255,0.06)',
              color: '#4b5563',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
            {createMutation.isPending ? '...' : canStart ? `▶ Start · ${selectedIds.size}` : !houseCutValid ? `Set house %` : !voiceCached ? '⬇ Download sounds first' : `▶ Start (${selectedIds.size}/${MIN_CARTELAS})`}
          </button>
        </div>
        {createMutation.isError && (
          <div className="text-red-400 text-xs mt-2">
            {(createMutation.error as any)?.response?.data?.error?.message ?? 'Failed to start game. Try again.'}
          </div>
        )}
      </div>

      {/* ── Selection bar ── */}
      <div className="px-4 sm:px-5 py-2.5 flex items-center gap-3 shrink-0"
        style={{ background: 'rgba(0,0,0,0.15)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>

        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-gray-500">
            {visibleCartelas.length} cartelas
          </span>
          <span className="text-gray-700">·</span>
          <span className={`text-xs font-semibold ${canStart ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {selectedIds.size} selected
            {!canStart && ` (need ${Math.max(0, MIN_CARTELAS - selectedIds.size)} more)`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setRememberActive((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
            style={rememberActive
              ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
              : { background: 'rgba(255,255,255,0.05)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.08)' }}>
            {rememberActive ? '✓' : '○'} Active only
          </button>
          {showQuickAdd ? (
            <input
              ref={quickAddRef}
              autoFocus
              type="number"
              value={quickAddValue}
              onChange={(e) => {
                setQuickAddValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { handleQuickAdd(quickAddValue); }
                if (e.key === 'Escape') { setShowQuickAdd(false); setQuickAddValue(''); }
              }}
              onBlur={() => { setShowQuickAdd(false); setQuickAddValue(''); }}
              placeholder="Card #"
              className="w-20 text-xs px-2.5 py-1 rounded-lg font-bold focus:outline-none"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}
            />
          ) : (
            <button
              onClick={() => setShowQuickAdd(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-bold transition-all hover:brightness-125"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>
              ＋ Quick Add
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Card Grid ── */}
      <div className="flex-1 overflow-auto px-3 sm:px-4 py-4 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-8 h-8 rounded-full border-2 border-yellow-400/30 border-t-yellow-400 animate-spin mx-auto mb-3" />
              <div className="text-gray-500 text-sm">Loading cartelas...</div>
            </div>
          </div>
        ) : visibleCartelas.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="text-5xl mb-4">🎴</div>
              <div className="text-gray-400 font-medium">No cartelas available</div>
              <div className="text-gray-600 text-sm mt-1">Contact admin to get cartelas assigned</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
            {visibleCartelas.map((c) => {
              const sel = selectedIds.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className="rounded-xl font-bold text-sm py-3 transition-all duration-150"
                  style={sel ? {
                    background: 'linear-gradient(180deg,#3b82f6,#2563eb)',
                    color: '#fff',
                    border: '2px solid #60a5fa',
                    boxShadow: '0 0 12px rgba(59,130,246,0.4)',
                    transform: 'scale(1.06)',
                  } : {
                    background: 'rgba(255,255,255,0.07)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                  {c.cardNumber ?? '?'}
                </button>
              );
            })}
          </div>
        )}
      </div>



    </div>
  );
};

// ── HouseCutPicker ────────────────────────────────────────────────────────────
const HOUSE_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45];

const HouseCutPicker: React.FC<{
  value: number | '';
  onChange: (v: number | '') => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all hover:brightness-125"
        style={{
          background: open
            ? 'rgba(251,191,36,0.1)'
            : value !== ''
            ? 'rgba(251,191,36,0.08)'
            : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open || value !== '' ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.08)'}`,
          color: value !== '' ? '#fbbf24' : '#6b7280',
          minWidth: '90px',
        }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: value !== '' ? 'rgba(251,191,36,0.6)' : '#4b5563' }}>
          House
        </span>
        <span className="flex-1 text-center">
          {value !== '' ? `${value}%` : '—'}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          className="w-3 h-3 shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: value !== '' ? '#fbbf24' : '#4b5563' }}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 rounded-2xl overflow-hidden z-50"
          style={{
            background: 'linear-gradient(180deg, #0f1e35 0%, #0a1628 100%)',
            border: '1px solid rgba(251,191,36,0.2)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
            width: '110px',
          }}>
          <div className="py-1" style={{ maxHeight: '111px', overflowY: 'auto' }}>
            {HOUSE_OPTIONS.map((v, i) => {
              const selected = value === v;
              return (
                <button key={v}
                  onClick={() => { onChange(v); setOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold transition-all"
                  style={{
                    background: selected ? 'rgba(251,191,36,0.12)' : 'transparent',
                    color: selected ? '#fbbf24' : '#94a3b8',
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}
                  onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected ? 'rgba(251,191,36,0.12)' : 'transparent'; }}>
                  <span>{v}%</span>
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="rounded-2xl p-5 w-80 flex flex-col gap-4"
        style={{ background: '#0f1e35', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <span className="text-yellow-400 font-extrabold text-base tracking-wide">Cartela Check</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <input
          autoFocus
          type="number"
          placeholder="Enter card number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl px-4 py-2.5 text-sm focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
        />

        {found ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-yellow-400 font-bold text-sm">Card #{found.cardNumber}</span>
              {selectedIds.has(found.id) && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
                  ✓ Selected
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1 mb-1">
              {COLS.map((c) => (
                <div key={c} className="text-center text-xs font-extrabold text-gray-900 rounded-lg py-1.5"
                  style={{ background: 'linear-gradient(180deg,#fbbf24,#f59e0b)' }}>
                  {c}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {found.numbers.map((n, i) => (
                <div key={i}
                  className="text-center text-xs rounded-lg py-2 font-semibold"
                  style={i === 12
                    ? { background: 'linear-gradient(180deg,#fbbf24,#f59e0b)', color: '#111' }
                    : { background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {i === 12 ? '★' : n}
                </div>
              ))}
            </div>
          </div>
        ) : search ? (
          <div className="text-center text-gray-500 text-sm py-4">
            Card #{search} not found
          </div>
        ) : null}

        <button onClick={onClose}
          className="w-full py-2 rounded-xl text-sm font-medium transition-all hover:brightness-125"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
          Close
        </button>
      </div>
    </div>
  );
};
