/**
 * Integration tests for deposit completion atomicity against a REAL
 * isolated PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Covers:
 *  - two different deposits completing concurrently on one wallet
 *  - duplicate concurrent completion of the same deposit
 *  - completion racing an unrelated credit and an unrelated debit
 *  - full rollback when the ledger write fails
 *  - full rollback when the required notification write fails
 * Asserts persisted state: wallet balance, User.creditBalance mirror,
 * ledger rows, deposit status, notification rows.
 *
 * Post-commit effects (socket events, VP award, referral milestones) are
 * intentionally outside the transaction and are NOT asserted here.
 */
import {
  PrismaClient, DepositMethod, DepositStatus, TransactionType, NotificationType,
} from '@prisma/client';
import { WalletService } from './wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `wdep_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Deposit completion — real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let seq = 0;

  const makeWallet = (client: PrismaClient) =>
    new WalletService(
      client as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
    );

  const makeUser = async (withCredits = 0) => {
    const tag = `${PREFIX}${seq++}`;
    const user = await prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        wallet: { create: { balance: withCredits } },
        creditBalance: withCredits,
      },
    });
    return user;
  };

  const makeDeposit = (userId: string, creditsToAward: number) =>
    prisma.deposit.create({
      data: {
        userId,
        method: DepositMethod.PAYPAL,
        amountFiat: creditsToAward / 100,
        currency: 'USD',
        creditsToAward,
      },
    });

  const state = async (userId: string, depositIds: string[]) => ({
    walletRow: await prisma.wallet.findUniqueOrThrow({ where: { userId } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    deposits: await prisma.deposit.findMany({ where: { id: { in: depositIds } } }),
    ledger: await prisma.transaction.findMany({
      where: { referenceId: { in: depositIds }, type: TransactionType.DEPOSIT_PAYPAL },
      orderBy: { createdAt: 'asc' },
    }),
    notifications: await prisma.notification.findMany({
      where: { userId, type: NotificationType.CREDIT_EARNED },
    }),
  });

  /** Wraps a client so `model.create` matching `match` rejects inside any tx. */
  const sabotage = (
    client: PrismaClient,
    model: 'transaction' | 'notification',
    match: (data: Record<string, unknown>) => boolean = () => true,
  ): PrismaClient => {
    const wrapTx = (tx: never) =>
      new Proxy(tx as Record<string, unknown>, {
        get(t, p) {
          if (p === model) {
            const delegate = t[p as string] as Record<string, unknown>;
            return new Proxy(delegate, {
              get(d, m) {
                const v = d[m as string];
                if (m === 'create') {
                  return (args: { data: Record<string, unknown> }) =>
                    match(args.data)
                      ? Promise.reject(new Error(`forced ${model} create failure`))
                      : (v as (a: unknown) => unknown)(args);
                }
                return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(d) : v;
              },
            });
          }
          const v = t[p as string];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      }) as never;
    return new Proxy(client, {
      get(t, p) {
        if (p === '$transaction' || p === 'withTransaction') {
          return (cb: (tx: never) => unknown) =>
            (t as never as { $transaction: (c: (tx: never) => unknown) => unknown })
              .$transaction((tx) => cb(wrapTx(tx)));
        }
        const v = (t as never as Record<string, unknown>)[p as string];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    await prisma.$connect();
  });

  afterAll(async () => {
    const u = { user: { username: { startsWith: PREFIX } } };
    await prisma.notification.deleteMany({ where: u });
    await prisma.transaction.deleteMany({ where: { wallet: u } });
    await prisma.deposit.deleteMany({ where: u });
    await prisma.wallet.deleteMany({ where: u });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('two different deposits completing concurrently on one wallet both land', async () => {
    const user = await makeUser();
    const wallet = makeWallet(prisma);
    const d1 = await makeDeposit(user.id, 200);
    const d2 = await makeDeposit(user.id, 300);

    const results = await Promise.allSettled([
      wallet.completeDeposit(d1.id),
      wallet.completeDeposit(d2.id),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const s = await state(user.id, [d1.id, d2.id]);
    expect(s.walletRow.balance).toBe(500); // no lost update
    expect(s.user.creditBalance).toBe(500);
    expect(s.deposits.every((d) => d.status === DepositStatus.COMPLETED)).toBe(true);
    expect(s.deposits.every((d) => d.creditsAwarded === d.creditsToAward)).toBe(true);
    expect(s.ledger).toHaveLength(2);
    // Whichever deposit lands first, the ledger must form a contiguous
    // chain 0 → firstAmount → 500 — never overlapping/stale before/after.
    const afters = s.ledger.map((t) => t.balanceAfter);
    const befores = s.ledger.map((t) => t.balanceBefore);
    expect(s.ledger.map((t) => t.amount).sort((a, b) => a - b)).toEqual([200, 300]);
    expect(Math.min(...befores)).toBe(0);
    expect(Math.max(...afters)).toBe(500);
    for (const b of befores) expect(b === 0 || afters.includes(b)).toBe(true);
    expect(s.notifications).toHaveLength(2);
  });

  it('duplicate concurrent completion of the same deposit credits once', async () => {
    const user = await makeUser();
    const wallet = makeWallet(prisma);
    const d = await makeDeposit(user.id, 200);

    const results = await Promise.allSettled([
      wallet.completeDeposit(d.id),
      wallet.completeDeposit(d.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(user.id, [d.id]);
    expect(s.walletRow.balance).toBe(200);
    expect(s.user.creditBalance).toBe(200);
    expect(s.ledger).toHaveLength(1);
    expect(s.deposits[0].status).toBe(DepositStatus.COMPLETED);
    expect(s.notifications).toHaveLength(1);
  });

  it('completion racing an unrelated credit: both apply, final balance exact', async () => {
    const user = await makeUser();
    const wallet = makeWallet(prisma);
    const d = await makeDeposit(user.id, 200);

    await Promise.allSettled([
      wallet.completeDeposit(d.id),
      wallet.credit(user.id, 150, {
        type: TransactionType.EARN_ADMIN_GRANT,
        description: 'concurrent credit',
      }),
    ]);

    const s = await state(user.id, [d.id]);
    expect(s.walletRow.balance).toBe(350);
    expect(s.user.creditBalance).toBe(350);
    expect(s.deposits[0].status).toBe(DepositStatus.COMPLETED);
  });

  it('completion racing an unrelated debit: both apply, final balance exact', async () => {
    const user = await makeUser(400);
    const wallet = makeWallet(prisma);
    const d = await makeDeposit(user.id, 200);

    await Promise.allSettled([
      wallet.completeDeposit(d.id),
      wallet.debit(user.id, 100, {
        type: TransactionType.SPEND_ADMIN_DEDUCT,
        description: 'concurrent debit',
      }),
    ]);

    const s = await state(user.id, [d.id]);
    expect(s.walletRow.balance).toBe(500); // 400 + 200 − 100, regardless of order
    expect(s.user.creditBalance).toBe(500);
    expect(s.deposits[0].status).toBe(DepositStatus.COMPLETED);
  });

  it('ledger failure rolls back the deposit claim, credit, mirror, and notification', async () => {
    const user = await makeUser(50);
    const d = await makeDeposit(user.id, 200);

    const failing = sabotage(prisma, 'transaction', (x) => x.type === TransactionType.DEPOSIT_PAYPAL);
    const wallet = makeWallet(failing);

    await expect(wallet.completeDeposit(d.id)).rejects.toThrow();

    const s = await state(user.id, [d.id]);
    expect(s.deposits[0].status).toBe(DepositStatus.PENDING); // claim rolled back
    expect(s.deposits[0].completedAt).toBeNull();
    expect(s.walletRow.balance).toBe(50); // no credit persisted
    expect(s.user.creditBalance).toBe(50);
    expect(s.ledger).toHaveLength(0);
    expect(s.notifications).toHaveLength(0);
    // The rolled-back deposit is retryable, not stuck:
    await expect(makeWallet(prisma).completeDeposit(d.id)).resolves.toBeTruthy();
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance).toBe(250);
  });

  it('notification failure rolls back the deposit claim, credit, and ledger', async () => {
    const user = await makeUser(50);
    const d = await makeDeposit(user.id, 200);

    const failing = sabotage(prisma, 'notification');
    const wallet = makeWallet(failing);

    await expect(wallet.completeDeposit(d.id)).rejects.toThrow();

    const s = await state(user.id, [d.id]);
    expect(s.deposits[0].status).toBe(DepositStatus.PENDING);
    expect(s.deposits[0].completedAt).toBeNull();
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
    expect(s.ledger).toHaveLength(0);
    await expect(makeWallet(prisma).completeDeposit(d.id)).resolves.toBeTruthy();
  });
});
