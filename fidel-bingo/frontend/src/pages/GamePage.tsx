import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '../services/api';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useGameSettings, ALL_VOICE_CATEGORIES } from '../store/gameSettingsStore';
import { playCachedSound, playNumberSoundQueued, downloadVoiceSounds, audioQueue } from '../services/db';
import { CartelaCard } from '../components/CartelaCard';
import { NumberBoard } from '../components/NumberBoard';

// ── Audio unlock (Task 3.5) ──────────────────────────────────────────────────
let _unlocked = false;
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (_unlocked) return;
    _unlocked = true;
    try {
      // Satisfy iOS Web Audio API requirement
      new AudioContext().resume();
    } catch { /* browser without AudioContext */ }
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

  const { voice, autoCallInterval, volume } = useGameSettings();
  const [autoCall, setAutoCall] = useState(false);
  const autoCallRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  const gameStatusRef = useRef(currentGame?.status);
  useEffect(() => { gameStatusRef.current = currentGame?.status; }, [currentGame?.status]);

  const { data, isLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => gameApi.get(gameId!).then((r) => r.data.data),
    enabled: !!gameId,
  });

  const { data: cartelasData } = useQuery({
    queryKey: ['game-cartelas', gameId],
    queryFn: () => gameApi.getCartelas(gameId!).then((r) => r.data.data),
    enabled: !!gameId,
  });

  const replayedRef = useRef(false);
  const isReplayingRef = useRef(false);
  const [displayedNumbers, setDisplayedNumbers] = useState<number[]>([]);
  const [isReplaying, setIsReplaying] = useState(true);

  useEffect(() => {
    if (!data || replayedRef.current) return;
    replayedRef.current = true;

    const calledNums: number[] = data.calledNumbers ?? [];
    const cartelas = cartelasData ?? data.cartelas ?? [];

    setGame({ ...data, cartelas });
    setDisplayedNumbers([]);

    if (calledNums.length === 0) {
      setIsReplaying(false);
      return;
    }

    isReplayingRef.current = true;
    let i = 0;
    const interval = setInterval(() => {
      if (i >= calledNums.length) {
        clearInterval(interval);
        isReplayingRef.current = false;
        setIsReplaying(false);
        return;
      }
      const num = calledNums[i];
      setDisplayedNumbers(prev => [...prev, num]);
      i++;
    }, 300);

    return () => clearInterval(interval);
  }, [data, cartelasData]); // eslint-disable-line react-hooks/exhaustive-deps

  // After replay done, keep displayedNumbers in sync with live called numbers
  useEffect(() => {
    if (!isReplaying && currentGame) {
      setDisplayedNumbers(currentGame.calledNumbers);
    }
  }, [isReplaying, currentGame?.calledNumbers]); // eslint-disable-line react-hooks/exhaustive-deps

  // New numbers from socket during live play
  useEffect(() => {
    if (!isReplaying && lastCalledNumber !== null) {
      setDisplayedNumbers(currentGame?.calledNumbers ?? []);
    }
  }, [lastCalledNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPostpaid = user?.paymentType === 'postpaid';

  // ── Auto-preload voice pack — only for prepaid users (postpaid use public folder directly) ──
  useEffect(() => {
    if (!isPostpaid) downloadVoiceSounds(voice);
  }, [voice, isPostpaid]);

  useEffect(() => {
    if (!gameId) return;
    const socket = getSocket();
    console.log('[Socket] state:', socket.connected, socket.id);

    const joinGame = () => {
      console.log('[Socket] joining game:', gameId);
      socket.emit('join_game', gameId);
    };

    socket.on('connect', () => {
      console.log('[Socket] connected:', socket.id);
      joinGame(); // re-join after reconnect/fresh connect
    });
    socket.on('connect_error', (e) => console.error('[Socket] connect_error:', e.message));
    socket.on('error', (e) => console.error('[Socket] error:', e));

    // If already connected, join immediately
    if (socket.connected) joinGame();
    socket.on('game_state', (game: any) => {
      if (game.status === 'active' && gameStatusRef.current !== 'active') {
        playRootSound('start.wav');
      }
      setGame(game);
    });
    socket.on('number_called', ({ number }: { number: number }) => {
      console.log('[Socket] number_called received:', number, 'voice:', voiceRef.current);
      addCalledNumber(number);
      playNumberSoundQueued(number, voiceRef.current, volumeRef.current, isPostpaid);
    });
    socket.on('game_finished', () => {
      // Play winner sound through queue so it doesn't overlap with number sounds
      playRootSound('winner.wav', true);
      setAutoCall(false);
      setTimeout(() => navigate('/dashboard'), 3000);
    });
    return () => {
      socket.emit('leave_game', gameId);
      socket.off('connect');
      socket.off('connect_error');
      socket.off('error');
      socket.off('game_state');
      socket.off('number_called');
      socket.off('game_finished');
    };
  }, [gameId, setGame, addCalledNumber, navigate]);

  // ── Auto-call logic (Task 3.9) ───────────────────────────────────────────
  const doCallNumber = useCallback(() => {
    if (!gameId) return;
    const socket = getSocket();
    socket.emit('call_number', gameId);
  }, [gameId]);

  useEffect(() => {
    autoCallRef.current = autoCall;
  }, [autoCall]);

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

  // Stop auto-call when game ends
  useEffect(() => {
    if (currentGame?.status === 'finished' || currentGame?.status === 'cancelled') {
      setAutoCall(false);
    }
  }, [currentGame?.status]);
  // ────────────────────────────────────────────────────────────────────────

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
    } catch (err) {
      console.error('Failed to mark number', err);
    }
  }, [currentGame, updateCartela]);

  const handleClaimBingo = useCallback(async (cartelaId: string) => {
    if (!gameId) return;
    try {
      await gameApi.claimBingo(gameId, cartelaId);
      // Play winner sound through queue after successful bingo claim
      playRootSound('winner.wav', true);
    } catch (err) {
      console.error('Failed to claim bingo', err);
    }
  }, [gameId]);

  const handleStartGame = useCallback(() => {
    if (!gameId) return;
    getSocket().emit('start_game', gameId);
  }, [gameId]);

  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading game...</div>;
  if (!currentGame) return <div className="flex items-center justify-center h-screen">Game not found</div>;

  const isCreator = currentGame.creatorId === user?.id;
  const myCartelas = (currentGame.cartelas ?? []).filter((c) => (c as unknown as { userId: string }).userId === user?.id);

  // Play winner sound as soon as any of the player's cartelas becomes a winner
  const prevWinnerIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const cartela of myCartelas) {
      if (cartela.isWinner && !prevWinnerIds.current.has(cartela.id)) {
        prevWinnerIds.current.add(cartela.id);
        playRootSound('winner.wav', true);
      }
    }
  }, [myCartelas]);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div id="game-announcer" className="sr-only" role="status" aria-live="polite" />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold">Game #{currentGame.gameNumber ?? currentGame.id.slice(0, 8)}</h1>
            <span className={`text-sm px-2 py-0.5 rounded-full ${
              currentGame.status === 'active'   ? 'bg-green-100 text-green-700' :
              currentGame.status === 'finished' ? 'bg-gray-100 text-gray-600' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {currentGame.status.charAt(0).toUpperCase() + currentGame.status.slice(1)}
            </span>
          </div>

          <div className="text-right">
            <div className="text-sm text-gray-500">Prize Pool</div>
            <div className="text-2xl font-bold text-green-600">${Number(currentGame.prizePool).toFixed(2)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Number board */}
          <div className="lg:col-span-1">
            <NumberBoard calledNumbers={displayedNumbers} lastNumber={isReplaying ? (displayedNumbers[displayedNumbers.length - 1] ?? null) : lastCalledNumber} />

            {/* Controls */}
            {isCreator && currentGame.status === 'pending' && (
              <button
                data-testid="start-game-btn"
                onClick={handleStartGame}
                className="mt-4 w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                Start Game
              </button>
            )}

            {isCreator && currentGame.status === 'active' && (
              <div className="mt-4 space-y-2">
                {/* Manual call */}
                <button
                  data-testid="call-number-btn"
                  onClick={handleCallNumber}
                  disabled={autoCall}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Call Number
                </button>

                {/* Auto-call toggle */}
                <div className="bg-white rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Auto Call</span>
                    <button
                      onClick={() => setAutoCall((v) => {
                        const next = !v;
                        playRootSound(next ? 'aac_resumed.mp3' : 'aac_ended.mp3');
                        return next;
                      })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        autoCall ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        autoCall ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                  <div className="text-xs text-gray-400 text-center">
                    Interval: {autoCallInterval}s · Voice: {ALL_VOICE_CATEGORIES.find(c => c.value === voice)?.label ?? voice}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cartelas */}
          <div className="lg:col-span-2">
            <h2 className="font-semibold mb-3">Your Cartelas</h2>
            {myCartelas.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No cartelas yet</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {myCartelas.map((cartela) => (
                  <div key={cartela.id}>
                    <CartelaCard
                      cartela={cartela}
                      calledNumbers={displayedNumbers}
                      onMark={handleMarkNumber}
                      disabled={currentGame.status !== 'active'}
                    />
                    {cartela.isWinner && (
                      <button
                        onClick={() => handleClaimBingo(cartela.id)}
                        className="mt-2 w-full bg-yellow-500 text-white py-2 rounded-lg font-bold hover:bg-yellow-600"
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
