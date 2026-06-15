import { io, Socket } from 'socket.io-client';

let channelSocket: Socket | null = null;

export function getChannelSocket(): Socket | null {
  return channelSocket;
}

export function connectChannelSocket(token: string): Socket {
  if (channelSocket?.connected) {
    return channelSocket;
  }

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api';
  const baseUrl = apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

  channelSocket = io(`${baseUrl}/channels`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  channelSocket.on('connect_error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[channel-socket] connect_error:', err.message);
  });

  return channelSocket;
}

export function disconnectChannelSocket(): void {
  if (channelSocket) {
    channelSocket.disconnect();
    channelSocket = null;
  }
}
