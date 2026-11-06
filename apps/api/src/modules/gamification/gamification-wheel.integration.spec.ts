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
import { BadRequestException, ConflictException } from '@nestjs/common';
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

  let userSeq = 0;
  const mkUser = async (balance: number) => {
    userSeq += 1;
    const tag = `${Date.now().toString(36)}_${userSeq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
        wallet: { create: { balance, lifetimeEarned: balance } },
      },
    });
  };

  const balanceOf = async (uid: string = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } })).balance;

  const spinRows = (uid: string = userId) => prisma.wheelSpin.count({ where: { userId: uid } });
  const attemptRows = (uid: string = userId) => prisma.wheelSpinAttempt.findMany({ where: { userId: uid } });
  const allowanceOf = (uid: string = userId) =>
    prisma.wheelDailyAllowance.findUnique({
      where: { userId_day: { userId: uid, day: today() } },
    });
  const ledgerRows = async (uid: string = userId) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } });
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

  it('concurrent different-key spins compete for the last free spin — exactly one wins it', async () => {
    const u = await mkUser(500);

    const [a, b] = await Promise.all([
      service.spinWheel(u.id, 'free-race-a'),
      service.spinWheel(u.id, 'free-race-b'),
    ]);

    const free = [a, b].find((r) => r.isFree);
    const paid = [a, b].find((r) => !r.isFree);
    expect(free).toMatchObject({ isFree: true, cost: 0, credits: 5 });
    expect(paid).toMatchObject({ isFree: false, cost: 20, credits: 5 });

    // Allowance, spin history, wallet and ledger all agree.
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 1 });
    expect(await spinRows(u.id)).toBe(2);
    const ledger = await ledgerRows(u.id);
    expect(ledger.filter((t) => t.type === TransactionType.SPEND_STORE_PURCHASE)).toHaveLength(1);
    expect(ledger.filter((t) => t.type === TransactionType.EARN_WHEEL_SPIN)).toHaveLength(2);
    expect(await balanceOf(u.id)).toBe(500 - 20 + 10);
  });

  it('concurrent different-key spins cannot take the final paid slot twice', async () => {
    const u = await mkUser(500);
    // Free spin used, 9 of 10 paid slots consumed.
    await prisma.wheelDailyAllowance.create({
      data: { userId: u.id, day: today(), freeUsed: true, paidUsed: 9 },
    });

    const results = await Promise.allSettled([
      service.spinWheel(u.id, 'paid-race-a'),
      service.spinWheel(u.id, 'paid-race-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

    // Exactly one settlement committed; the loser's attempt row rolled back.
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 10 });
    expect(await spinRows(u.id)).toBe(1);
    expect(await attemptRows(u.id)).toHaveLength(1);
    const ledger = await ledgerRows(u.id);
    expect(ledger.filter((t) => t.type === TransactionType.SPEND_STORE_PURCHASE)).toHaveLength(1);
    expect(await balanceOf(u.id)).toBe(500 - 20 + 5);
  });

  it('a settlement failure after eligibility rolls back allowance, spin, wallet and ledger', async () => {
    const u = await mkUser(500);

    // Free-spin path: prize credit fails after the free claim inside the tx.
    walletStub.credit.mockRejectedValueOnce(new Error('credit failed'));
    await expect(service.spinWheel(u.id, 'rb-free')).rejects.toThrow('credit failed');
    expect(await allowanceOf(u.id)).toBeNull();
    expect(await spinRows(u.id)).toBe(0);
    expect(await ledgerRows(u.id)).toHaveLength(0);
    expect(await attemptRows(u.id)).toHaveLength(0);
    expect(await balanceOf(u.id)).toBe(500);

    // Same-key retry succeeds — eligibility was restored by the rollback.
    const first = await service.spinWheel(u.id, 'rb-free');
    expect(first).toMatchObject({ isFree: true, cost: 0 });

    // Paid-spin path: debit commits inside the tx, then credit fails —
    // the paid slot, debit and ledger row must all roll back.
    walletStub.credit.mockRejectedValueOnce(new Error('credit failed'));
    await expect(service.spinWheel(u.id, 'rb-paid')).rejects.toThrow('credit failed');
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 0 });
    expect(await spinRows(u.id)).toBe(1);
    expect(await ledgerRows(u.id)).toHaveLength(1); // only the free spin's +5
    expect(await balanceOf(u.id)).toBe(505);

    const second = await service.spinWheel(u.id, 'rb-paid');
    expect(second).toMatchObject({ isFree: false, cost: 20 });
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 1 });
    expect(await spinRows(u.id)).toBe(2);
    const ledger = await ledgerRows(u.id);
    expect(ledger.filter((t) => t.type === TransactionType.SPEND_STORE_PURCHASE)).toHaveLength(1);
    expect(ledger.filter((t) => t.type === TransactionType.EARN_WHEEL_SPIN)).toHaveLength(2);
    expect(await balanceOf(u.id)).toBe(505 - 20 + 5);
  });

  it('rollout day: allowance seeds from wheel_spins history with the legacy Redis floor', async () => {
    const u = await mkUser(500);
    const dayStart = new Date(`${today()}T00:00:00.000Z`);
    // Spins recorded before this deploy — rows exist, no allowance row yet.
    await prisma.wheelSpin.create({
      data: { userId: u.id, result: 'credits_5', isFree: true, cost: 0, createdAt: dayStart },
    });
    await prisma.wheelSpin.create({
      data: { userId: u.id, result: 'credits_5', isFree: false, cost: 20, createdAt: new Date(dayStart.getTime() + 3600e3) },
    });
    await prisma.wheelSpin.create({
      data: { userId: u.id, result: 'credits_5', isFree: false, cost: 20, createdAt: new Date(dayStart.getTime() + 7200e3) },
    });
    // Legacy Redis counter ran ahead of history — the floor must win.
    redisStore.set(`wheel:paid:${u.id}`, '7');

    const r = await service.spinWheel(u.id, 'rollout-1');
    expect(r).toMatchObject({ isFree: false, cost: 20 });
    // freeUsed from history; paidUsed = max(2 history, 7 redis) + 1 claim.
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 8 });
  });

  it('two concurrent free-expecting spins: one wins free, the other is PRICE_CHANGED with zero settlement', async () => {
    const u = await mkUser(500);

    const results = await Promise.allSettled([
      service.spinWheel(u.id, 'fc-a', 0),
      service.spinWheel(u.id, 'fc-b', 0),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser confirmed the free price but the authoritative cost became
    // 20 — definitive rejection, NOT a silent paid charge.
    const loser = (rejected[0] as PromiseRejectedResult).reason;
    expect(loser).toBeInstanceOf(ConflictException);
    expect((loser as ConflictException).getResponse()).toMatchObject({
      code: 'PRICE_CHANGED',
      expectedCost: 0,
      actualCost: 20,
    });
    expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({
      isFree: true,
      cost: 0,
    });

    // Exactly one settlement: one free spin row, zero debits, loser's
    // attempt row rolled back, paid slot never consumed.
    expect(await spinRows(u.id)).toBe(1);
    expect(await attemptRows(u.id)).toHaveLength(1);
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 0 });
    const ledger = await ledgerRows(u.id);
    expect(ledger.filter((t) => t.type === TransactionType.SPEND_STORE_PURCHASE)).toHaveLength(0);
    expect(ledger.filter((t) => t.type === TransactionType.EARN_WHEEL_SPIN)).toHaveLength(1);
    expect(await balanceOf(u.id)).toBe(505);

    // After "refresh", an explicit paid attempt at the confirmed price works.
    const paid = await service.spinWheel(u.id, 'fc-paid', 20);
    expect(paid).toMatchObject({ isFree: false, cost: 20 });
    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 1 });
    expect(await spinRows(u.id)).toBe(2);
    expect(await balanceOf(u.id)).toBe(505 - 20 + 5);
  });

  it('no-key calls enforce the same daily allowance — 1 free + 10 paid, then rejected', async () => {
    const u = await mkUser(2000);

    for (let i = 0; i < 11; i++) {
      // eslint-disable-next-line no-await-in-loop
      await service.spinWheel(u.id);
    }

    expect(await allowanceOf(u.id)).toMatchObject({ freeUsed: true, paidUsed: 10 });
    expect(await spinRows(u.id)).toBe(11);
    expect(await attemptRows(u.id)).toHaveLength(0);

    await expect(service.spinWheel(u.id)).rejects.toThrow(BadRequestException);
    expect(await spinRows(u.id)).toBe(11);
    expect(await allowanceOf(u.id)).toMatchObject({ paidUsed: 10 });
  });
});
