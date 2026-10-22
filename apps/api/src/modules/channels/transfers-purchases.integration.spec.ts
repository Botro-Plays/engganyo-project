/**
 * Integration tests for tip / rain / store-purchase atomicity against a
 * REAL isolated PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Asserts: sender debit + recipient credit (+ message link for tips),
 * rain distribution, and purchase + inventory + debit for the store all
 * commit or roll back as ONE transaction — exact persisted balances,
 * ledger rows, and balance mirrors. Redis tip-window accounting and
 * notifications/events are non-transactional post-commit effects and are
 * not asserted here.
 */
import {
  PrismaClient, TransactionType, UserRole, StoreCategory,
} from '@prisma/client';
import { ChannelsService } from './channels.service';
import { StoreService } from '../store/store.service';
import { WalletService } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `xfer_${Date.now().toString(36)}_`;

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

run('Transfers & purchases — real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let channels: ChannelsService;
  let store: StoreService;
  let wallet: WalletService;
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
    if (balance > 0) {
      await wallet.credit(user.id, balance, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: 'fixture credit',
      });
    }
    return user;
  };

  const makeChannel = async (memberIds: string[]) =>
    prisma.channel.create({
      data: {
        name: `${PREFIX}chan`,
        slug: `${PREFIX}chan-${seq++}`,
        members: {
          create: memberIds.map((userId) => ({ userId })),
        },
      },
    });

  const balances = async (userId: string) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { wallet: w.balance, mirror: u.creditBalance };
  };

  const ledgerRows = (userId: string) =>
    prisma.transaction.findMany({
      where: { wallet: { userId } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    // PrismaService.withTransaction is just $transaction — attach the same
    // surface so services built on the raw client behave identically.
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: unknown) => Promise<unknown>,
    ) => prisma.$transaction(fn as never);
    const notifications = mockService();
    const events = mockService();
    const gamification = mockService();
    const antiAbuse = mockService();
    antiAbuse.areUsersRelated = jest.fn().mockResolvedValue(false);

    wallet = new WalletService(
      prisma as never, mockService() as never, notifications as never,
      events as never, mockService() as never, mockService() as never,
      mockService() as never, gamification as never, mockService() as never,
    );
    channels = new ChannelsService(
      prisma as never, mockRedis() as never, wallet as never,
      gamification as never, antiAbuse as never,
      notifications as never, events as never,
    );
    store = new StoreService(
      prisma as never, mockRedis() as never, wallet as never,
      notifications as never, events as never,
    );
  });

  afterEach(async () => {
    await prisma.storePurchase.deleteMany({});
    await prisma.userInventory.deleteMany({});
    await prisma.storeItem.deleteMany({});
    await prisma.channelMessage.deleteMany({});
    await prisma.channelMember.deleteMany({});
    await prisma.channel.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(() => prisma.$disconnect());

  it('tip moves credits atomically: debit + credit + message link in one tx', async () => {
    const sender = await makeUser(1000);
    const recipient = await makeUser(0);
    const channel = await makeChannel([sender.id, recipient.id]);
    const message = await prisma.channelMessage.create({
      data: { channelId: channel.id, userId: recipient.id, content: 'nice post' },
    });

    const { debitTx, creditTx } = await channels.sendTip(
      sender.id, recipient.id, 100, message.id, UserRole.ADMIN,
    );

    expect((await balances(sender.id)).wallet).toBe(900);
    expect((await balances(recipient.id)).wallet).toBe(100);
    expect((await balances(sender.id)).mirror).toBe(900);
    expect((await balances(recipient.id)).mirror).toBe(100);

    const rows = await ledgerRows(sender.id);
    const spend = rows.find((r) => r.id === debitTx.id);
    expect(spend?.type).toBe(TransactionType.SPEND_TIP);
    expect(spend?.amount).toBe(-100);
    expect(spend?.balanceAfter).toBe(900);

    const recipRows = await ledgerRows(recipient.id);
    const earn = recipRows.find((r) => r.id === creditTx.id);
    expect(earn?.type).toBe(TransactionType.EARN_TIP);
    expect(earn?.amount).toBe(100);

    const linked = await prisma.channelMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(linked.tipTransactionId).toBe(debitTx.id);
  });

  it('tip rolls back fully when the message link fails (no orphan debit)', async () => {
    const sender = await makeUser(1000);
    const recipient = await makeUser(0);

    await expect(
      channels.sendTip(sender.id, recipient.id, 100, 'nonexistent-message-id', UserRole.ADMIN),
    ).rejects.toThrow();

    expect((await balances(sender.id)).wallet).toBe(1000);
    expect((await balances(sender.id)).mirror).toBe(1000);
    expect((await balances(recipient.id)).wallet).toBe(0);
    // Only the fixture credit exists — no tip ledger rows on either side.
    expect(await ledgerRows(sender.id)).toHaveLength(1);
    expect(await ledgerRows(recipient.id)).toHaveLength(0);
  });

  it('two concurrent tips from one sender conserve credits exactly', async () => {
    const sender = await makeUser(1000);
    const r1 = await makeUser(0);
    const r2 = await makeUser(0);

    const results = await Promise.allSettled([
      channels.sendTip(sender.id, r1.id, 50, undefined, UserRole.ADMIN),
      channels.sendTip(sender.id, r2.id, 50, undefined, UserRole.ADMIN),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    const senderBal = (await balances(sender.id)).wallet;
    const got1 = (await balances(r1.id)).wallet;
    const got2 = (await balances(r2.id)).wallet;

    // Conservation: whatever tipped out arrived somewhere; never negative.
    expect(senderBal).toBe(1000 - (got1 + got2));
    expect(senderBal).toBeGreaterThanOrEqual(0);
    expect(got1 + got2).toBe(succeeded.length * 50);
    expect(senderBal).toBe((await balances(sender.id)).mirror);
  });

  it('rain distributes atomically across all recipients', async () => {
    const sender = await makeUser(1000);
    const recipients = await Promise.all([makeUser(0), makeUser(0), makeUser(0)]);
    const channel = await makeChannel([sender.id, ...recipients.map((r) => r.id)]);

    await channels.handleRainCommand(sender.id, channel.id, '/rain 100 3', UserRole.ADMIN);

    const senderBal = (await balances(sender.id)).wallet;
    expect(senderBal).toBe(900);

    const got = await Promise.all(recipients.map((r) => balances(r.id)));
    const totalReceived = got.reduce((s, b) => s + b.wallet, 0);
    // 100 split 3 ways = 33/33/34 — every credit landed, sum conserved.
    expect(totalReceived).toBe(100);
    for (const b of got) {
      expect([33, 34]).toContain(b.wallet);
      expect(b.wallet).toBe(b.mirror);
    }
  });

  it('rain rolls back entirely when one recipient cannot be credited', async () => {
    const sender = await makeUser(1000);
    const ok1 = await makeUser(0);
    const broken = await makeUser(0);
    const ok2 = await makeUser(0);
    // Delete a recipient's wallet — its in-tx credit must fail.
    await prisma.wallet.delete({ where: { userId: broken.id } });
    const channel = await makeChannel([sender.id, ok1.id, broken.id, ok2.id]);

    await expect(
      channels.handleRainCommand(sender.id, channel.id, '/rain 90 3', UserRole.ADMIN),
    ).rejects.toThrow();

    // Sender keeps everything — no partial rain survived.
    expect((await balances(sender.id)).wallet).toBe(1000);
    expect((await balances(ok1.id)).wallet).toBe(0);
    expect((await balances(ok2.id)).wallet).toBe(0);
    // Sender ledger: fixture credit only — zero rain debits.
    expect(await ledgerRows(sender.id)).toHaveLength(1);
    expect(await ledgerRows(ok1.id)).toHaveLength(0);
  });

  it('store purchase commits debit + purchase + inventory atomically', async () => {
    const buyer = await makeUser(500);
    const item = await prisma.storeItem.create({
      data: {
        name: `${PREFIX}boost`,
        category: StoreCategory.BOOST,
        creditCost: 100,
        metadata: {},
      },
    });

    const result = await store.purchaseItem(buyer.id, item.id, 2);

    expect((await balances(buyer.id)).wallet).toBe(300);
    expect((await balances(buyer.id)).mirror).toBe(300);

    const inv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: buyer.id, itemId: item.id },
    });
    expect(inv.quantity).toBe(2);

    // Purchase links to the real ledger row created in the same tx.
    const spend = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.purchase.transactionId },
    });
    expect(spend.type).toBe(TransactionType.SPEND_STORE_PURCHASE);
    expect(spend.amount).toBe(-200);
    expect(spend.balanceAfter).toBe(300);
  });

  it('concurrent purchases of a limited item never oversell — loser keeps full balance and gains NO refund row', async () => {
    const b1 = await makeUser(500);
    const b2 = await makeUser(500);
    const item = await prisma.storeItem.create({
      data: {
        name: `${PREFIX}limited`,
        category: StoreCategory.CONVENIENCE,
        creditCost: 100,
        isLimited: true,
        limitedQty: 1,
        metadata: {},
      },
    });

    const results = await Promise.allSettled([
      store.purchaseItem(b1.id, item.id, 1),
      store.purchaseItem(b2.id, item.id, 1),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const purchases = await prisma.storePurchase.findMany({ where: { itemId: item.id } });
    expect(purchases).toHaveLength(1);

    const winnerId = purchases[0].userId;
    const loserId = winnerId === b1.id ? b2.id : b1.id;

    expect((await balances(winnerId)).wallet).toBe(400);
    expect((await balances(loserId)).wallet).toBe(500);
    expect((await balances(loserId)).mirror).toBe(500);

    // The loser has exactly their fixture credit — the old code would have
    // left a debit + best-effort refund pair. Single-tx design leaves none.
    const loserRows = await ledgerRows(loserId);
    expect(loserRows).toHaveLength(1);
    expect(loserRows[0].type).toBe(TransactionType.EARN_TASK_COMPLETION);
  });

  it('sold-out purchase debits nothing and writes no purchase row', async () => {
    const buyer = await makeUser(500);
    const item = await prisma.storeItem.create({
      data: {
        name: `${PREFIX}soldout`,
        category: StoreCategory.CONVENIENCE,
        creditCost: 100,
        isLimited: true,
        limitedQty: 0,
        metadata: {},
      },
    });

    await expect(store.purchaseItem(buyer.id, item.id, 1)).rejects.toThrow();

    expect((await balances(buyer.id)).wallet).toBe(500);
    expect(await prisma.storePurchase.count({ where: { itemId: item.id } })).toBe(0);
    expect(await ledgerRows(buyer.id)).toHaveLength(1);
  });
});
