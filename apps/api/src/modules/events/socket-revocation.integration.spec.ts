/**
 * Real socket revocation tests: a real socket.io Server, real socket.io-client
 * connections, real JWT signing/verification, and a REAL isolated PostgreSQL
 * database (TEST_DATABASE_URL — never production; skipped when unset).
 *
 * Covers A09: reconnect with a stale token after suspend/demote/soft-delete,
 * forced disconnect at access-token expiry, the revocation tombstone closing
 * the handshake race — on BOTH the notifications and channels namespaces.
 */
import { createServer, type Server as HttpServer } from 'http';
import { Server as IoServer, type Namespace } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';

import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { ChannelsGateway } from '../channels/channels.gateway';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const ACCESS_SECRET = 'socket-itest-access-secret';
const PREFIX = `srev_${Date.now().toString(36)}_`;

/** In-memory RedisService stand-in with real tombstone semantics. */
class FakeRedis {
  private readonly map = new Map<string, string>();
  async get(key: string) { return this.map.get(key) ?? null; }
  async set(key: string, value: string) { this.map.set(key, value); }
  async del(key: string) { this.map.delete(key); }
  async revokeSocketAuth(userId: string) { this.map.set(`auth:revoked:${userId}`, '1'); }
  async isSocketAuthRevoked(userId: string) { return this.map.has(`auth:revoked:${userId}`); }
  async invalidateUserCaches() { /* no-op */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

run('Socket revocation — real socket.io + real PostgreSQL', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let http: HttpServer;
  let io: IoServer;
  let notifNs: Namespace;
  let chanNs: Namespace;
  let eventsService: EventsService;
  let redis: FakeRedis;
  let jwt: JwtService;
  let port: number;
  let seq = 0;
  const clients: ClientSocket[] = [];

  const config = {
    get: (key: string, fallback?: unknown) =>
      ({ 'jwt.accessSecret': ACCESS_SECRET, 'redis.host': 'localhost', 'redis.port': 6379 })[key] ?? fallback,
  } as ConfigService;

  const makeUser = async (role: UserRole = UserRole.USER) => {
    const tag = `${PREFIX}${seq++}`;
    return prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        role,
        wallet: { create: {} },
      },
    });
  };

  const sign = (user: { id: string; role: UserRole }, expiresIn: number | string = '15m') =>
    jwt.sign(
      {
        sub: user.id, email: 'x@x', username: 'u',
        role: user.role, purpose: 'access',
      },
      { secret: ACCESS_SECRET, expiresIn },
    );

  const memberCount = async (ns: Namespace, userId: string) =>
    (await ns.in(`user:${userId}`).fetchSockets()).length;

  /** Connect a client; after a settle delay report whether the socket
   *  survived in the user's room (server-side truth). */
  const attempt = async (ns: 'notifications' | 'channels', userId: string, token: string, settleMs = 500) => {
    const socket = ioc(`http://127.0.0.1:${port}/${ns}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    await sleep(settleMs);
    const count = await memberCount(ns === 'notifications' ? notifNs : chanNs, userId);
    socket.close();
    return count;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    redis = new FakeRedis();
    jwt = new JwtService();
    eventsService = new EventsService(redis as never);

    const eventsGw = new EventsGateway(
      config, jwt, eventsService, prisma as never, redis as never,
    );
    const channelsGw = new ChannelsGateway(
      jwt, config, {} as never, eventsService, prisma as never, redis as never,
    );

    http = createServer();
    io = new IoServer(http, { transports: ['websocket'] });
    notifNs = io.of('/notifications');
    chanNs = io.of('/channels');
    eventsService.setServer(notifNs as never);
    eventsService.setChannelsServer(chanNs as never);
    notifNs.on('connection', (s) => void eventsGw.handleConnection(s));
    chanNs.on('connection', (s) => void channelsGw.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    port = (http.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    redis['map'].clear();
    await prisma.wallet.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    void io.close();
    http.close();
    await prisma.$disconnect();
  });

  it.each(['notifications', 'channels'] as const)(
    'active user connects on /%s and lands in the per-user room',
    async (ns) => {
      const user = await makeUser();
      expect(await attempt(ns, user.id, sign(user))).toBe(1);
    },
  );

  it.each(['notifications', 'channels'] as const)(
    'suspend then reconnect with the same unexpired token → rejected on /%s',
    async (ns) => {
      const user = await makeUser();
      const token = sign(user);
      expect(await attempt(ns, user.id, token)).toBe(1);

      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.SUSPENDED } });
      // Same token, still unexpired — the DB check must reject it.
      expect(await attempt(ns, user.id, token)).toBe(0);
    },
  );

  it('demote ADMIN→USER then reconnect: connects but joins NO admin room', async () => {
    const user = await makeUser(UserRole.ADMIN);
    const token = sign(user); // token still claims ADMIN

    expect(await attempt('notifications', user.id, token)).toBe(1);
    expect((await notifNs.in('admin').fetchSockets()).length).toBe(1);

    await prisma.user.update({ where: { id: user.id }, data: { role: UserRole.USER } });
    await attempt('notifications', user.id, token); // reconnect with stale-claim token

    const adminSockets = await notifNs.in('admin').fetchSockets();
    // The new socket must have joined with the DB role — no admin room entry.
    expect(adminSockets.filter((s) => s.data.userId === user.id)).toHaveLength(0);
    // Channels namespace: the socket's effective role is the DB role.
    await attempt('channels', user.id, token);
    const chanSockets = await chanNs.in(`user:${user.id}`).fetchSockets();
    expect(chanSockets.every((s) => s.data.role === UserRole.USER)).toBe(true);
  });

  it.each(['notifications', 'channels'] as const)(
    'soft-deleted account → reconnect rejected on /%s',
    async (ns) => {
      const user = await makeUser();
      const token = sign(user);
      expect(await attempt(ns, user.id, token)).toBe(1);

      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      expect(await attempt(ns, user.id, token)).toBe(0);
    },
  );

  it('access-token expiry force-disconnects an established socket', async () => {
    const user = await makeUser();
    const socket = ioc(`http://127.0.0.1:${port}/notifications`, {
      auth: { token: sign(user, 1) }, // expires in 1s
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    await sleep(400);
    expect(await memberCount(notifNs, user.id)).toBe(1);

    // Past exp the server must drop the connection on its own.
    await sleep(1300);
    expect(await memberCount(notifNs, user.id)).toBe(0);
    expect(socket.connected).toBe(false);
  });

  it.each(['notifications', 'channels'] as const)(
    'disconnectUser drops the live socket AND tombstones the token on /%s',
    async (ns) => {
      const user = await makeUser();
      const token = sign(user);
      const socket = ioc(`http://127.0.0.1:${port}/${ns}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(socket);
      await sleep(400);
      const nsObj = ns === 'notifications' ? notifNs : chanNs;
      expect(await memberCount(nsObj, user.id)).toBe(1);

      await eventsService.disconnectUser(user.id);
      await sleep(200);
      expect(await memberCount(nsObj, user.id)).toBe(0);

      // Reconnect with the same unexpired token — tombstone rejects it.
      expect(await attempt(ns, user.id, token)).toBe(0);
    },
  );

  it('handshake racing revocation cannot escape the post-join tombstone check', async () => {
    const user = await makeUser();
    const token = sign(user);

    // Simulate the race: first tombstone check passes (pre-join), second
    // (post-join) sees the revocation — the socket must be disconnected.
    let calls = 0;
    const racyRedis = new FakeRedis();
    jest.spyOn(racyRedis, 'isSocketAuthRevoked').mockImplementation(async () => {
      calls += 1;
      return calls >= 2; // revoked "during" the join
    });
    const gw = new EventsGateway(config, jwt, eventsService, prisma as never, racyRedis as never);
    const raceNs = io.of('/notifications');
    // Replace the connection handler with the racy-redis gateway.
    raceNs.removeAllListeners('connection');
    raceNs.on('connection', (s) => void gw.handleConnection(s));
    try {
      expect(await attempt('notifications', user.id, token)).toBe(0);
    } finally {
      raceNs.removeAllListeners('connection');
      raceNs.on('connection', (s) => void new EventsGateway(config, jwt, eventsService, prisma as never, redis as never).handleConnection(s));
    }
  });
});
