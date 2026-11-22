'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  reconnect: () => void;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  reconnect: () => {},
});

export function useSocketContext() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  // Subscribe to the store token - token refresh updates it, and the socket
  // must reconnect with the fresh JWT or the server rejects it forever.
  const accessToken = useAuthStore((s) => s.accessToken);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

    const token = useAuthStore.getState().accessToken ?? localStorage.getItem('access_token');
    if (!token) {
      setSocket(null);
      setConnected(false);
      return;
    }

    let s: Socket | null = null;
    let active = true;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);

    void connectSocket(token)
      .then((created) => {
        // Effect cleaned up, or the attempt was superseded/disconnected
        // while the lazy import resolved (connectSocket resolves null).
        if (!active || !created) return;
        s = created;
        s.on('connect', onConnect);
        s.on('disconnect', onDisconnect);
        s.on('connect_error', onConnectError);

        if (s.connected) {
          setConnected(true);
        }

        setSocket(s);
      })
      // Import/connect failure leaves no socket - handled here so the
      // rejection is never unhandled; reconnect() retries on demand.
      .catch(() => {});

    return () => {
      active = false;
      s?.off('connect', onConnect);
      s?.off('disconnect', onDisconnect);
      s?.off('connect_error', onConnectError);
    };
  }, []);

  useEffect(() => {
    disconnectSocket();
    setSocket(null);
    setConnected(false);
    const cleanup = connect();
    return () => {
      cleanup?.();
    };
    // Reconnect whenever the access token changes (login, refresh).
  }, [connect, accessToken]);

  const reconnect = useCallback(() => {
    disconnectSocket();
    setSocket(null);
    setConnected(false);
    connect();
  }, [connect]);

  const contextValue = useMemo(
    () => ({ socket, connected, reconnect }),
    [socket, connected, reconnect]
  );

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}
