/**
 * Integration tests for tip/rain idempotency against a REAL isolated
 * PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Asserts: identical retries replay the committed result with exactly
 * one debit and no duplicate financial message; conflicting key reuse
 * is rejected 409; concurrent same-key submissions settle exactly once;
 * and the rain recipient allocation is persisted and replayed verbatim.
 */
import {
  PrismaClient, TransactionType, UserRole,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { WalletService } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `cik_${Date.now().toString(36)}_`;

const created = { userIds: new Set<string>(), channelIds: new Set<string>() };

async function assertIsolatedDb(client: PrismaClient) {
  const parsed = new URL(TEST_DB!);
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);
  const named = /(^|_)test$|^test_/.test(dbName);
  const [{ current }] = await client.$queryRaw<[{ current: string }]>`
    SELECT current_database() AS current`;
  if (!loopback || !named || current !== dbName) {
    throw new Error(
      `Refusing fixture writes: TEST_DATABASE_URL must be a loopback *_test DB (host=${host}, name=${dbName}, server=${current})`,
    );
  }
}

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

const mockRedis = () => {
  const redis = mockService();
  redis.incrWithExpiry = jest.fn().mockResolvedValue(1);
  redis.ttl = jest.fn().mockResolvedValue(60);
  redis.zremrangebyscore = jest.fn().mockResolvedValue(0);
  redis.zrangebyscore = jest.fn().mockResolvedValue([]);
  redis.zadd = jest.fn().mockResolvedValue(1);
  redis.expire = jest.fn().mockResolvedValue(1);
  return redis;
};

const key = (n: number) => `test-key-${PREFIX}${n}`;

run('Chat transfer idempotency - real PostgreSQL', () => {
  jest.setTimeout(40000);

  let prisma: PrismaClient;
  let channels: ChannelsService;
  let wallet: WalletService;
  let redis: ReturnType<typeof mockRedis>;
  let seq = 0;

  const makeUser = async (balance = 0) => {
    const tag = `${PREFIX}${seq++}`;
    const user = await prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        wallet: { create: {} },
      },
    });
    created.userIds.add(user.id);
    if (balance > 0) {
      await wallet.credit(user.id, balance, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: 'fixture credit',
      });
    }
    return user;
  };

  const makeChannel = async (memberIds: string[]) => {
    const channel = await prisma.channel.create({
      data: {
        name: `${PREFIX}chan`,
        slug: `${PREFIX}chan-${seq++}`,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });
    created.channelIds.add(channel.id);
    return channel;
  };

  const balance = async (userId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  const ledgerCount = async (userId: string, type: TransactionType) =>
    prisma.transaction.count({ where: { wallet: { userId }, type } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: unknown) => Promise<unknown>,
    ) => prisma.$transaction(fn as never);
    await assertIsolatedDb(prisma);
    const notifications = mockService();
    const events = mockService();
    const gamification = mockService();
    gamification.getVipStatus = jest.fn().mockResolvedValue({ currentTier: { perks: { canTip: true } } });
    const antiAbuse = mockService();
    antiAbuse.areUsersRelated = jest.fn().mockResolvedValue(false);

    wallet = new WalletService(
      prisma as never, mockService() as never, notifications as never,
      events as never, mockService() as never, mockService() as never,
      mockService() as never, gamification as never, mockService() as never,
    );
    redis = mockRedis();
    channels = new ChannelsService(
      prisma as never, redis as never, wallet as never,
      gamification as never, antiAbuse as never,
      notifications as never, events as never, mockService() as never,
    );
  });

  afterEach(async () => {
    const users = [...created.userIds];
    const chans = [...created.channelIds];
    await prisma.chatRequestKey.deleteMany({ where: { senderId: { in: users } } });
    await prisma.channelMessage.deleteMany({ where: { channelId: { in: chans } } });
    await prisma.channelMember.deleteMany({
      where: { OR: [{ channelId: { in: chans } }, { userId: { in: users } }] },
    });
    await prisma.channel.deleteMany({ where: { id: { in: chans } } });
    await prisma.transaction.deleteMany({ where: { wallet: { userId: { in: users } } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: users } } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    created.userIds.clear();
    created.channelIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Tips ───────────────────────────────────────────────

  it('identical tip retries settle once and replay the same transactions', async () => {
    const sender = await makeUser(500);
    const recipient = await makeUser(0);

    const first = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(1));
    const second = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(1));
    const third = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(1));

    expect(second.debitTx.id).toBe(first.debitTx.id);
    expect(second.creditTx.id).toBe(first.creditTx.id);
    expect(third.debitTx.id).toBe(first.debitTx.id);

    expect(await balance(sender.id)).toBe(400);
    expect(await balance(recipient.id)).toBe(100);
    expect(await ledgerCount(sender.id, TransactionType.SPEND_TIP)).toBe(1);
    expect(await ledgerCount(recipient.id, TransactionType.EARN_TIP)).toBe(1);
  });

  it('rejects key reuse with different params (409) without moving funds', async () => {
    const sender = await makeUser(500);
    const a = await makeUser(0);
    const b = await makeUser(0);

    await channels.sendTip(sender.id, a.id, 100, undefined, undefined, key(2));

    // Same key, different amount -> conflict
    await expect(
      channels.sendTip(sender.id, a.id, 200, undefined, undefined, key(2)),
    ).rejects.toBeInstanceOf(ConflictException);
    // Same key, different recipient -> conflict
    await expect(
      channels.sendTip(sender.id, b.id, 100, undefined, undefined, key(2)),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await balance(sender.id)).toBe(400);
    expect(await balance(b.id)).toBe(0);
    expect(await ledgerCount(sender.id, TransactionType.SPEND_TIP)).toBe(1);
  });

  it('concurrent same-key tips settle exactly once', async () => {
    const sender = await makeUser(500);
    const recipient = await makeUser(0);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(3)),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    // Every fulfilled response points at the same committed transfer.
    const ids = new Set(ok.map((r) => (r as PromiseFulfilledResult<{ debitTx: { id: string } }>).value.debitTx.id));
    expect(ids.size).toBe(1);

    expect(await balance(sender.id)).toBe(400);
    expect(await balance(recipient.id)).toBe(100);
    expect(await ledgerCount(sender.id, TransactionType.SPEND_TIP)).toBe(1);
  });

  it('different keys for different tips settle independently', async () => {
    const sender = await makeUser(500);
    const recipient = await makeUser(0);

    await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(10));
    await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(11));

    expect(await balance(sender.id)).toBe(300);
    expect(await balance(recipient.id)).toBe(200);
    expect(await ledgerCount(sender.id, TransactionType.SPEND_TIP)).toBe(2);
  });

  it('a failed tip attempt leaves no key reservation - retry can proceed', async () => {
    const sender = await makeUser(90); // below the 100 tip amount
    const recipient = await makeUser(0);

    await expect(
      channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(4)),
    ).rejects.toThrow();
    // Top up past amount + 25% tip-budget floor and retry with the SAME
    // key - nothing committed, so it settles fresh.
    await wallet.credit(sender.id, 400, { type: TransactionType.EARN_TASK_COMPLETION, description: 'topup' });
    const res = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(4));

    expect(res.debitTx.id).toBeTruthy();
    expect(await balance(recipient.id)).toBe(100);
  });

  // ─── Rain ───────────────────────────────────────────────

  it('rain replay returns the persisted allocation and a single announcement', async () => {
    const sender = await makeUser(500);
    const m1 = await makeUser(0);
    const m2 = await makeUser(0);
    const m3 = await makeUser(0);
    const channel = await makeChannel([sender.id, m1.id, m2.id, m3.id]);

    const content = '/rain 90 2';
    const first = await channels.handleRainCommand(sender.id, channel.id, content, UserRole.ADMIN, key(20));
    const second = await channels.handleRainCommand(sender.id, channel.id, content, UserRole.ADMIN, key(20));

    expect(second.id).toBe(first.id);
    expect(second.content).toBe(first.content);

    // Exactly one financial message in the channel.
    const messages = await prisma.channelMessage.findMany({ where: { channelId: channel.id } });
    expect(messages.length).toBe(1);

    // Exactly one rain settled: sender debited 90 once.
    expect(await balance(sender.id)).toBe(410);
    const totalCredited = (await balance(m1.id)) + (await balance(m2.id)) + (await balance(m3.id));
    expect(totalCredited).toBe(90);

    // The persisted allocation is what the wallet rows show.
    const record = await prisma.chatRequestKey.findUniqueOrThrow({
      where: { senderId_key: { senderId: sender.id, key: key(20) } },
    });
    const stored = record.result as { recipients: Array<{ userId: string; amount: number }> };
    expect(stored.recipients.length).toBe(2);
    const creditedIds = stored.recipients.map((r) => r.userId).sort();
    for (const r of stored.recipients) {
      expect(await balance(r.userId)).toBe(r.amount);
    }
    // Replay did not pick different members.
    const memberIds = [m1.id, m2.id, m3.id].sort();
    const zeroed = memberIds.filter((id) => !creditedIds.includes(id));
    expect(zeroed.length).toBe(1);
  });

  it('rain key reuse with different params is rejected (409)', async () => {
    const sender = await makeUser(500);
    const m1 = await makeUser(0);
    const m2 = await makeUser(0);
    const m3 = await makeUser(0);
    const channel = await makeChannel([sender.id, m1.id, m2.id, m3.id]);

    await channels.handleRainCommand(sender.id, channel.id, '/rain 90 2', UserRole.ADMIN, key(21));
    await expect(
      channels.handleRainCommand(sender.id, channel.id, '/rain 45 2', UserRole.ADMIN, key(21)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await balance(sender.id)).toBe(410);
  });

  it('concurrent same-key rains settle once with one announcement', async () => {
    const sender = await makeUser(500);
    const m1 = await makeUser(0);
    const m2 = await makeUser(0);
    const m3 = await makeUser(0);
    const channel = await makeChannel([sender.id, m1.id, m2.id, m3.id]);

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        channels.handleRainCommand(sender.id, channel.id, '/rain 60 2', UserRole.ADMIN, key(22)),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);

    const msgIds = new Set(ok.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(msgIds.size).toBe(1);

    expect(await prisma.channelMessage.count({ where: { channelId: channel.id } })).toBe(1);
    expect(await balance(sender.id)).toBe(440);
    const totalCredited = (await balance(m1.id)) + (await balance(m2.id)) + (await balance(m3.id));
    expect(totalCredited).toBe(60);
    expect(await prisma.chatRequestKey.count({ where: { senderId: sender.id } })).toBe(1);
  });

  it('replayed rain does not consume the rain rate limit a second time', async () => {
    const sender = await makeUser(500);
    const m1 = await makeUser(0);
    const m2 = await makeUser(0);
    const channel = await makeChannel([sender.id, m1.id, m2.id]);

    // USER role exercises the real limiter (admins bypass it); the mocked
    // getVipStatus grants canTip so the permission check passes.
    await channels.handleRainCommand(sender.id, channel.id, '/rain 30 1', UserRole.USER, key(23));
    // Simulate the limiter having consumed its single slot.
    redis.incrWithExpiry.mockResolvedValue(2);
    redis.ttl.mockResolvedValue(299);

    // Replay still returns the committed announcement.
    const replay = await channels.handleRainCommand(sender.id, channel.id, '/rain 30 1', UserRole.USER, key(23));
    expect(replay.id).toBeTruthy();

    // A genuinely NEW rain under a new key is still rate-limited.
    await expect(
      channels.handleRainCommand(sender.id, channel.id, '/rain 30 1', UserRole.USER, key(24)),
    ).rejects.toThrow(/Rate limit/);
    redis.incrWithExpiry.mockResolvedValue(1);
  });

  it('lookupTransfer reports committed keys and stays silent otherwise', async () => {
    const sender = await makeUser(500);
    const recipient = await makeUser(0);

    expect(await channels.lookupTransfer(sender.id, key(30))).toEqual({ transfer: null });
    expect(await channels.lookupTransfer(sender.id, '')).toEqual({ transfer: null });

    const res = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(30));
    const lookup = await channels.lookupTransfer(sender.id, key(30));
    expect(lookup.transfer).not.toBeNull();
    expect(lookup.transfer!.action).toBe('tip');
    const result = lookup.transfer!.result as { debitTxId: string; creditTxId: string };
    expect(result.debitTxId).toBe(res.debitTx.id);
    expect(result.creditTxId).toBe(res.creditTx.id);

    // Sender-scoped: another user holding the same key sees nothing.
    const other = await makeUser(0);
    expect(await channels.lookupTransfer(other.id, key(30))).toEqual({ transfer: null });
  });

  it('CHAT_TRANSFER_REQUIRE_KEY rejects keyless financial transfers', async () => {
    process.env.CHAT_TRANSFER_REQUIRE_KEY = 'true';
    try {
      const sender = await makeUser(500);
      const recipient = await makeUser(0);
      const member = await makeUser(0);
      const channel = await makeChannel([sender.id, member.id]);

      await expect(
        channels.sendTip(sender.id, recipient.id, 100),
      ).rejects.toThrow(/idempotencyKey/);
      await expect(
        channels.handleRainCommand(sender.id, channel.id, '/rain 10 1', UserRole.ADMIN),
      ).rejects.toThrow(/idempotencyKey/);

      // Keyed callers keep working under the same flag.
      const res = await channels.sendTip(sender.id, recipient.id, 100, undefined, undefined, key(31));
      const debit = await prisma.transaction.findUniqueOrThrow({ where: { id: res.debitTx.id } });
      expect(debit.amount).toBe(-100);

      // Balance untouched by the rejected keyless attempts.
      const w = await prisma.wallet.findUnique({ where: { userId: sender.id } });
      expect(w!.balance).toBe(400);
    } finally {
      delete process.env.CHAT_TRANSFER_REQUIRE_KEY;
    }
  });
});
