import type { Socket } from 'socket.io-client';

type IoModule = typeof import('socket.io-client');
type Importer = () => Promise<IoModule>;

interface PendingConnection {
  token: string;
  generation: number;
  promise: Promise<Socket | null>;
}

let socket: Socket | null = null;
let socketToken: string | null = null;
let pending: PendingConnection | null = null;
// Bumped on disconnect and whenever a newer token takes over: an import
// that resolves against an older generation must never publish a socket.
let generation = 0;

export function getSocket(): Socket | null {
  return socket;
}

// socket.io-client is a sizeable payload that anonymous/public visitors
// never need - import it lazily so it leaves the initial shared chunk.
// Resolves to the live Socket, or null when the attempt was superseded
// (logout/disconnect or a newer token) while the import was in flight.
export function connectSocket(
  token: string,
  importer: Importer = () => import('socket.io-client'),
): Promise<Socket | null> {
  if (socket?.connected && socketToken === token) {
    return Promise.resolve(socket);
  }
  // An in-flight connect for the same token can be shared; a different
  // token must not inherit it (it carries the OLD token in auth).
  if (pending && pending.token === token) {
    return pending.promise;
  }

  generation += 1;
  const gen = generation;
  // Stop a dead socket's reconnection loop before replacing it.
  socket?.disconnect();
  socket = null;
  socketToken = null;

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api';
  const baseUrl = apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

  const promise = importer()
    .then(({ io }) => {
      // Stale: disconnectSocket()/logout ran, or a newer token replaced
      // this pending connect while the module was loading.
      if (gen !== generation || !pending || pending.generation !== gen) {
        return null;
      }
      const s = io(`${baseUrl}/notifications`, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });
      socket = s;
      socketToken = token;
      pending = null;
      return s;
    })
    .catch((err) => {
      // Import failure clears the pending entry so the next call retries.
      if (pending?.generation === gen) pending = null;
      throw err;
    });

  pending = { token, generation: gen, promise };
  return promise;
}

export function disconnectSocket(): void {
  // Invalidates any in-flight import: it resolves null instead of
  // publishing a socket the caller already walked away from.
  generation += 1;
  pending = null;
  socket?.disconnect();
  socket = null;
  socketToken = null;
}
