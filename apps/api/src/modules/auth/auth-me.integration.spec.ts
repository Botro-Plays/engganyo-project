/**
 * Integration tests for profile-endpoint balance freshness against a REAL
 * isolated PostgreSQL database, a REAL Redis cache, and the REAL
 * WalletService settlement path.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Regression coverage for the stale-balance bug: `auth:me` and
 * `user:profile` cache the full user payload for 3600s, but wallet
 * settlements never invalidate those keys — so a cached read used to serve
 * the pre-settlement balance for up to an hour. The fix resolves
 * creditBalance from the ledger-backed wallets row on every read.
 *
 * Covers:
 *  - previously cached /auth/me returns the current balance after a credit
 *  - previously cached /auth/me returns the current balance after a debit
 *  - a getMe racing a committed settlement returns a consistent
 *    pre- or post-commit balance (never a torn or stale value)
 *  - cache read/write failure degrades to fresh DB reads: a settlement
 *    still commits and getMe still returns the authoritative balance,
 *    so a cache outage cannot turn a successful financial operation into
 *    an apparent failure or provoke a retry settlement
 *  - the sibling user:profile cache gets the same guarantee
 */
import { PrismaClient, TransactionType } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { RedisService } from '../../database/redis.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `authme_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Profile endpoints — cached balance freshness (real PG + Redis)', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let redis: RedisService;
  let auth: AuthService;
  let users: UsersService;
  let wallet: WalletService;
  let seq = 0;

  const makeUser = async (balance = 0) => {
    const tag = `${PREFIX}${seq++}`;
    return prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        creditBalance: balance,
        wallet: { create: { balance, lifetimeEarned: balance } },
      },
    });
  };

  const buildAuth = (redisService: RedisService) =>
    new AuthService(
      prisma as never,
      mockService() as never, // jwtService
      { get: (_k: string, d?: unknown) => d } as never, // configService
      mockService() as never, // emailService
      mockService() as never, // antiAbuse
      mockService() as never, // twoFactor
      mockService() as never, // notificationsService
      redisService as never,
      mockService() as never, // referralsService
    );

  const buildWallet = () =>
    new WalletService(
      prisma as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    await prisma.$connect();

    // Real RedisService against the CI Redis, namespaced per run.
    const config = {
      get: (key: string, def?: unknown) =>
        ({
          'redis.host': 'localhost',
          'redis.port': 6379,
          'redis.db': 0,
          'redis.keyPrefix': `${PREFIX}`,
        })[key] ?? def,
    };
    redis = new RedisService(config as never);
    await redis.onModuleInit();

    auth = buildAuth(redis);
    users = new UsersService(prisma as never, redis as never);
    wallet = buildWallet();
  });

  afterAll(async () => {
    await redis.onModuleDestroy().catch(() => {});
    await prisma.transaction.deleteMany({ where: { wallet: { user: { username: { startsWith: PREFIX } } } } });
    await prisma.wallet.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('previously cached /auth/me returns the current balance after a credit', async () => {
    const user = await makeUser(100);

    const first = await auth.getMe(user.id);
    expect(first.creditBalance).toBe(100);
    // Prove the payload is actually cached — the regression only matters on hits.
    expect(await redis.get(`auth:me:${user.id}`)).toBeTruthy();

    await wallet.credit(user.id, 50, {
      type: TransactionType.EARN_ADMIN_GRANT,
      description: 'itest credit',
    });

    const me = await auth.getMe(user.id);
    expect(me.creditBalance).toBe(150);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance).toBe(150);
  });

  it('previously cached /auth/me returns the current balance after a debit', async () => {
    const user = await makeUser(200);

    await auth.getMe(user.id); // populate cache
    expect(await redis.get(`auth:me:${user.id}`)).toBeTruthy();

    await wallet.debit(user.id, 75, {
      type: TransactionType.SPEND_ADMIN_DEDUCT,
      description: 'itest debit',
    });

    const me = await auth.getMe(user.id);
    expect(me.creditBalance).toBe(125);
  });

  it('a getMe racing a committed credit returns a consistent pre- or post-commit balance', async () => {
    const user = await makeUser(100);
    await auth.getMe(user.id); // warm cache

    for (let i = 0; i < 8; i++) {
      const before = (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance;
      const [me] = await Promise.all([
        auth.getMe(user.id),
        wallet.credit(user.id, 10, {
          type: TransactionType.EARN_ADMIN_GRANT,
          description: 'itest racing credit',
        }),
      ]);
      // The fresh wallet read is a single statement: the response must be
      // exactly the pre-commit or post-commit balance — never torn, stale
      // beyond the commit, or corrupted.
      expect([before, before + 10]).toContain(me.creditBalance);
    }
  });

  it('cache read/write failure cannot break settlement or reads', async () => {
    const brokenRedis = {
      getJson: jest.fn().mockRejectedValue(new Error('redis down')),
      setJson: jest.fn().mockRejectedValue(new Error('redis down')),
      del: jest.fn().mockRejectedValue(new Error('redis down')),
      invalidateUserCaches: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const offlineAuth = buildAuth(brokenRedis as never);
    const offlineUsers = new UsersService(prisma as never, brokenRedis as never);
    const user = await makeUser(40);

    // Settlement never depends on Redis — it must commit normally.
    await wallet.credit(user.id, 60, {
      type: TransactionType.EARN_ADMIN_GRANT,
      description: 'itest credit during redis outage',
    });

    // Reads degrade to fresh DB queries and still return the truth.
    const me = await offlineAuth.getMe(user.id);
    expect(me.creditBalance).toBe(100);
    const profile = await offlineUsers.getMe(user.id);
    expect(profile.creditBalance).toBe(100);
  });

  it('previously cached users/me profile returns the current balance after a credit', async () => {
    const user = await makeUser(80);

    const first = await users.getMe(user.id);
    expect(first.creditBalance).toBe(80);
    expect(await redis.get(`user:profile:${user.id}`)).toBeTruthy();

    await wallet.credit(user.id, 20, {
      type: TransactionType.EARN_ADMIN_GRANT,
      description: 'itest profile credit',
    });

    const profile = await users.getMe(user.id);
    expect(profile.creditBalance).toBe(100);
  });
});
