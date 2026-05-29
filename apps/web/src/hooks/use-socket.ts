'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSocketContext } from '@/components/socket-provider';
import type { Socket } from 'socket.io-client';

export function useSocketEvent<T = unknown>(
  event: string,
  callback: (payload: T) => void,
) {
  const { socket } = useSocketContext();
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: T) => cbRef.current(payload);
    socket.on(event, handler);

    return () => {
      socket.off(event, handler);
    };
  }, [socket, event]);
}

export function useSocketEmit() {
  const { socket } = useSocketContext();

  const emit = useCallback(
    <T = unknown>(event: string, payload: T) => {
      socket?.emit(event, payload);
    },
    [socket],
  );

  return emit;
}
