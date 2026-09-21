import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { offlineGameApi } from '../../services/offlineApi';
import { useAuthStore } from '../../store/authStore';
import { useGameSettings } from '../../store/gameSettingsStore';
import { dbGet, playCachedSound, playNumberSoundQueued, unlockAudioContext, audioQueue } from '../../services/db';

let _userInteracted = false;
if (typeof window !== 'undefined') {
  const mark = () => {
    _userInteracted = true;
    unlockAudioContext(); // keep AudioContext alive for setInterval-triggered sounds
  };
  window.addEventListener('click', mark, { once: true });
  window.addEventListener('keydown', mark, { once: true });
  window.addEventListener('pointerdown', mark, { once: true });
}

// Always reads latest voice/mode from store — never stale
function playSound(name: string) {
  if (!_userInteracted) {
    console.log('[playSound] blocked — no user interaction yet');
    return;
  }
  const { voice, volume, soundCallMode } = useGameSettings.getState();
  console.log('[playSound] name:', name, 'voice:', voice, 'mode:', soundCallMode);
  // If name is a plain number string, route through the queue so double-sound works
  const num = parseInt(name, 10);
  if (!isNaN(num) && String(num) === name) {
    playNumberSoundQueued(num, voice, volume, soundCallMode);
    return;
  }
  const ext = voice === 'boy sound' ? '.wav' : '.mp3';
  const file = name.includes('.') ? name : `${name}${ext}`;
  const bypassCache = useAuthStore.getState().user?.paymentType === 'postpaid';
  playCachedSound(`/sounds/${encodeURIComponent(voice)}/${file}`, volume, bypassCache).catch(() => {});
}

// Play a root-level sound (not category-specific), works offline via cache
function playRootSound(filename: string): Promise<void> {
  if (!_userInteracted) return Promise.resolve();
  const bypassCache = useAuthStore.getState().user?.paymentType === 'postpaid';
  return playCachedSound(`/sounds/${filename}`, 1, bypassCache).then(() => {});
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
  // Keep ref in sync — also re-read from store directly on each sound call for safety
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const queryClient = useQueryClient();

  const [selectedGameId, setSelectedGameId] = useState<string | null>(searchParams.get('gameId'));

  // When sync converts an offline-xxx game to a real server game,
  // update the URL and selectedGameId so checks work with the real ID
  useEffect(() => {
    const handler = (e: Event) => {
      const { tempId, realId } = (e as CustomEvent<{ tempId: string; realId: string }>).detail;
      if (selectedGameId === tempId) {
        setSelectedGameId(realId);
        // Update the URL without reloading so the address bar shows the real game ID
        const url = new URL(window.location.href);
        url.searchParams.set('gameId', realId);
        window.history.replaceState({}, '', url.toString());
        // Refresh the game query so the real game loads
        queryClient.invalidateQueries({ queryKey: ['games'] });
      }
    };
    window.addEventListener('game-synced', handler);
    return () => window.removeEventListener('game-synced', handler);
  }, [selectedGameId, queryClient]);
  const [autoOn, setAutoOn] = useState(false);
  const [speed, setSpeed] = useState(() => {
    const saved = localStorage.getItem('bingo_speed');
    return saved ? Number(saved) : 5;
  });
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
    localStorage.setItem('bingo_speed', String(speed));
  }, [speed]);
  const [checkId, setCheckId] = useState('');
  const [checkResult, setCheckResult] = useState<{
    registered: boolean; isWinner: boolean; winPattern: string | null;
    numbers?: number[]; patternMask?: boolean[];
  } | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetGameRef = useRef<string | null>(null);
  const [sessionCalledNumbers, setSessionCalledNumbers] = useState<number[]>([]);
  const [winnerInfo, setWinnerInfo] = useState<{ cardNumber: number; amount: number; pattern: string } | null>(null);
  const isOfflineGame = selectedGameId?.startsWith('offline-') ?? false;

  const { data: allGames = [], isLoading } = useQuery<Game[]>({
    queryKey: ['games'],
    queryFn: async () => {
      if (isOfflineGame && selectedGameId) {
        const localGame = await dbGet<Game>('games', selectedGameId);
        return localGame ? [localGame] : [];
      }
      return offlineGameApi.list('active');
    },
    enabled: !isOfflineGame || Boolean(selectedGameId),
    refetchInterval: isOfflineGame ? false : 10000,
  });

  // Only show games belonging to the current user that are active
  const games = allGames.filter((g) => g.creatorId === user?.id && g.status === 'active');
  const activeGames = games;
  const game = selectedGameId
    ? games.find((g) => g.id === selectedGameId) ?? null
    : activeGames[0] ?? null;

  useEffect(() => {
    if (isLoading) return;
    // Redirect to new-game if no active game
    if (activeGames.length === 0 && !selectedGameId) {
      navigate('/new-game', { replace: true });
    }
  }, [isLoading, activeGames.length, selectedGameId, navigate]);

  useEffect(() => {
    if (!game || game.status !== 'active') return;
    if (resetGameRef.current === game.id) return;
    resetGameRef.current = game.id;
    offlineGameApi.reset(game.id).then(() => setSessionCalledNumbers([])).catch(() => {});
    // Pre-cache cartelas for this game so offline check works
    offlineGameApi.getCartelas(game.id).catch(() => {});
  }, [game?.id]);

  const stopAuto = useCallback((silent = false) => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    setAutoOn(false);
    if (!silent) playRootSound('aac_ended.mp3');
  }, []);

  const callMutation = useMutation({
    mutationFn: async () => {
      console.log('[callMutation] Starting call...');
      if (!gameRef.current) {
        console.error('[callMutation] Game is null, cannot call number');
        throw new Error('Game is null');
      }
      mutationStartTimeRef.current = Date.now();
      const result = await offlineGameApi.callNumber(gameRef.current.id);
      console.log('[callMutation] Call completed:', result);
      mutationStartTimeRef.current = 0;
      return result;
    },
    onSuccess: (response: any) => {
      console.log('[callMutation] onSuccess triggered');
      mutationStartTimeRef.current = 0;
      const num: number | null = response?.data?.data?.number ?? response?.data?.number ?? null;
      if (num != null) setSessionCalledNumbers((prev) => prev.includes(num) ? prev : [...prev, num]);
      if (!isOfflineGame) {
        queryClient.invalidateQueries({ queryKey: ['games'] });
      }
    },
    onError: (err: any) => {
      console.log('[callMutation] onError triggered:', err);
      mutationStartTimeRef.current = 0;
      const status = err?.response?.status;
      const code = err?.response?.data?.error?.code;
      if (status === 429) return; // rate limited — skip this tick, keep going
      if (code === 'NO_NUMBERS_LEFT' || code === 'INVALID_STATE') {
        stopAuto(true); // game over or finished — stop silently
        return;
      }
      console.error('[callNumber]', err?.response?.data ?? err.message);
      stopAuto(true);
    },
    onSettled: () => {
      console.log('[callMutation] onSettled - mutation completed');
      mutationStartTimeRef.current = 0;
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => {
      if (!gameRef.current) throw new Error('Game is null');
      return offlineGameApi.finish(gameRef.current.id);
    },
    onSuccess: () => {
      stopAuto(true);
      queryClient.invalidateQueries({ queryKey: ['games'] });
      if (!isOfflineGame) refreshBalance();
      navigate('/new-game');
    },
  });

  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);
  const sessionCalledRef = useRef(sessionCalledNumbers);
  useEffect(() => { sessionCalledRef.current = sessionCalledNumbers; }, [sessionCalledNumbers]);
  
  // Track mutation pending state via ref so interval closure never captures stale value
  const mutationStartTimeRef = useRef<number>(0);
  const isMutationPendingRef = useRef(false);
  useEffect(() => { isMutationPendingRef.current = callMutation.isPending; }, [callMutation.isPending]);

  const checkMutationTimeout = useCallback(() => {
    if (isMutationPendingRef.current && mutationStartTimeRef.current > 0) {
      const elapsed = Date.now() - mutationStartTimeRef.current;
      if (elapsed > 10000) { // 10 second timeout
        console.error('[callMutation] Timeout detected! Resetting mutation state.');
        stopAuto(true);
        alert('Number calling stuck. Please try again.');
      }
    }
  }, [stopAuto]);

  // Stable mutate ref so startAuto doesn't need callMutation in its deps
  const mutateRef = useRef(callMutation.mutate);
  useEffect(() => { mutateRef.current = callMutation.mutate; }, [callMutation.mutate]);

  const startAuto = useCallback(() => {
    if (!game || game.status !== 'active') return;
    playRootSound('aac_resumed.mp3');
    setAutoOn(true);
    let elapsed = 0;
    autoRef.current = setInterval(() => {
      // Guard against game becoming null during auto-call
      if (!gameRef.current || gameRef.current.status !== 'active') {
        stopAuto(true);
        return;
      }
      elapsed += 0.5;
      if (elapsed < speedRef.current) return;
      // Also wait for audio queue to finish — don't call next number while sound is playing
      if (audioQueue.playing) return;
      elapsed = 0;
      if (sessionCalledRef.current.length >= 75) { stopAuto(); return; }
      if (isMutationPendingRef.current) {
        checkMutationTimeout(); // Check if mutation is stuck
        return; // don't fire if previous call still in flight
      }
      mutationStartTimeRef.current = Date.now();
      mutateRef.current();
    }, 500);
  }, [game, stopAuto, checkMutationTimeout]);

  useEffect(() => () => stopAuto(true), [stopAuto]);
  useEffect(() => { if (sessionCalledNumbers.length >= 75 && autoOn) stopAuto(true); }, [sessionCalledNumbers.length, autoOn, stopAuto]);

  const toggleAuto = () => autoOn ? stopAuto() : startAuto();

  const handleCheck = async () => {
    const num = parseInt(checkId.trim(), 10);
    const currentGame = gameRef.current;
    if (!currentGame || isNaN(num)) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const result = await offlineGameApi.checkCartela(currentGame.id, num, sessionCalledNumbers);
      setCheckResult(result);
      if (result.registered) {
        if (result.isWinner) {
          playRootSound('winner.wav');
          setWinnerInfo({
            cardNumber: num,
            amount: Number(currentGame?.prizePool ?? 0),
            pattern: result.winPattern ?? '',
          });
        } else {
          playRootSound('aac_locked.mp3');
        }
      } else {
        playCachedSound('/sounds/notregisterd.mp3').catch(() => {
          playCachedSound('/sounds/notregisterd.m4a').catch(() => {});
        });
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

  // Keyboard shortcuts for game controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in an input
      if (e.target instanceof HTMLInputElement) return;
      
      if (!game || !isCreator || game.status !== 'active') return;
      
      if (e.key === ' ' || e.key === 'Spacebar') { // Space to toggle auto
        e.preventDefault();
        toggleAuto();
      }
      if (e.key === 'ArrowRight' || e.key === 'n') { // Right arrow or 'n' for next
        e.preventDefault();
        if (!callMutation.isPending && calledNumbers.length < 75) {
          callMutation.mutate();
        }
      }
      if (e.key === 'Escape') { // Escape to stop auto
        e.preventDefault();
        stopAuto();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [game, isCreator, toggleAuto, stopAuto, callMutation, calledNumbers.length]);

  const prevCalledRef = useRef<number[]>([]);
  useEffect(() => {
    const newNums = sessionCalledNumbers.filter((n) => !prevCalledRef.current.includes(n));
    if (newNums.length > 0) playSound(`${newNums[newNums.length - 1]}`);
    prevCalledRef.current = sessionCalledNumbers;
  }, [sessionCalledNumbers]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0a1220' }}>

      {/* ── Winner banner ── */}
      {winnerInfo && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5"
          style={{ background: 'rgba(34,197,94,0.15)', borderBottom: '1px solid rgba(34,197,94,0.3)' }}>
          <span className="text-green-400 font-bold text-sm min-w-0 break-words">
            🎉 Card #{winnerInfo.cardNumber} — BINGO! ({winnerInfo.pattern}) · {Number(winnerInfo.amount).toFixed(2)} BIRR
          </span>
          <button onClick={() => setWinnerInfo(null)}
            className="text-green-400 hover:text-white text-lg leading-none px-1"
            aria-label="Close winner banner">×</button>
        </div>
      )}

      {/* ── Number board — compact on mobile, fills rest on desktop ── */}
      <style>{`
        @media (max-width: 767px) {
          .number-board-wrap { flex: 0 0 auto !important; height: 42vh !important; }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .number-board-wrap { flex: 0 0 auto !important; height: 48vh !important; }
        }
        @media (min-width: 1024px) {
          .number-board-wrap { flex: 1 1 0% !important; min-height: 0 !important; }
        }
      `}</style>
      <div className="number-board-wrap min-h-0 px-3 sm:px-3 pt-1.5 sm:pt-2 pb-1">
        {game
          ? <NumberBoard calledNumbers={calledNumbers} lastNumber={lastNumber} />
          : <div className="flex items-center justify-center h-full text-gray-900 text-sm">Loading…</div>
        }
      </div>

      {/* ── Bottom control bar ── */}
      {game && (
        <div className="shrink-0 lg:shrink-0 mt-auto lg:mt-0"
          style={{ background: 'rgba(0,0,0,0.7)', borderTop: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>

          {/* ── Mobile layout (< md) — fixed bottom bar ── */}
          <div className="md:hidden flex flex-col" style={{ minHeight: 180, paddingBottom: 'env(safe-area-inset-bottom)' }}>

            {/* ── Row 1: prize ball | buttons | last-number ball ── */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">

              {/* Prize ball */}
              <div className="flex flex-col items-center justify-center shrink-0 relative"
                style={{
                  width: 68, height: 68, borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 30%, #3b82f6, #1e3a8a)',
                  boxShadow: '0 0 18px rgba(59,130,246,0.7), inset 0 2px 0 rgba(255,255,255,0.3)',
                  border: '2px solid rgba(147,197,253,0.9)',
                }}>
                <span className="text-blue-100 font-bold leading-none" style={{ fontSize: 8 }}>ደራሽ</span>
                <span className="font-black tabular-nums text-white leading-none" style={{ fontSize: 20 }}>
                  {Number(game.prizePool).toFixed(0)}
                </span>
                <span className="text-yellow-300 font-extrabold leading-none" style={{ fontSize: 9 }}>ብር</span>
                <div className="absolute -top-1 -right-1 flex items-center justify-center rounded-full font-black"
                  style={{ width: 18, height: 18, background: '#fbbf24', color: '#111', fontSize: 9, border: '2px solid #111' }}>
                  {game.cartelaCount}
                </div>
                <div className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `conic-gradient(from 0deg, rgba(34,197,94,0.8) 0deg, rgba(34,197,94,0.8) ${(calledNumbers.length / 75) * 360}deg, transparent ${(calledNumbers.length / 75) * 360}deg)`,
                    borderRadius: '50%',
                    mask: 'radial-gradient(circle, transparent 85%, white 87%, white 100%)',
                  }} />
              </div>

              {/* Centre: buttons + progress */}
              <div className="flex-1 flex flex-col items-center gap-2">
                {/* Buttons row */}
                <div className="flex items-center gap-2 w-full justify-center">
                  <CtrlBtn
                    size="lg"
                    label={autoOn ? '⏸ Pause' : '▶ Auto'}
                    active={autoOn}
                    onClick={toggleAuto}
                    disabled={!isCreator || game.status !== 'active' || calledNumbers.length >= 75}
                  />
                  <CtrlBtn
                    size="lg"
                    label="➤ Next"
                    onClick={() => callMutation.mutate()}
                    disabled={!isCreator || game.status !== 'active' || callMutation.isPending || calledNumbers.length >= 75}
                  />
                  <CtrlBtn
                    size="lg"
                    label={finishMutation.isPending ? '⌛' : '⏹ End'}
                    onClick={() => { stopAuto(true); finishMutation.mutate(); }}
                    disabled={!isCreator || game.status !== 'active' || finishMutation.isPending}
                    danger
                  />
                  <CtrlBtn
                    size="lg"
                    label="🔄"
                    purple
                    onClick={() => {
                      playCachedSound('/sounds/shuffle-audio-TfqyAnvz.mp3').catch(() => {});
                      setTimeout(() => window.location.reload(), 5000);
                    }}
                    title="Refresh"
                  />
                </div>
                {/* Progress bar */}
                <div className="w-full flex items-center gap-2">
                  <div className="flex-1 rounded-full overflow-hidden" style={{ height: 5, background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(calledNumbers.length / 75) * 100}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)' }} />
                  </div>
                  <span className="text-blue-400 font-bold tabular-nums shrink-0" style={{ fontSize: 10 }}>
                    {calledNumbers.length}<span className="text-gray-600">/75</span>
                  </span>
                </div>
              </div>

              {/* Last number ball */}
              <div className="shrink-0 flex items-center justify-center" style={{ width: 68, height: 68 }}>
                <div key={lastNumber} className="flex flex-col items-center justify-center relative overflow-hidden ball-container"
                  style={{
                    width: '100%', height: '100%', borderRadius: '50%',
                    background: lastNumber != null
                      ? `radial-gradient(circle at 35% 30%, ${getBingoColor(lastNumber)}ee, ${getBingoColor(lastNumber)}66)`
                      : 'radial-gradient(circle at 35% 30%, #4c3fa0, #1e1040)',
                    border: lastNumber != null ? `2px solid ${getBingoColor(lastNumber)}` : '2px solid rgba(147,51,234,0.6)',
                    boxShadow: lastNumber != null
                      ? `0 0 22px ${getBingoColor(lastNumber)}99, inset 0 2px 0 rgba(255,255,255,0.25)`
                      : '0 0 14px rgba(124,58,237,0.4)',
                    animation: lastNumber != null ? 'ballPop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' : undefined,
                  }}>
                  {lastNumber != null ? (
                    <>
                      <div style={{
                        position: 'absolute', top: 0, left: 0, width: '40%', height: '100%',
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                        animation: 'ballShine 0.7s 0.3s ease-out forwards',
                        transform: 'translateX(-100%) rotate(25deg)', pointerEvents: 'none',
                      }} />
                      <span className="font-extrabold leading-none relative z-10"
                        style={{ fontSize: 8, color: '#fff', letterSpacing: '0.15em', opacity: 0.9 }}>
                        {getBingoLetter(lastNumber)}
                      </span>
                      <span className="font-black tabular-nums leading-none relative z-10"
                        style={{ fontSize: 22, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                        {String(lastNumber).padStart(2, '0')}
                      </span>
                      <div className="absolute inset-0 rounded-full pointer-events-none"
                        style={{
                          background: `conic-gradient(from 0deg, ${getBingoColor(lastNumber)}40, transparent, ${getBingoColor(lastNumber)}40)`,
                          animation: 'spin 2s linear infinite',
                        }} />
                    </>
                  ) : (
                    <span className="font-black text-white/20" style={{ fontSize: 22 }}>?</span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Row 2: speed slider | card check ── */}
            <div className="flex items-center gap-3 px-3 pb-3 pt-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Speed */}
              <div className="flex items-center gap-1.5 flex-1">
                <span className="text-gray-500 shrink-0" style={{ fontSize: 9 }}>SPD</span>
                <input type="range" min={1} max={10} step={1} value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="flex-1 accent-yellow-400" style={{ height: 16 }} />
                <span className="text-yellow-400 font-bold shrink-0 w-5 text-center" style={{ fontSize: 10 }}>{speed}s</span>
              </div>
              {/* Divider */}
              <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.08)' }} />
              {/* Card check */}
              <div className="flex flex-col gap-1 shrink-0">
                <div className="flex items-center gap-1">
                  <input
                    type="number" inputMode="numeric" placeholder="Card #" value={checkId}
                    onChange={(e) => { setCheckId(e.target.value); setCheckResult(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                    className="rounded-lg px-2 py-1.5 text-xs w-20 focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
                  />
                  <button
                    onClick={handleCheck}
                    disabled={checkLoading || !checkId}
                    className="font-bold px-3 py-1.5 rounded-lg text-xs disabled:opacity-40 active:scale-95"
                    style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                    {checkLoading ? '…' : 'Check'}
                  </button>
                </div>
                {checkResult && (
                  <div className="text-[10px] font-semibold px-2 py-0.5 rounded"
                    style={
                      !checkResult.registered
                        ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }
                        : checkResult.isWinner
                        ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                        : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }
                    }>
                    {!checkResult.registered
                      ? `#${checkId} not found`
                      : checkResult.isWinner
                      ? `🎉 BINGO! (${checkResult.winPattern})`
                      : `#${checkId} — no win`}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Tablet layout (md–lg: 768px–1023px) ── */}
          <div className="hidden md:flex lg:hidden items-center gap-2 px-3 py-2"
            style={{ minHeight: 120, paddingBottom: 'env(safe-area-inset-bottom)' }}>

            {/* Prize ball */}
            <div className="flex flex-col items-center justify-center shrink-0 relative"
              style={{
                width: 100, height: 100, borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%, #3b82f6, #1e3a8a)',
                boxShadow: '0 0 24px rgba(59,130,246,0.8), inset 0 2px 0 rgba(255,255,255,0.3)',
                border: '2px solid rgba(147,197,253,0.9)',
              }}>
              <span className="text-blue-100 font-bold leading-none" style={{ fontSize: 11 }}>ደራሽ</span>
              <span className="font-black tabular-nums text-white leading-none" style={{ fontSize: 28 }}>
                {Number(game.prizePool).toFixed(0)}
              </span>
              <span className="text-yellow-300 font-extrabold leading-none" style={{ fontSize: 12 }}>ብር</span>
              <div className="absolute -top-1 -right-1 flex items-center justify-center rounded-full font-black"
                style={{ width: 24, height: 24, background: '#fbbf24', color: '#111', fontSize: 12, border: '2px solid #111', boxShadow: '0 2px 6px rgba(251,191,36,0.4)' }}>
                {game.cartelaCount}
              </div>
              <div className="absolute inset-0 pointer-events-none"
                style={{
                  background: `conic-gradient(from 0deg, rgba(34,197,94,0.8) 0deg, rgba(34,197,94,0.8) ${(calledNumbers.length / 75) * 360}deg, transparent ${(calledNumbers.length / 75) * 360}deg)`,
                  borderRadius: '50%',
                  mask: 'radial-gradient(circle, transparent 85%, white 87%, white 100%)',
                }} />
            </div>

            <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Centre: controls + speed + check */}
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {/* Buttons + speed row */}
              <div className="flex items-center gap-2">
                <CtrlBtn size="md" label={autoOn ? '⏸ Pause' : '▶ Auto'} active={autoOn} onClick={toggleAuto}
                  disabled={!isCreator || game.status !== 'active' || calledNumbers.length >= 75} />
                <CtrlBtn size="md" label="➤ Next" onClick={() => callMutation.mutate()}
                  disabled={!isCreator || game.status !== 'active' || callMutation.isPending || calledNumbers.length >= 75} />
                <CtrlBtn size="md" label={finishMutation.isPending ? '⌛' : '⏹ End'}
                  onClick={() => { stopAuto(true); finishMutation.mutate(); }}
                  disabled={!isCreator || game.status !== 'active' || finishMutation.isPending} danger />
                <CtrlBtn size="md" label="🔄" purple onClick={() => {
                  playCachedSound('/sounds/shuffle-audio-TfqyAnvz.mp3').catch(() => {});
                  setTimeout(() => window.location.reload(), 5000);
                }} title="Refresh" />
                <div className="flex-1" />
                {/* Speed inline */}
                <span className="text-gray-500 text-[10px] uppercase shrink-0">Speed</span>
                <input type="range" min={1} max={10} step={1} value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-24 accent-yellow-400 shrink-0" />
                <span className="text-yellow-400 font-bold text-[11px] w-5 shrink-0">{speed}s</span>
              </div>
              {/* Progress + check row */}
              <div className="flex items-center gap-3">
                {/* Progress */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="rounded-full overflow-hidden" style={{ width: 80, height: 5, background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(calledNumbers.length / 75) * 100}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)' }} />
                  </div>
                  <span className="text-blue-400 font-bold tabular-nums text-[11px]">
                    {calledNumbers.length}<span className="text-gray-600">/75</span>
                  </span>
                  <span className="text-green-400 font-bold text-[11px]">
                    {Math.round((calledNumbers.length / 75) * 100)}%
                  </span>
                </div>
                <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.08)' }} />
                {/* Card check */}
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <input type="number" inputMode="numeric" placeholder="Card #" value={checkId}
                      onChange={(e) => { setCheckId(e.target.value); setCheckResult(null); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                      className="rounded-lg px-2 py-1 text-xs w-20 focus:outline-none"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }} />
                    <button onClick={handleCheck} disabled={checkLoading || !checkId}
                      className="font-bold px-3 py-1 rounded-lg text-xs disabled:opacity-40"
                      style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                      {checkLoading ? '…' : 'Check'}
                    </button>
                  </div>
                  {checkResult && (
                    <div className="text-[10px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
                      style={!checkResult.registered
                        ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }
                        : checkResult.isWinner
                        ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                        : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {!checkResult.registered ? `#${checkId} not registered`
                        : checkResult.isWinner ? `🎉 BINGO! (${checkResult.winPattern})`
                        : `#${checkId} — no win yet`}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Last number ball */}
            <div className="shrink-0 flex items-center justify-center" style={{ width: 90, height: 90 }}>
              <div key={lastNumber} className="flex flex-col items-center justify-center relative overflow-hidden ball-container"
                style={{
                  width: '100%', height: '100%', borderRadius: '50%',
                  background: lastNumber != null
                    ? `radial-gradient(circle at 35% 30%, ${getBingoColor(lastNumber)}ee, ${getBingoColor(lastNumber)}66)`
                    : 'radial-gradient(circle at 35% 30%, #4c3fa0, #1e1040)',
                  border: lastNumber != null ? `2px solid ${getBingoColor(lastNumber)}` : '2px solid rgba(147,51,234,0.6)',
                  boxShadow: lastNumber != null
                    ? `0 0 28px ${getBingoColor(lastNumber)}99, inset 0 2px 0 rgba(255,255,255,0.25)`
                    : '0 0 18px rgba(124,58,237,0.4)',
                  animation: lastNumber != null ? 'ballPop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' : undefined,
                }}>
                {lastNumber != null ? (
                  <>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '40%', height: '100%',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'ballShine 0.7s 0.3s ease-out forwards',
                      transform: 'translateX(-100%) rotate(25deg)', pointerEvents: 'none',
                    }} />
                    <span className="font-extrabold leading-none relative z-10"
                      style={{ fontSize: 10, color: '#fff', letterSpacing: '0.15em', opacity: 0.9 }}>
                      {getBingoLetter(lastNumber)}
                    </span>
                    <span className="font-black tabular-nums leading-none relative z-10"
                      style={{ fontSize: 30, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>
                      {String(lastNumber).padStart(2, '0')}
                    </span>
                    <div className="absolute inset-0 rounded-full pointer-events-none"
                      style={{
                        background: `conic-gradient(from 0deg, ${getBingoColor(lastNumber)}40, transparent, ${getBingoColor(lastNumber)}40)`,
                        animation: 'spin 2s linear infinite',
                      }} />
                  </>
                ) : (
                  <span className="font-black text-white/20" style={{ fontSize: 28 }}>?</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Desktop layout (≥ lg: 1024px+) ── */}
          <div className="hidden lg:flex items-center gap-3 px-3 py-2" style={{ minHeight: 130 }}>

            {/* Derash ball */}
            <div className="flex flex-col items-center justify-center shrink-0 relative"
              style={{
                width: 'clamp(110px,14vw,150px)',
                height: 'clamp(110px,14vw,150px)',
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%, #3b82f6, #1e3a8a)',
                boxShadow: '0 0 36px rgba(59,130,246,0.8), inset 0 2px 0 rgba(255,255,255,0.3)',
                border: '3px solid rgba(147,197,253,0.9)',
                animation: game.prizePool > 1000 ? 'ballPulse 2s ease-in-out infinite' : undefined,
              }}>
              <span className="text-blue-100 font-bold leading-none" style={{ fontSize: 'clamp(11px,1.4vw,16px)' }}>ደራሽ</span>
              <span className="font-black tabular-nums text-white leading-none" style={{ fontSize: 'clamp(35px,4.95vw,64px)' }}>
                {Number(game.prizePool).toFixed(0)}
              </span>
              <span className="text-yellow-300 font-extrabold leading-none" style={{ fontSize: 'clamp(14px,1.8vw,22px)' }}>ብር</span>
              <div className="absolute -top-1 -right-1 flex items-center justify-center rounded-full font-black"
                style={{
                  width: 'clamp(26px,3.2vw,36px)', height: 'clamp(26px,3.2vw,36px)',
                  background: '#fbbf24', color: '#111', fontSize: 'clamp(12px,1.5vw,17px)',
                  border: '2px solid #111',
                  boxShadow: '0 2px 8px rgba(251,191,36,0.4)',
                }}>
                {game.cartelaCount}
              </div>
              <div className="absolute inset-0 pointer-events-none"
                style={{
                  background: `conic-gradient(from 0deg, rgba(34,197,94,0.8) 0deg, rgba(34,197,94,0.8) ${(calledNumbers.length / 75) * 360}deg, transparent ${(calledNumbers.length / 75) * 360}deg)`,
                  borderRadius: '50%',
                  mask: 'radial-gradient(circle, transparent 85%, white 87%, white 100%)',
                }} />
            </div>

            <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Buttons */}
            <div className="flex items-center gap-1 shrink-0">
              <CtrlBtn
                label={autoOn ? '⏸ Pause' : '▶ Auto'}
                active={autoOn}
                onClick={toggleAuto}
                disabled={!isCreator || game.status !== 'active' || calledNumbers.length >= 75}
              />
              <CtrlBtn
                label="➤ Next"
                onClick={() => callMutation.mutate()}
                disabled={!isCreator || game.status !== 'active' || callMutation.isPending || calledNumbers.length >= 75}
              />
              <CtrlBtn
                label={finishMutation.isPending ? '⌛' : '⏹ End'}
                onClick={() => { stopAuto(true); finishMutation.mutate(); }}
                disabled={!isCreator || game.status !== 'active' || finishMutation.isPending}
                danger
              />
              <CtrlBtn
                label="🔄"
                purple
                onClick={() => {
                  playCachedSound('/sounds/shuffle-audio-TfqyAnvz.mp3').catch(() => {});
                  setTimeout(() => window.location.reload(), 5000);
                }}
                title="Refresh game"
              />
            </div>

            <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Speed + called count */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">Speed</span>
                <input type="range" min={1} max={10} step={1} value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-20 accent-yellow-400" />
                <span className="text-yellow-400 font-bold text-[11px] w-5">{speed}s</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-blue-400 font-bold tabular-nums">
                  {calledNumbers.length}<span className="text-gray-600">/75</span>
                </span>
                <span className="text-gray-600">•</span>
                <span className="text-green-400 font-bold">
                  {Math.round((calledNumbers.length / 75) * 100)}%
                </span>
              </div>
            </div>

            <div className="shrink-0 w-px self-stretch" style={{ background: 'rgba(255,255,255,0.1)' }} />

            {/* Card check */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <div className="flex items-center gap-1">
                <input
                  type="text" placeholder="Card #" value={checkId}
                  onChange={(e) => { setCheckId(e.target.value); setCheckResult(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                  className="rounded-lg px-2 py-1 text-xs w-16 focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
                />
                <button
                  onClick={handleCheck}
                  disabled={checkLoading || !checkId}
                  className="font-bold px-3 py-1 rounded-lg text-xs disabled:opacity-40"
                  style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                  {checkLoading ? '…' : 'Check'}
                </button>
              </div>
              {checkResult && (
                <div className="text-[10px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
                  style={
                    !checkResult.registered
                      ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }
                      : checkResult.isWinner
                      ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                      : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }
                  }>
                  {!checkResult.registered
                    ? `#${checkId} not registered`
                    : checkResult.isWinner
                    ? `🎉 BINGO! (${checkResult.winPattern})`
                    : `#${checkId} — no win yet`}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-[8px]" />

            {/* Last number ball */}
            <div className="shrink-0 flex items-center justify-center"
              style={{ width: 'clamp(110px,14vw,150px)', height: 'clamp(110px,14vw,150px)' }}>
              <div key={lastNumber} className="flex flex-col items-center justify-center relative overflow-hidden ball-container"
                style={{
                  width: '100%', height: '100%',
                  borderRadius: '50%',
                  background: lastNumber != null
                    ? `radial-gradient(circle at 35% 30%, ${getBingoColor(lastNumber)}ee, ${getBingoColor(lastNumber)}66)`
                    : 'radial-gradient(circle at 35% 30%, #4c3fa0, #1e1040)',
                  border: lastNumber != null
                    ? `3px solid ${getBingoColor(lastNumber)}`
                    : '3px solid rgba(147,51,234,0.6)',
                  boxShadow: lastNumber != null
                    ? `0 0 40px ${getBingoColor(lastNumber)}99, inset 0 2px 0 rgba(255,255,255,0.25)`
                    : '0 0 24px rgba(124,58,237,0.4)',
                  animation: lastNumber != null
                    ? 'ballPop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards'
                    : undefined,
                }}>
                {lastNumber != null ? (
                  <>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '40%', height: '100%',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'ballShine 0.7s 0.3s ease-out forwards',
                      transform: 'translateX(-100%) rotate(25deg)',
                      pointerEvents: 'none',
                    }} />
                    <span className="font-extrabold leading-none relative z-10"
                      style={{ fontSize: 'clamp(11px,1.4vw,16px)', color: '#fff', letterSpacing: '0.15em', opacity: 0.9 }}>
                      {getBingoLetter(lastNumber)}
                    </span>
                    <span className="font-black tabular-nums leading-none relative z-10"
                      style={{ fontSize: 'clamp(32px,4.8vw,58px)', color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.6)' }}>
                      {String(lastNumber).padStart(2, '0')}
                    </span>
                    <div className="absolute inset-0 rounded-full pointer-events-none"
                      style={{
                        background: `conic-gradient(from 0deg, ${getBingoColor(lastNumber)}40, transparent, ${getBingoColor(lastNumber)}40)`,
                        animation: 'spin 2s linear infinite',
                      }} />
                  </>
                ) : (
                  <span className="font-black text-white/20" style={{ fontSize: 'clamp(28px,4vw,48px)' }}>?</span>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Cartela preview modal — rendered at root level so it escapes all overflow ── */}
      {checkResult?.registered && checkResult.numbers && (
        <CartelaPreviewModal
          cardNumber={Number(checkId)}
          numbers={checkResult.numbers}
          patternMask={checkResult.patternMask ?? []}
          winPattern={checkResult.isWinner ? (checkResult.winPattern ?? null) : null}
          lastCalledNumber={lastNumber}
          onClose={() => setCheckResult(null)}
        />
      )}

      {/* ── Keyboard shortcuts help (only for creators, desktop only) ── */}
      {game && isCreator && (
        <div className="hidden md:block shrink-0 px-3 py-1 text-center text-xs text-gray-700"
          style={{ background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
          <span className="inline-flex items-center gap-3 flex-wrap justify-center">
            <span className="font-medium text-gray-600">⌨️</span>
            <span><kbd className="px-1 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300">Space</kbd> Play/Pause</span>
            <span><kbd className="px-1 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300">→</kbd> Next</span>
            <span><kbd className="px-1 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300">N</kbd> Next</span>
            <span><kbd className="px-1 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300">Esc</kbd> Stop</span>
          </span>
        </div>
      )}

    </div>
  );
};

// ── Bingo ball helpers ────────────────────────────────────────────────────────
function getBingoLetter(n: number): string {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function getBingoColor(n: number): string {
  if (n <= 15) return '#60a5fa'; // B — blue
  if (n <= 30) return '#f87171'; // I — red
  if (n <= 45) return '#4ade80'; // N — green
  if (n <= 60) return '#fbbf24'; // G — yellow
  return '#c084fc';              // O — purple
}

// Inject ball pop animation once with enhanced performance
if (typeof document !== 'undefined' && !document.getElementById('ball-pop-style')) {
  const s = document.createElement('style');
  s.id = 'ball-pop-style';
  s.textContent = `
    @keyframes ballPop {
      0%   { transform: scale(0.3) rotate(-15deg); opacity: 0; }
      60%  { transform: scale(1.0) rotate(2deg); opacity: 1; }
      80%  { transform: scale(0.95) rotate(-1deg); }
      100% { transform: scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes ballPulse {
      0%,100% { box-shadow: 0 0 32px var(--ball-color,#60a5fa), inset 0 2px 0 rgba(255,255,255,0.2); }
      50%      { box-shadow: 0 0 60px var(--ball-color,#60a5fa), 0 0 100px var(--ball-color,#60a5fa)44, inset 0 2px 0 rgba(255,255,255,0.2); }
    }
    @keyframes ballShine {
      0%   { opacity: 0.6; transform: translateX(-100%) rotate(25deg); }
      100% { opacity: 0; transform: translateX(200%) rotate(25deg); }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    /* Performance optimizations */
    .number-cell { will-change: background, color, box-shadow; }
    .ball-container { will-change: transform, opacity; }
    .payout-ball { will-change: box-shadow; }
  `;
  document.head.appendChild(s);
}

// ── CtrlBtn ───────────────────────────────────────────────────────────────────
const CtrlBtn: React.FC<{
  label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; purple?: boolean; danger?: boolean;
  title?: string; size?: 'sm' | 'md' | 'lg';
}> = ({ label, onClick, disabled, active, purple, danger, title, size = 'md' }) => {
  let bg = 'rgba(251,191,36,0.15)';
  let color = '#fbbf24';
  let border = '1px solid rgba(251,191,36,0.3)';
  if (active) { bg = '#fbbf24'; color = '#111'; border = 'none'; }
  if (purple) { bg = 'rgba(147,51,234,0.2)'; color = '#c084fc'; border = '1px solid rgba(147,51,234,0.3)'; }
  if (danger) { bg = 'rgba(239,68,68,0.15)'; color = '#f87171'; border = '1px solid rgba(239,68,68,0.3)'; }

  const sizeClass =
    size === 'lg' ? 'px-5 py-3 text-base rounded-2xl' :
    size === 'sm' ? 'px-2 py-1.5 text-xs rounded-lg' :
                   'px-3 py-2.5 text-sm rounded-xl';

  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`font-bold transition-all disabled:opacity-30 hover:brightness-125 active:scale-95 ${sizeClass}`}
      style={{ background: bg, color, border, minHeight: size === 'lg' ? 48 : size === 'sm' ? 32 : 40 }}>
      {label}
    </button>
  );
};

// ── NumberBoard ───────────────────────────────────────────────────────────────
const NumberBoard: React.FC<{ calledNumbers: number[]; lastNumber: number | null }> = ({
  calledNumbers, lastNumber,
}) => (
  <div className="w-full h-full flex flex-col" role="region" aria-label="Bingo number board"
    style={{ gap: 'clamp(1px, 0.4vh, 6px)' }}>
    {ROWS_DEF.map(({ letter, start }) => (
      <div key={letter} className="flex-1 min-h-0 flex"
        style={{ gap: 'clamp(1px, 0.4vw, 6px)' }}>

        {/* BINGO letter label */}
        <div className="flex items-center justify-center font-black shrink-0"
          style={{
            width: 'clamp(22px, 5.5vw, 60px)',
            borderRadius: 'clamp(3px, 0.5vw, 10px)',
            background: 'linear-gradient(180deg, #f5a623, #e08c00)',
            color: '#111',
            fontSize: 'clamp(11px, 3.5vw, 32px)',
            boxShadow: '0 2px 8px rgba(245,166,35,0.4)',
          }}>
          {letter}
        </div>

        {/* 15 number cells */}
        {Array.from({ length: 15 }, (_, i) => {
          const num = start + i;
          const called = calledNumbers.includes(num);
          const isLast = num === lastNumber;
          return (
            <div key={num}
              aria-label={`${num}${called ? ' called' : ''}`}
              className="flex-1 flex items-center justify-center font-bold transition-all duration-200 number-cell"
              style={{
                fontSize: 'clamp(9px, 3.2vw, 38px)',
                borderRadius: 'clamp(3px, 0.5vw, 10px)',
                background: isLast
                  ? 'linear-gradient(180deg, #f5a623, #e08c00)'
                  : called
                  ? 'linear-gradient(180deg, #22c55e, #15803d)'
                  : 'linear-gradient(180deg, #1e2d45, #162033)',
                color: '#fff',
                boxShadow: isLast
                  ? '0 2px 12px rgba(245,166,35,0.5)'
                  : called
                  ? '0 2px 8px rgba(34,197,94,0.35)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                border: isLast
                  ? '2px solid #f5a623'
                  : called
                  ? '1px solid #22c55e'
                  : '1px solid rgba(255,255,255,0.08)',
                fontWeight: 800,
                textShadow: isLast || called ? 'none' : '0 1px 3px rgba(0,0,0,0.8)',
                transform: isLast ? 'scale(1.02)' : 'scale(1)',
                lineHeight: 1,
              }}>
              {num}
            </div>
          );
        })}
      </div>
    ))}
  </div>
);

// ── CartelaPreviewModal ───────────────────────────────────────────────────────

/** Returns the flat indices (0-24) that are part of any completed winning line. */
function getWinIndices(mask: boolean[], pattern: string | null): number[] {
  if (!pattern) return [];
  if (pattern === 'fullhouse') return Array.from({length:25},(_,i)=>i);
  if (pattern === 'fourCorners') return mask[0]&&mask[4]&&mask[20]&&mask[24] ? [0,4,20,24] : [];
  if (pattern === 'X') {
    const main=[0,6,12,18,24], anti=[4,8,12,16,20];
    if (main.every(i=>mask[i]) && anti.every(i=>mask[i])) return [...new Set([...main,...anti])];
    return [];
  }
  if (pattern === 'plus') {
    const row=[10,11,12,13,14], col=[2,7,12,17,22];
    if (row.every(i=>mask[i]) && col.every(i=>mask[i])) return [...new Set([...row,...col])];
    return [];
  }
  if (pattern === 'T') {
    const top=[0,1,2,3,4], mid=[2,7,12,17,22];
    if (top.every(i=>mask[i]) && mid.every(i=>mask[i])) return [...new Set([...top,...mid])];
    return [];
  }
  if (pattern === 'L') {
    const left=[0,5,10,15,20], bot=[20,21,22,23,24];
    if (left.every(i=>mask[i]) && bot.every(i=>mask[i])) return [...new Set([...left,...bot])];
    return [];
  }
  if (pattern === 'frame') {
    const frame=[0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24];
    return frame.every(i=>mask[i]) ? frame : [];
  }
  if (pattern === 'roundFree') {
    const ring = [6,7,8,11,13,16,17,18];
    return ring.every(i => mask[i]) ? ring : [];
  }

  // line-based: highlight all completed lines (rows, cols, diagonals, corners, ring)
  const result = new Set<number>();
  for (let r = 0; r < 5; r++) {
    const idxs = [0,1,2,3,4].map(c => r*5+c);
    if (idxs.every(i => mask[i])) idxs.forEach(i => result.add(i));
  }
  for (let c = 0; c < 5; c++) {
    const idxs = [0,1,2,3,4].map(r => r*5+c);
    if (idxs.every(i => mask[i])) idxs.forEach(i => result.add(i));
  }
  const main=[0,6,12,18,24]; if (main.every(i=>mask[i])) main.forEach(i=>result.add(i));
  const anti=[4,8,12,16,20]; if (anti.every(i=>mask[i])) anti.forEach(i=>result.add(i));
  if (mask[0]&&mask[4]&&mask[20]&&mask[24]) [0,4,20,24].forEach(i=>result.add(i));
  const ring=[6,7,8,11,13,16,17,18]; if (ring.every(i=>mask[i])) ring.forEach(i=>result.add(i));
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
  const CELL = typeof window !== 'undefined' && window.innerWidth < 400 ? 46 : 57;
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
        {/* Title row */}
        <div className="flex items-center justify-between w-full">
          <div className="text-yellow-400 font-extrabold text-lg tracking-widest">Card #{cardNumber}</div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.08)' }}>
            ✕
          </button>
        </div>

        {/* Grid wrapper — position relative so SVG overlay sits on top */}
        <div className="relative" style={{ width: GRID, height: GRID + 38, paddingTop: 38 }}>

          {/* BINGO header row */}
          <div className="absolute top-0 left-0 right-0 flex gap-[6px]">
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
            const top = 38 + row * (CELL + GAP);

            return (
              <div key={idx}
                className="absolute flex items-center justify-center font-bold rounded-xl transition-all"
                style={{ left, top, width: CELL, height: CELL, background: bg, color, border, boxShadow: shadow, fontSize: 15 }}>
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


      </div>
    </div>
  );
};
