import { io, Socket } from 'socket.io-client';
import { dbGet, dbPut } from './db';
import { useAuthStore } from '../store/authStore';

let socket: Socket | null = null;

const bindBalanceSocketListeners = (socketInstance: Socket) => {
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
};

export const getSocket = (token?: string): Socket => {
  if (socket && socket.connected) return socket;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io('/', {
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

  bindBalanceSocketListeners(socket);
  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
