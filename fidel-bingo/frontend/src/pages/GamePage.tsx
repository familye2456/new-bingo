import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { gameApi } from '../services/api';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useGameSettings, ALL_VOICE_CATEGORIES, THEMES } from '../store/gameSettingsStore';
import { playCachedSound, playNumberSoundQueued, downloadVoiceSounds, audioQueue, unlockAudioContext } from '../services/db';
import { CartelaCard } from '../components/CartelaCard';
import { NumberBoard } from '../components/NumberBoard';

let _unlocked = false;
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (_unlocked) return;
    _unlocked = true;
    unlockAudioContext();
  };
  document.addEventListener('pointerdown', unlock, { capture: true, once: true });
  document.addEventListener('touchstart', unlock, { capture: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, once: true });
}

function playRootSound(filename: string, queued = false) {
  if (!_unlocked) return;
  if (queued) {
    audioQueue.enqueue(() => playCachedSound(`/sounds/${filename}`).then(() => {}));
  } else {
    playCachedSound(`/sounds/${filename}`).catch(() => {});
  }
}

export const GamePage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentGame, lastCalledNumber, setGame, addCalledNumber, updateCartela } = useGameStore();

  const { voice, autoCallInterval, volume, theme: themeName } = useGameSettings();
  const theme = THEMES[themeName];
  const [autoCall, setAutoCall] = useState(false);
  const autoCallRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  const gameStatusRef = useRef(currentGame?.status);
  useEffect(() => { gameStatusRef.current = currentGame?.status; }, [currentGame?.status]);

  // ── Load game fresh on every mount — no React Query cache ──────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [displayedNumbers, setDisplayedNumbers] = useState<number[]>([]);
  const isReplayingRef = useRef(true);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    isReplayingRef.current = true;
    setDisplayedNumbers([]);

    const load = async () => {
      try {
        // Refreshing an active game replays the stored sequence from its first number.
        await gameApi.resetGame(gameId).catch(() => {});

        const [gameRes, cartelasRes] = await Promise.all([
          gameApi.get(gameId),
          gameApi.getCartelas(gameId),
        ]);
        if (cancelled) return;

        const gameData = { ...gameRes.data.data, calledNumbers: [] };
        const cartelas = cartelasRes.data.data ?? gameData.cartelas ?? [];

        setGame({ ...gameData, cartelas });
        setDisplayedNumbers(gameData.calledNumbers ?? []);
        setIsLoading(false);
        isReplayingRef.current = false;

      } catch {
        if (!cancelled) { isReplayingRef.current = false; setIsLoading(false); }
      }
    };

    load();
    return () => { cancelled = true; isReplayingRef.current = false; };
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-preload voice pack ─────────────────────────────────────────────────
  useEffect(() => {
    downloadVoiceSounds(voice);
  }, [voice]);

  // ── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return;
    const socket = getSocket();

    const joinGame = () => socket.emit('join_game', gameId);
    socket.on('connect', () => joinGame());
    socket.on('connect_error', (e) => console.error('[Socket] connect_error:', e.message));
    if (socket.connected) joinGame();

    socket.on('game_state', (game: any) => {
      if (game.status === 'active' && gameStatusRef.current !== 'active') {
        playRootSound('start.wav');
      }
      // During replay, only update game metadata — not calledNumbers
      if (isReplayingRef.current) {
        setGame({ ...game, calledNumbers: [] });
      } else {
        setGame(game);
      }
    });

    socket.on('number_called', ({ number }: { number: number }) => {
      if (isReplayingRef.current) return; // ignore during replay
      addCalledNumber(number);
      setDisplayedNumbers(prev => [...prev, number]);
      playNumberSoundQueued(number, voiceRef.current, volumeRef.current);
    });

    socket.on('game_finished', () => {
      playRootSound('winner.wav', true);
      setAutoCall(false);
      setTimeout(() => navigate('/dashboard'), 3000);
    });

    return () => {
      socket.emit('leave_game', gameId);
      socket.off('connect');
      socket.off('connect_error');
      socket.off('game_state');
      socket.off('number_called');
      socket.off('game_finished');
    };
  }, [gameId, setGame, addCalledNumber, navigate]);

  // ── Auto-call ───────────────────────────────────────────────────────────────
  const doCallNumber = useCallback(() => {
    if (!gameId) return;
    getSocket().emit('call_number', gameId);
  }, [gameId]);

  useEffect(() => { autoCallRef.current = autoCall; }, [autoCall]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!autoCall || currentGame?.status !== 'active') return;

    const intervalMs = Math.max(autoCallInterval * 1000, 1500);
    const scheduleNext = () => {
      if (!autoCallRef.current) return;
      timeoutRef.current = setTimeout(async () => {
        if (!autoCallRef.current) return;
        await audioQueue.waitForDrain();
        if (!autoCallRef.current) return;
        doCallNumber();
        scheduleNext();
      }, intervalMs);
    };

    doCallNumber();
    scheduleNext();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [autoCall, autoCallInterval, currentGame?.status, doCallNumber]);

  useEffect(() => {
    if (currentGame?.status === 'finished' || currentGame?.status === 'cancelled') {
      setAutoCall(false);
    }
  }, [currentGame?.status]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleCallNumber = useCallback(() => {
    if (!gameId) return;
    getSocket().emit('call_number', gameId);
  }, [gameId]);

  const handleMarkNumber = useCallback(async (cartelaId: string, number: number) => {
    try {
      const res = await gameApi.markNumber(cartelaId, number);
      const { isWinner } = res.data.data;
      if (isWinner) {
        const cartela = currentGame?.cartelas.find((c) => c.id === cartelaId);
        if (cartela) {
          const newMask = [...cartela.patternMask];
          const idx = cartela.numbers.indexOf(number);
          if (idx !== -1) newMask[idx] = true;
          updateCartela(cartelaId, newMask);
        }
      }
    } catch (err) { console.error('Failed to mark number', err); }
  }, [currentGame, updateCartela]);

  const handleClaimBingo = useCallback(async (cartelaId: string) => {
    if (!gameId) return;
    try {
      await gameApi.claimBingo(gameId, cartelaId);
      playRootSound('winner.wav', true);
    } catch (err) { console.error('Failed to claim bingo', err); }
  }, [gameId]);

  const handleStartGame = useCallback(() => {
    if (!gameId) return;
    getSocket().emit('start_game', gameId);
  }, [gameId]);

  const prevWinnerIds = useRef<Set<string>>(new Set());
  const myCartelas = (currentGame?.cartelas ?? []).filter((c) => (c as unknown as { userId: string }).userId === user?.id);
  useEffect(() => {
    for (const cartela of myCartelas) {
      if (cartela.isWinner && !prevWinnerIds.current.has(cartela.id)) {
        prevWinnerIds.current.add(cartela.id);
        playRootSound('winner.wav', true);
      }
    }
  }, [myCartelas]);

  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading game...</div>;
  if (!currentGame) return <div className="flex items-center justify-center h-screen">Game not found</div>;

  const isCreator = currentGame.creatorId === user?.id;

  return (
    <div className="min-h-screen p-4" style={{ background: theme.pageBg }}>
      <div id="game-announcer" className="sr-only" role="status" aria-live="polite" />
      <div className="max-w-6xl mx-auto">

        {/* Header card */}
        <div
          className="rounded-xl p-4 mb-4 flex items-center justify-between flex-wrap gap-3"
          style={{ background: theme.headerBg, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
        >
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: theme.headerText }}>
              Happy Bingo — #{currentGame.gameNumber ?? currentGame.id.slice(0, 8)}
            </h1>
            <span
              className="text-sm px-3 py-0.5 rounded-full font-semibold"
              style={{
                background:
                  currentGame.status === 'active'   ? '#16a34a' :
                  currentGame.status === 'finished' ? '#6b7280' :
                  '#f59e0b',
                color: '#ffffff',
              }}
            >
              {currentGame.status.charAt(0).toUpperCase() + currentGame.status.slice(1)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-sm" style={{ color: theme.headerSubText }}>Prize Pool</div>
            <div className="text-2xl font-extrabold" style={{ color: theme.prizeText }}>
              ${Number(currentGame.prizePool).toFixed(0)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <NumberBoard
              calledNumbers={displayedNumbers}
              lastNumber={displayedNumbers[displayedNumbers.length - 1] ?? null}
              theme={theme}
            />

            {isCreator && currentGame.status === 'pending' && (
              <button
                data-testid="start-game-btn"
                onClick={handleStartGame}
                className="mt-4 w-full py-3 rounded-lg font-semibold transition-colors"
                style={{ background: theme.btnPrimaryBg, color: theme.btnPrimaryText }}
              >
                Start Game
              </button>
            )}

            {isCreator && currentGame.status === 'active' && (
              <div className="mt-4 space-y-2">
                <button
                  data-testid="call-number-btn"
                  onClick={handleCallNumber}
                  disabled={autoCall}
                  className="w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: theme.btnSecondaryBg, color: theme.btnSecondaryText }}
                >
                  Call Number
                </button>
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: theme.autocallPanelBg, border: `1px solid ${theme.autocallPanelBorder}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: theme.autocallLabelText }}>Auto Call</span>
                    <button
                      onClick={() => setAutoCall((v) => {
                        const next = !v;
                        playRootSound(next ? 'aac_resumed.mp3' : 'aac_ended.mp3');
                        return next;
                      })}
                      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                      style={{ background: autoCall ? theme.autocallOnBg : theme.autocallOffBg }}
                    >
                      <span
                        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                        style={{ transform: autoCall ? 'translateX(1.5rem)' : 'translateX(0.25rem)' }}
                      />
                    </button>
                  </div>
                  <div className="text-xs text-center" style={{ color: theme.autocallInfoText }}>
                    Interval: {autoCallInterval}s · Voice: {ALL_VOICE_CATEGORIES.find(c => c.value === voice)?.label ?? voice}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <h2 className="font-extrabold mb-3 text-lg" style={{ color: theme.sectionTitle }}>Your Cartelas</h2>
            {myCartelas.length === 0 ? (
              <div className="text-center py-8" style={{ color: theme.sectionEmpty }}>No cartelas yet</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-6">
                {myCartelas.map((cartela) => (
                  <div key={cartela.id}>
                    <CartelaCard
                      cartela={cartela}
                      calledNumbers={displayedNumbers}
                      onMark={handleMarkNumber}
                      disabled={currentGame.status !== 'active'}
                      theme={theme}
                    />
                    {cartela.isWinner && (
                      <button
                        onClick={() => handleClaimBingo(cartela.id)}
                        className="mt-2 w-full py-2 rounded-lg font-extrabold transition-colors"
                        style={{ background: theme.btnClaimBg, color: theme.btnClaimText }}
                      >
                        Claim BINGO!
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
