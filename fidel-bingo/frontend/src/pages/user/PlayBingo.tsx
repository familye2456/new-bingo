import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';
import { useGameSettings } from '../../store/gameSettingsStore';

let _userInteracted = false;
if (typeof window !== 'undefined') {
  const mark = () => { _userInteracted = true; };
  window.addEventListener('click', mark, { once: true });
  window.addEventListener('keydown', mark, { once: true });
}

function playSound(name: string, category: string) {
  if (!_userInteracted) return;
  new Audio(`/sounds/${encodeURIComponent(category)}/${name}`).play().catch(() => {});
}

interface Game {
  id: string;
  gameNumber?: number;
  status: string;
  betAmount: number;
  prizePool: number;
  cartelaCount: number;
  creatorId: string;
  calledNumbers: number[];
  winPattern?: string;
}

const ROWS_DEF = [
  { letter: 'B', start: 1 },
  { letter: 'I', start: 16 },
  { letter: 'N', start: 31 },
  { letter: 'G', start: 46 },
  { letter: 'O', start: 61 },
];

export const PlayBingo: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { refreshBalance } = useAuthStore();
  const { voice } = useGameSettings();
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const queryClient = useQueryClient();

  const [selectedGameId, setSelectedGameId] = useState<string | null>(searchParams.get('gameId'));
  const [autoOn, setAutoOn] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [checkId, setCheckId] = useState('');
  const [checkResult, setCheckResult] = useState<{
    registered: boolean; isWinner: boolean; winPattern: string | null;
    numbers?: number[]; patternMask?: boolean[];
  } | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sessionCalledNumbers, setSessionCalledNumbers] = useState<number[]>([]);

  const { data: allGames = [], isLoading } = useQuery<Game[]>({
    queryKey: ['games'],
    queryFn: () => offlineGameApi.list(),
    refetchInterval: 3000,
  });

  // Only show games belonging to the current user
  const games = allGames.filter((g) => g.creatorId === user?.id);
  const activeGames = games.filter((g) => g.status === 'active');
  const game = selectedGameId
    ? games.find((g) => g.id === selectedGameId) ?? null
    : activeGames[0] ?? null;

  useEffect(() => {
    if (isLoading) return;
    // Only redirect if we have no gameId in URL and no active games
    if (activeGames.length === 0 && !selectedGameId) {
      // Small delay to allow the newly created game to appear in the list
      const t = setTimeout(() => navigate('/new-game', { replace: true }), 1500);
      return () => clearTimeout(t);
    }
  }, [isLoading, activeGames.length, selectedGameId, navigate]);

  // Reset called numbers on mount so the board is always clean after a reload
  const resetDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    if (resetDoneRef.current === game.id) return;
    resetDoneRef.current = game.id;
    setSessionCalledNumbers([]);
    offlineGameApi.reset(game.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
    }).catch(() => {});
    // Pre-cache cartelas for this game so offline check works
    offlineGameApi.getCartelas(game.id).catch(() => {});
  }, [game?.id]);

  const stopAuto = useCallback(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    setAutoOn(false);
  }, []);

  const callMutation = useMutation({
    mutationFn: () => offlineGameApi.callNumber(game!.id),
    onSuccess: (response: any) => {
      const num: number | null = response?.data?.data?.number ?? response?.data?.number ?? null;
      if (num != null) setSessionCalledNumbers((prev) => prev.includes(num) ? prev : [...prev, num]);
      queryClient.invalidateQueries({ queryKey: ['games'] });
    },
    onError: (err: any) => { console.error('[callNumber]', err?.response?.data ?? err.message); stopAuto(); },
  });

  const finishMutation = useMutation({
    mutationFn: () => offlineGameApi.finish(game!.id),
    onSuccess: () => {
      stopAuto();
      queryClient.invalidateQueries({ queryKey: ['games'] });
      refreshBalance();
      navigate('/new-game');
    },
  });

  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);
  const sessionCalledRef = useRef(sessionCalledNumbers);
  useEffect(() => { sessionCalledRef.current = sessionCalledNumbers; }, [sessionCalledNumbers]);

  const startAuto = useCallback(() => {
    if (!game || game.status !== 'active') return;
    setAutoOn(true);
    autoRef.current = setInterval(() => {
      if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
      callMutation.mutate();
    }, speed * 1000);
  }, [game, speed, callMutation, stopAuto]);

  useEffect(() => { if (autoOn) { stopAuto(); startAuto(); } }, [speed]); // eslint-disable-line
  useEffect(() => () => stopAuto(), [stopAuto]);
  useEffect(() => { if (sessionCalledNumbers.length >= 75 && autoOn) stopAuto(); }, [sessionCalledNumbers.length, autoOn, stopAuto]);

  const toggleAuto = () => autoOn ? stopAuto() : startAuto();

  const handleCheck = async () => {
    const num = parseInt(checkId.trim(), 10);
    if (!game || isNaN(num)) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const result = await offlineGameApi.checkCartela(game.id, num);
      setCheckResult(result);
      if (result.registered) {
        const isBoy = voiceRef.current === 'boy sound';
        if (result.isWinner) {
          playSound(isBoy ? 'winner.wav' : 'winner.mp3', voiceRef.current);
        } else if (isBoy) {
          playSound('notwinner.wav', voiceRef.current);
        }
      }
    } catch {
      setCheckResult({ registered: false, isWinner: false, winPattern: null });
    } finally {
      setCheckLoading(false);
    }
  };
  const calledNumbers = sessionCalledNumbers;
  const lastNumber = calledNumbers.length > 0 ? calledNumbers[calledNumbers.length - 1] : null;
  const isCreator = game?.creatorId === user?.id;

  const prevCalledRef = useRef<number[]>([]);
  useEffect(() => {
    const newNums = sessionCalledNumbers.filter((n) => !prevCalledRef.current.includes(n));
    if (newNums.length > 0) playSound(`${newNums[newNums.length - 1]}.wav`, voiceRef.current);
    prevCalledRef.current = sessionCalledNumbers;
  }, [sessionCalledNumbers]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0a1220' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 pl-14 pr-3 py-2 shrink-0"
        style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

        {/* Game title */}
        <h1 className="text-yellow-400 font-extrabold text-lg sm:text-xl tracking-widest shrink-0">
          {game ? `GAME #${game.gameNumber ?? game.id.slice(0, 6).toUpperCase()}` : 'BINGO'}
        </h1>

        {/* Info chips — scroll on small screens */}
        {game && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 mx-2">
            <InfoChip label={`${calledNumbers.length}/75`} highlight />
            <InfoChip label={`BET ${Number(game.betAmount * game.cartelaCount).toFixed(0)} ₿`} />
            <InfoChip label={`WIN ${Number(game.prizePool).toFixed(1)} ₿`} />
            <InfoChip label={`${game.cartelaCount} CARTELA`} />
          </div>
        )}

        {/* Right actions */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {activeGames.filter((g) => g.id !== game?.id).slice(0, 2).map((g) => (
            <button key={g.id} onClick={() => { setSelectedGameId(g.id); resetDoneRef.current = null; }}
              className="text-xs bg-white/10 hover:bg-white/20 text-gray-300 px-2.5 py-1 rounded-lg hidden sm:block">
              #{g.gameNumber ?? g.id.slice(0, 6)}
            </button>
          ))}
          <button onClick={() => navigate('/new-game')}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
            + New
          </button>
        </div>
      </div>

      {/* ── Number Board ── */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-3 min-h-0">
        {game ? (
          <NumberBoard calledNumbers={calledNumbers} lastNumber={lastNumber} />
        ) : (
          <div className="text-center">
            <div className="text-5xl mb-4">🎱</div>
            <div className="text-gray-400 mb-4">No active game</div>
            <button onClick={() => navigate('/new-game')}
              className="bg-yellow-400 text-gray-900 font-bold px-6 py-3 rounded-xl">
              Start New Game
            </button>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      {game && (
        <div className="shrink-0 px-3 py-3"
          style={{ background: 'rgba(0,0,0,0.35)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Buttons */}
          <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
            <CtrlBtn
              label={autoOn ? '⏸ Auto' : '▶ Auto'}
              active={autoOn}
              onClick={toggleAuto}
              disabled={!isCreator || game.status !== 'active' || calledNumbers.length >= 75}
            />
            <CtrlBtn
              label="Next ›"
              onClick={() => callMutation.mutate()}
              disabled={!isCreator || game.status !== 'active' || callMutation.isPending || calledNumbers.length >= 75}
            />
            <CtrlBtn
              label={finishMutation.isPending ? '...' : 'Finish'}
              onClick={() => { stopAuto(); finishMutation.mutate(); }}
              disabled={!isCreator || game.status !== 'active' || finishMutation.isPending}
              danger
            />
            <CtrlBtn
              label="🔀"
              purple
              onClick={() => { playSound('shuffle-audio-TfqyAnvz.mp3', voiceRef.current); setTimeout(() => window.location.reload(), 3000); }}
            />
          </div>

          {/* Speed + Check */}
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Speed</span>
              <input type="range" min={1} max={10} step={1} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-24 accent-yellow-400" />
              <span className="text-yellow-400 font-bold text-sm w-6 text-center">{speed}s</span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text" placeholder="Card #" value={checkId}
                  onChange={(e) => { setCheckId(e.target.value); setCheckResult(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                  className="rounded-xl px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-yellow-400/50"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                />
                <button
                  onClick={handleCheck}
                  disabled={checkLoading || !checkId}
                  className="font-bold px-4 py-1.5 rounded-xl text-sm disabled:opacity-40"
                  style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                  {checkLoading ? '...' : 'Check'}
                </button>
              </div>
              {checkResult && (
                <>
                  <div className="text-xs font-semibold px-3 py-1 rounded-lg"
                    style={
                      !checkResult.registered
                        ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }
                        : checkResult.isWinner
                        ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                        : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }
                    }>
                    {!checkResult.registered
                      ? `Card #${checkId} not registered`
                      : checkResult.isWinner
                      ? `🎉 BINGO! (${checkResult.winPattern})`
                      : `Card #${checkId} — no win yet`}
                  </div>
                  {checkResult.registered && checkResult.numbers && (
                    <CartelaPreviewModal
                      cardNumber={Number(checkId)}
                      numbers={checkResult.numbers}
                      patternMask={checkResult.patternMask ?? []}
                      winPattern={checkResult.isWinner ? (checkResult.winPattern ?? null) : null}
                      lastCalledNumber={lastNumber}
                      onClose={() => setCheckResult(null)}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── InfoChip ──────────────────────────────────────────────────────────────────
const InfoChip: React.FC<{ label: string; highlight?: boolean }> = ({ label, highlight }) => (
  <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
    style={highlight
      ? { background: 'rgba(251,191,36,0.2)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }
      : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
    {label}
  </span>
);

// ── CtrlBtn ───────────────────────────────────────────────────────────────────
const CtrlBtn: React.FC<{
  label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; purple?: boolean; danger?: boolean;
}> = ({ label, onClick, disabled, active, purple, danger }) => {
  let bg = 'rgba(251,191,36,0.15)';
  let color = '#fbbf24';
  let border = '1px solid rgba(251,191,36,0.3)';
  if (active) { bg = '#fbbf24'; color = '#111'; border = 'none'; }
  if (purple) { bg = 'rgba(147,51,234,0.2)'; color = '#c084fc'; border = '1px solid rgba(147,51,234,0.3)'; }
  if (danger) { bg = 'rgba(239,68,68,0.15)'; color = '#f87171'; border = '1px solid rgba(239,68,68,0.3)'; }

  return (
    <button onClick={onClick} disabled={disabled}
      className="px-4 sm:px-5 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-30 hover:brightness-125"
      style={{ background: bg, color, border }}>
      {label}
    </button>
  );
};

// ── NumberBoard ───────────────────────────────────────────────────────────────
const NumberBoard: React.FC<{ calledNumbers: number[]; lastNumber: number | null }> = ({
  calledNumbers, lastNumber,
}) => (
  <div className="w-full h-full flex flex-col justify-center gap-1" role="region" aria-label="Bingo number board"
    style={{ maxWidth: '100%' }}>
    {ROWS_DEF.map(({ letter, start }) => (
      <div key={letter} className="flex items-center gap-1 min-h-0">
        {/* Letter */}
        <div className="flex items-center justify-center font-extrabold text-gray-900 rounded-lg shrink-0"
          style={{
            width: 'clamp(28px, 4vw, 48px)',
            height: 'clamp(28px, 4vw, 48px)',
            fontSize: 'clamp(12px, 2vw, 20px)',
            background: 'linear-gradient(180deg,#fbbf24,#f59e0b)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>
          {letter}
        </div>

        {/* 15 cells */}
        <div className="flex-1 grid gap-0.5 sm:gap-1" style={{ gridTemplateColumns: 'repeat(15,1fr)' }}>
          {Array.from({ length: 15 }, (_, i) => {
            const num = start + i;
            const called = calledNumbers.includes(num);
            const isLast = num === lastNumber;
            return (
              <div key={num}
                aria-label={`${num}${called ? ' called' : ''}`}
                className="flex items-center justify-center font-bold rounded-md transition-all duration-300 aspect-square"
                style={{
                  fontSize: 'clamp(8px, 1.4vw, 14px)',
                  background: isLast
                    ? 'linear-gradient(180deg,#fbbf24,#f59e0b)'
                    : called
                    ? 'linear-gradient(180deg,#ca8a04,#a16207)'
                    : 'linear-gradient(180deg,#1e3a5f,#152d4a)',
                  color: isLast ? '#111' : called ? '#111' : '#94a3b8',
                  boxShadow: isLast ? '0 0 12px rgba(251,191,36,0.7)' : called ? '0 0 6px rgba(202,138,4,0.4)' : 'none',
                  border: isLast ? '2px solid #fbbf24' : called ? '1px solid rgba(202,138,4,0.6)' : '1px solid rgba(255,255,255,0.05)',
                  transform: isLast ? 'scale(1.1)' : 'scale(1)',
                }}>
                {num}
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);

// ── CartelaPreviewModal ───────────────────────────────────────────────────────

/** Returns the flat indices (0-24) that are part of any completed winning line. */
function getWinIndices(mask: boolean[], pattern: string | null): number[] {
  if (!pattern) return [];

  const result = new Set<number>();

  const addRow = () => {
    for (let r = 0; r < 5; r++) {
      const idxs = [0,1,2,3,4].map(c => r*5+c);
      if (idxs.every(i => mask[i])) idxs.forEach(i => result.add(i));
    }
  };
  const addCol = () => {
    for (let c = 0; c < 5; c++) {
      const idxs = [0,1,2,3,4].map(r => r*5+c);
      if (idxs.every(i => mask[i])) idxs.forEach(i => result.add(i));
    }
  };
  const addDiags = () => {
    const main = [0,6,12,18,24]; if (main.every(i => mask[i])) main.forEach(i => result.add(i));
    const anti = [4,8,12,16,20]; if (anti.every(i => mask[i])) anti.forEach(i => result.add(i));
  };
  const addCorners = () => {
    if (mask[0] && mask[4] && mask[20] && mask[24]) [0,4,20,24].forEach(i => result.add(i));
  };

  // For line-based patterns, add all completed lines
  addRow(); addCol(); addDiags(); addCorners();

  if (pattern === 'fullhouse') return Array.from({length:25},(_,i)=>i);
  if (pattern === 'fourCorners') return result.size ? [0,4,20,24] : [];

  return Array.from(result);
}

const BINGO_LETTERS = ['B','I','N','G','O'];

const CartelaPreviewModal: React.FC<{
  cardNumber: number;
  numbers: number[];       // flat 25-element array
  patternMask: boolean[];  // flat 25-element boolean array
  winPattern: string | null;
  lastCalledNumber: number | null;
  onClose: () => void;
}> = ({ cardNumber, numbers, patternMask, winPattern, lastCalledNumber, onClose }) => {
  // Responsive cell size: smaller on mobile
  const CELL = typeof window !== 'undefined' && window.innerWidth < 400 ? 42 : 52;
  const GAP = 5;
  const GRID = 5 * CELL + 4 * GAP;

  const winIndices = getWinIndices(patternMask, winPattern);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-4 sm:p-5 flex flex-col items-center gap-3 my-auto"
        style={{ background: '#0f1e35', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title */}
        <div className="text-yellow-400 font-extrabold text-lg tracking-widest">Card #{cardNumber}</div>

        {/* Grid wrapper — position relative so SVG overlay sits on top */}
        <div className="relative" style={{ width: GRID, height: GRID }}>

          {/* BINGO header row */}
          <div className="absolute -top-9 left-0 right-0 flex gap-[6px]">
            {BINGO_LETTERS.map(l => (
              <div key={l}
                className="flex items-center justify-center font-extrabold text-gray-900 rounded-lg"
                style={{ width: CELL, height: 32, background: 'linear-gradient(180deg,#fbbf24,#f59e0b)', fontSize: 14 }}>
                {l}
              </div>
            ))}
          </div>

          {/* Cells */}
          {numbers.map((num, idx) => {
            const isFree = idx === 12;
            const isMarked = patternMask[idx];
            const isWinCell = winIndices.includes(idx);
            const isLast = num === lastCalledNumber && !isFree;

            let bg = '#1e3a5f';
            let color = '#94a3b8';
            let border = '1px solid rgba(255,255,255,0.06)';
            let shadow = 'none';

            if (isFree || isMarked) {
              bg = 'linear-gradient(180deg,#ca8a04,#a16207)';
              color = '#111';
              border = '1px solid rgba(202,138,4,0.6)';
              shadow = '0 0 6px rgba(202,138,4,0.4)';
            }
            if (isLast) {
              bg = 'linear-gradient(180deg,#fbbf24,#f59e0b)';
              color = '#111';
              border = '2px solid #fbbf24';
              shadow = '0 0 14px rgba(251,191,36,0.8)';
            }
            if (isWinCell) {
              border = '2px solid #3b82f6';
              shadow = '0 0 10px rgba(59,130,246,0.6)';
            }

            const col = idx % 5;
            const row = Math.floor(idx / 5);
            const left = col * (CELL + GAP);
            const top = row * (CELL + GAP);

            return (
              <div key={idx}
                className="absolute flex items-center justify-center font-bold rounded-xl transition-all"
                style={{ left, top, width: CELL, height: CELL, background: bg, color, border, boxShadow: shadow, fontSize: 13 }}>
                {isFree ? 'FREE' : num}
              </div>
            );
          })}


        </div>

        {/* Status badge */}
        <div className="mt-8 text-sm font-bold px-4 py-1.5 rounded-full"
          style={winPattern
            ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
            : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }}>
          {winPattern ? `🎉 BINGO! (${winPattern})` : 'No win yet'}
        </div>

        <button onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-300 mt-1">
          tap anywhere to close
        </button>
      </div>
    </div>
  );
};
