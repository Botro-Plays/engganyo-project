import type { Socket } from 'socket.io-client';

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

export function getSocket(): Socket | null {
  return socket;
}

// socket.io-client is a sizeable payload that anonymous/public visitors
// never need - import it lazily so it leaves the initial shared chunk.
export function connectSocket(token: string): Promise<Socket> {
  if (socket?.connected) {
    return Promise.resolve(socket);
  }
  if (connecting) {
    return connecting;
  }
  // Stop a dead socket's reconnection loop before replacing it.
  socket?.disconnect();

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api';
  const baseUrl = apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

  connecting = import('socket.io-client').then(({ io }) => {
    socket = io(`${baseUrl}/notifications`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    connecting = null;
    return socket;
  });
  return connecting;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
