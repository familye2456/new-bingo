import { io, Socket } from 'socket.io-client';
import { dbGet, dbPut } from './db';
import { useAuthStore } from '../store/authStore';
import { useGameSettings } from '../store/gameSettingsStore';

let socket: Socket | null = null;
const apiUrl = import.meta.env.VITE_API_URL || 'https://fidel-bingo.onrender.com/api';
const socketUrl = apiUrl.replace(/\/api\/?$/, '');

const bindSocketListeners = (socketInstance: Socket) => {
  socketInstance.off('balance_updated');
  socketInstance.on('balance_updated', async ({ userId, balance }: { userId?: string; balance?: number }) => {
    if (typeof balance !== 'number' || !userId) return;
    const currentUser = useAuthStore.getState().user;
    if (currentUser && currentUser.id !== userId) return;

    try {
      const localUser = await dbGet<any>('user', 'me');
      if (localUser) {
        await dbPut('user', { ...localUser, balance }, 'me');
      }
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, balance } : state.user,
      }));
      window.dispatchEvent(new CustomEvent('balance-updated', { detail: { userId, balance } }));
    } catch (err) {
      console.error('[socket] Failed to update balance from server push:', err);
    }
  });

  // When admin changes the user's voice, apply it and start downloading immediately
  socketInstance.off('voice_updated');
  socketInstance.on('voice_updated', async ({ userId, voice }: { userId?: string; voice?: string }) => {
    if (!voice || !userId) return;
    const currentUser = useAuthStore.getState().user;
    if (currentUser && currentUser.id !== userId) return;

    const validVoices = ['boy sound','boy simpol','boy with symbol','boy1 sound','girl sound','girl 1','girl oro','men arada','men gold','men tigrina','hp sound','double sound'];
    if (!validVoices.includes(voice)) return;

    try {
      // Persist to IDB user record
      const localUser = await dbGet<any>('user', 'me');
      if (localUser) {
        await dbPut('user', { ...localUser, assignedVoice: voice }, 'me');
      }
      // Update auth store
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, assignedVoice: voice } as any : state.user,
      }));
      // Apply to game settings store immediately
      useGameSettings.setState({ voice: voice as any });
      // Persist to localStorage so it survives page reload
      const existing = localStorage.getItem('game-settings');
      const parsed = existing ? (() => { try { return JSON.parse(existing); } catch { return null; } })() : null;
      const merged = { state: { ...(parsed?.state ?? {}), voice }, version: parsed?.version ?? 0 };
      localStorage.setItem('game-settings', JSON.stringify(merged));

      // Start downloading the new voice sounds immediately in the background
      const { downloadVoiceSounds } = await import('./db');
      downloadVoiceSounds(voice).catch(() => {});

      window.dispatchEvent(new CustomEvent('voice-updated', { detail: { userId, voice } }));
    } catch (err) {
      console.error('[socket] Failed to apply voice update from server push:', err);
    }
  });
};

export const getSocket = (token?: string): Socket => {
  if (socket && socket.connected) return socket;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(socketUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  // Join personal room so admin balance_updated events are received
  socket.on('connect', () => {
    const user = useAuthStore.getState().user;
    if (user?.id) socket!.emit('join_user_room', user.id);
  });

  bindSocketListeners(socket);
  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
