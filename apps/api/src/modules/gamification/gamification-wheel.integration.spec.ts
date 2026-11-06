/**
 * PostgreSQL-backed integration tests for idempotent wheel spins.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level:
 * unique(userId, key) on wheel_spin_attempts inside the settlement tx,
 * exactly-once charge/reward/spin-row under retries and concurrency,
 * recoverable result, and Redis independence of the idempotency path.
 */
import { PrismaClient, TransactionType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { GamificationService } from './gamification.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `wh_${Date.now().toString(36)}_`;

run('wheel spin idempotency — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: GamificationService;
  let userId: string;

  const walletStub = {
    debit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId: uid } });
      if (!wallet || wallet.balance < amount) {
        throw new BadRequestException('Insufficient balance');
      }
      const before = wallet.balance;
      await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: before - amount, lifetimeSpent: { increment: amount }, version: { increment: 1 } },
      });
      await client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount: -amount,
          balanceBefore: before,
          balanceAfter: before - amount,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
      return { balance: before - amount };
    }),
    credit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId: uid } });
      if (!wallet) throw new BadRequestException('Wallet not found');
      const before = wallet.balance;
      await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: before + amount, lifetimeEarned: { increment: amount }, version: { increment: 1 } },
      });
      await client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount,
          balanceBefore: before,
          balanceAfter: before + amount,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
      return { balance: before + amount };
    }),
  };

  const redisStore = new Map<string, string>();
  const today = () => new Date().toISOString().slice(0, 10);
  let redisDown = false;
  const redisStub = {
    get: jest.fn(async (k: string) => {
      if (redisDown) throw new Error('redis down');
      return redisStore.get(k) ?? null;
    }),
    set: jest.fn(async (k: string, v: string) => {
      if (redisDown) throw new Error('redis down');
      redisStore.set(k, v);
    }),
    del: jest.fn(async (k: string) => {
      if (redisDown) throw new Error('redis down');
      redisStore.delete(k);
    }),
  };

  const balanceOf = async () =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  const spinRows = () => prisma.wheelSpin.count({ where: { userId } });
  const attemptRows = () => prisma.wheelSpinAttempt.findMany({ where: { userId } });
  const ledgerRows = async () => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return prisma.transaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'asc' } });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new GamificationService(
      prisma as never,
      redisStub as never,
      walletStub as never,
      { createNotification: jest.fn() } as never,
      { emitToUser: jest.fn() } as never,
      { extendOrCreateActiveEffect: jest.fn() } as never,
    );
    await prisma.$connect();

    const u = await prisma.user.create({
      data: {
        email: `${PREFIX}player@itest.local`,
        username: `${PREFIX}player`,
        passwordHash: 'x',
        referralCode: `${PREFIX}player`,
        wallet: { create: { balance: 500, lifetimeEarned: 500 } },
      },
    });
    userId = u.id;
    // Free spin already consumed today → every spin here is a paid spin (20cr).
    redisStore.set(`wheel:free:${userId}`, today());
    redisStore.set(`wheel:paid:${userId}`, '0');
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // credits_5 prize
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it('retry with the same key replays the committed result — one charge, one reward, one spin row', async () => {
    const before = await balanceOf();

    const first = await service.spinWheel(userId, 'key-retry-1');
    const second = await service.spinWheel(userId, 'key-retry-1');

    expect(second).toEqual(first);
    expect(first).toMatchObject({ isFree: false, cost: 20, credits: 5 });
    // Net wallet delta: -20 spin cost +5 prize = -15, exactly once.
    expect(await balanceOf()).toBe(before - 15);
    expect(await spinRows()).toBe(1);

    const attempts = await attemptRows();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('COMMITTED');
    expect(attempts[0].result).toMatchObject({ prize: '5 Credits', credits: 5 });

    const ledger = await ledgerRows();
    const debits = ledger.filter((t) => t.type === TransactionType.SPEND_STORE_PURCHASE);
    const credits = ledger.filter((t) => t.type === TransactionType.EARN_WHEEL_SPIN);
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-20);
    expect(credits).toHaveLength(1);
    expect(credits[0].amount).toBe(5);
  });

  it('concurrent same-key spins settle exactly once', async () => {
    const before = await balanceOf();
    const spinsBefore = await spinRows();

    const [a, b] = await Promise.all([
      service.spinWheel(userId, 'key-concurrent-1'),
      service.spinWheel(userId, 'key-concurrent-1'),
    ]);

    expect(b).toEqual(a);
    expect(await spinRows()).toBe(spinsBefore + 1);
    expect(await balanceOf()).toBe(before - 15);
    expect(await attemptRows()).toHaveLength(2); // key-retry-1 + key-concurrent-1
  });

  it('a different key executes an independent spin', async () => {
    const before = await balanceOf();
    const spinsBefore = await spinRows();

    const r = await service.spinWheel(userId, 'key-other-1');
    expect(r).toMatchObject({ credits: 5, cost: 20 });
    expect(await spinRows()).toBe(spinsBefore + 1);
    expect(await balanceOf()).toBe(before - 15);
  });

  it('Redis failure after commit cannot authorize a second charge — result stays recoverable', async () => {
    const before = await balanceOf();
    const spinsBefore = await spinRows();
    const ledgerBefore = (await ledgerRows()).length;

    const first = await service.spinWheel(userId, 'key-redis-down-1');
    expect(first).toMatchObject({ credits: 5 });

    // Every Redis call fails now — replay must come from Postgres alone.
    redisDown = true;
    try {
      const second = await service.spinWheel(userId, 'key-redis-down-1');
      expect(second).toEqual(first);
    } finally {
      redisDown = false;
    }

    expect(await spinRows()).toBe(spinsBefore + 1);
    expect(await balanceOf()).toBe(before - 15);
    expect((await ledgerRows()).length).toBe(ledgerBefore + 2); // 1 debit + 1 credit only
  });

  it('insufficient balance rejects before any settlement — attempt rolls back', async () => {
    const poor = await prisma.user.create({
      data: {
        email: `${PREFIX}poor@itest.local`,
        username: `${PREFIX}poor`,
        passwordHash: 'x',
        referralCode: `${PREFIX}poor`,
        wallet: { create: { balance: 10, lifetimeEarned: 10 } },
      },
    });
    redisStore.set(`wheel:free:${poor.id}`, today());

    await expect(service.spinWheel(poor.id, 'key-poor-1')).rejects.toThrow(BadRequestException);
    expect(await prisma.wheelSpinAttempt.count({ where: { userId: poor.id } })).toBe(0);
    expect(await prisma.wheelSpin.count({ where: { userId: poor.id } })).toBe(0);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: poor.id } })).balance,
    ).toBe(10);
  });
});
