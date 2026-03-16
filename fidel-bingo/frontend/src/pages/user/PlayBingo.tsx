import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gameApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface Game {
  id: string;
  status: string;
  betAmount: number;
  prizePool: number;
  cartelaCount: number;
  creatorId: string;
  calledNumbers: number[];
  winPattern?: string;
}

// B=1-15, I=16-30, N=31-45, G=46-60, O=61-75
const ROWS = [
  { letter: 'B', start: 1 },
  { letter: 'I', start: 16 },
  { letter: 'N', start: 31 },
  { letter: 'G', start: 46 },
  { letter: 'O', start: 61 },
];

const SPEEDS = [1, 2, 3, 4, 5]; // seconds between auto-calls

export const PlayBingo: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [selectedGameId, setSelectedGameId] = useState<string | null>(searchParams.get('gameId'));
  const [autoOn, setAutoOn] = useState(false);
  const [speed, setSpeed] = useState(5); // seconds
  const [checkId, setCheckId] = useState('');
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ['games'],
    queryFn: () => gameApi.list().then((r) => r.data.data),
    refetchInterval: 3000,
  });

  const activeGames = games.filter((g) => g.status === 'active');
  const game = selectedGameId
    ? games.find((g) => g.id === selectedGameId) ?? null
    : activeGames[0] ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const callMutation = useMutation({
    mutationFn: () => gameApi.callNumber(game!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['games'] }),
  });

  const finishMutation = useMutation({
    mutationFn: () => gameApi.start(game!.id), // reuse start as finish trigger — adjust if needed
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['games'] }),
  });

  // ── Auto-call ─────────────────────────────────────────────────────────────
  const stopAuto = useCallback(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    setAutoOn(false);
  }, []);

  const startAuto = useCallback(() => {
    if (!game || game.status !== 'active') return;
    setAutoOn(true);
    autoRef.current = setInterval(() => {
      callMutation.mutate();
    }, speed * 1000);
  }, [game, speed, callMutation]);

  useEffect(() => {
    if (autoOn) { stopAuto(); startAuto(); }
  }, [speed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopAuto(), [stopAuto]);

  // Stop auto when game ends
  useEffect(() => {
    if (game?.status !== 'active' && autoOn) stopAuto();
  }, [game?.status, autoOn, stopAuto]);

  const toggleAuto = () => autoOn ? stopAuto() : startAuto();

  // ── Shuffle (re-order display only) ───────────────────────────────────────
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const calledNumbers = game?.calledNumbers ?? [];
  const lastNumber = calledNumbers.length > 0 ? calledNumbers[calledNumbers.length - 1] : null;
  const isCreator = game?.creatorId === user?.id;

  return (
    <div className="min-h-full flex flex-col" style={{ background: '#0e1a35' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        {/* Hamburger / game selector */}
        <div className="relative group">

          {games.length > 0 && (
            <div className="absolute left-0 top-full mt-1 bg-[#1a2a4a] border border-white/10 rounded-xl shadow-xl z-50 min-w-[220px] hidden group-focus-within:block">
              {games.map((g) => (
                <button key={g.id} onClick={() => setSelectedGameId(g.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 first:rounded-t-xl last:rounded-b-xl ${
                    game?.id === g.id ? 'text-yellow-400' : 'text-gray-300'
                  }`}>
                  Game #{g.id.slice(0, 6)} — {g.status}
                </button>
              ))}
            </div>
          )}
        </div>

        <h1 className="text-yellow-400 font-extrabold text-2xl tracking-wide">
          {game ? `GAME ${game.id.slice(0, 6).toUpperCase()}` : 'PLAY BINGO'}
        </h1>

        {/* Info chips */}
        {game && (
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <Chip label="GAME STARTED" color="yellow" />
            <Chip label={`TOTAL BET ${Number(game.betAmount * game.cartelaCount).toFixed(0)} BIRR`} color="yellow" />
            <Chip label={`WIN ${Number(game.prizePool).toFixed(1)} BIRR`} color="yellow" />
            <Chip label={`${game.cartelaCount} CARTELA`} color="yellow" />
            <Chip label={`${calledNumbers.length}/75`} color="dark" />
          </div>
        )}

        {/* Game selector buttons (right side) */}
        <div className="ml-auto flex gap-2">
          {isLoading && <span className="text-gray-400 text-sm">Loading...</span>}
          {activeGames.filter((g) => g.id !== game?.id).slice(0, 3).map((g) => (
            <button key={g.id} onClick={() => setSelectedGameId(g.id)}
              className="text-xs bg-white/10 hover:bg-white/20 text-gray-300 px-3 py-1.5 rounded-lg">
              #{g.id.slice(0, 6)}
            </button>
          ))}
          <button onClick={() => navigate('/dashboard/new-game')}
            className="text-xs bg-yellow-400 text-gray-900 font-bold px-3 py-1.5 rounded-lg hover:bg-yellow-300">
            + New
          </button>
        </div>
      </div>

      {/* ── Number Board ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-4">
        {game ? (
          <div className="w-full max-w-4xl">
            <NumberBoard calledNumbers={calledNumbers} lastNumber={lastNumber} seed={shuffleSeed} />
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🎱</div>
            <div className="text-gray-400 text-lg mb-4">No active game</div>
            <button onClick={() => navigate('/dashboard/new-game')}
              className="bg-yellow-400 text-gray-900 font-bold px-6 py-3 rounded-xl hover:bg-yellow-300">
              Start New Game
            </button>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      {game && (
        <div className="border-t border-white/10 px-4 py-4">
          {/* Button row */}
          <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
            <CtrlBtn
              label={autoOn ? 'Auto On' : 'Auto Off'}
              active={autoOn}
              onClick={toggleAuto}
              disabled={!isCreator || game.status !== 'active'}
            />
            <CtrlBtn
              label="Next"
              onClick={() => callMutation.mutate()}
              disabled={!isCreator || game.status !== 'active' || callMutation.isPending}
            />
            <CtrlBtn
              label="Finish"
              onClick={() => { stopAuto(); navigate(`/game/${game.id}`); }}
              disabled={game.status !== 'active'}
            />
            <CtrlBtn
              label="🔀 Shuffle"
              purple
              onClick={() => setShuffleSeed((s) => s + 1)}
            />
          </div>

          {/* Speed + Check row */}
          <div className="flex items-center justify-center gap-6 flex-wrap">
            {/* Speed slider */}
            <div className="flex items-center gap-3 bg-[#1a2a4a] rounded-xl px-4 py-2">
              <span className="text-xs text-gray-400 uppercase tracking-wide">Speed</span>
              <input
                type="range" min={1} max={10} step={1} value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-28 accent-yellow-400"
              />
              <div className="w-8 h-8 rounded-lg bg-yellow-400 text-gray-900 font-bold text-sm flex items-center justify-center">
                {speed}s
              </div>
            </div>

            {/* Enter ID + Check */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Enter ID"
                value={checkId}
                onChange={(e) => setCheckId(e.target.value)}
                className="bg-[#1a2a4a] border border-white/20 text-white placeholder-gray-500 rounded-xl px-4 py-2 text-sm w-36 focus:outline-none focus:border-yellow-400"
              />
              <button
                onClick={() => { if (checkId) navigate(`/game/${checkId}`); }}
                className="bg-yellow-400 text-gray-900 font-bold px-5 py-2 rounded-xl text-sm hover:bg-yellow-300">
                Check
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Chip: React.FC<{ label: string; color: 'yellow' | 'dark' }> = ({ label, color }) => (
  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
    color === 'yellow' ? 'bg-yellow-400 text-gray-900' : 'bg-[#1a2a4a] text-gray-300 border border-white/10'
  }`}>
    {label}
  </span>
);

const CtrlBtn: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  purple?: boolean;
}> = ({ label, onClick, disabled, active, purple }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 ${
      purple
        ? 'bg-purple-600 text-white hover:bg-purple-500'
        : active
        ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-300'
        : 'bg-yellow-400 text-gray-900 hover:bg-yellow-300'
    }`}
  >
    {label}
  </button>
);

// ── Number Board ──────────────────────────────────────────────────────────────

const ROWS_DEF = [
  { letter: 'B', start: 1 },
  { letter: 'I', start: 16 },
  { letter: 'N', start: 31 },
  { letter: 'G', start: 46 },
  { letter: 'O', start: 61 },
];

const NumberBoard: React.FC<{ calledNumbers: number[]; lastNumber: number | null; seed: number }> = ({
  calledNumbers, lastNumber,
}) => {
  return (
    <div className="w-full" role="region" aria-label="Bingo number board">
      {ROWS_DEF.map(({ letter, start }) => (
        <div key={letter} className="flex items-center gap-1 mb-1 last:mb-0">
          {/* Letter chip */}
          <div
            className="flex items-center justify-center font-extrabold text-gray-900 rounded-lg shrink-0 text-xl"
            style={{
              width: 48, height: 48,
              background: 'linear-gradient(180deg,#fbbf24,#f59e0b)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}
          >
            {letter}
          </div>

          {/* 15 cells */}
          <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: 'repeat(15,1fr)' }}>
            {Array.from({ length: 15 }, (_, i) => {
              const num = start + i;
              const called = calledNumbers.includes(num);
              const isLast = num === lastNumber;

              return (
                <div
                  key={num}
                  aria-label={`${num}${called ? ' called' : ''}`}
                  className="flex items-center justify-center font-bold rounded-md transition-all duration-300 aspect-square text-sm"
                  style={{
                    background: isLast
                      ? 'linear-gradient(180deg,#fbbf24,#f59e0b)'
                      : called
                      ? 'linear-gradient(180deg,#5a0a0a,#3a0505)'
                      : 'linear-gradient(180deg,#8b1a1a,#6b0f0f)',
                    color: isLast ? '#111' : called ? '#f87171' : '#fff',
                    boxShadow: isLast ? '0 0 14px rgba(251,191,36,0.8)' : '0 1px 3px rgba(0,0,0,0.5)',
                    border: isLast ? '2px solid #fbbf24' : '1px solid rgba(0,0,0,0.4)',
                    transform: isLast ? 'scale(1.12)' : 'scale(1)',
                  }}
                >
                  {num}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
