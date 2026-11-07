/**
 * Integration tests for referral milestone balance consistency against a
 * REAL isolated PostgreSQL database, the REAL WalletService settlement
 * path, and the REAL ReferralsService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Covers the forward fix for the mirror-divergence audit:
 *  - referral awards credit wallets AND the user.creditBalance mirror
 *    through WalletService.credit(tx) — ledger rows included
 *  - the milestone flag is claimed atomically under SELECT ... FOR UPDATE
 *    and re-read inside the tx: concurrent awarders award exactly once
 *  - an award racing ordinary wallet settlements leaves exact balances
 *    and a contiguous ledger chain
 *  - a WalletContentionException retries the WHOLE referral transaction
 *    (milestone claim, eligibility re-read, both awards, ledger, mirror)
 *  - reconcileCreditBalanceMirror is safe under concurrent settlements
 */
import { PrismaClient, TransactionType } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { WalletService, WalletContentionException } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `refbal_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Referral balance consistency — real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let wallet: WalletService;
  let referrals: ReferralsService;
  let notificationsMock: Record<string, jest.Mock>;
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

  const makeReferral = (referrerId: string, refereeId: string) =>
    prisma.referral.create({ data: { referrerId, refereeId } });

  const buildServices = (walletService?: WalletService) => {
    const ws =
      walletService ??
      new WalletService(
        prisma as never, mockService() as never, mockService() as never,
        mockService() as never, mockService() as never, mockService() as never,
        mockService() as never, mockService() as never, mockService() as never,
      );
    const notifications = mockService();
    const rs = new ReferralsService(
      prisma as never,
      notifications as never, // notifications
      mockService() as never, // events
      ws as never,
    );
    return { ws, rs, notifications };
  };

  const walletState = async (userId: string) => ({
    wallet: await prisma.wallet.findUniqueOrThrow({ where: { userId } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  });

  const referralLedger = (referralId: string) =>
    prisma.transaction.findMany({
      where: { referenceId: referralId, referenceType: 'referral' },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    await prisma.$connect();
    ({ ws: wallet, rs: referrals, notifications: notificationsMock } = buildServices());
  });

  beforeEach(() => {
    notificationsMock.createNotification?.mockClear?.();
  });

  afterAll(async () => {
    const u = { user: { username: { startsWith: PREFIX } } };
    await prisma.transaction.deleteMany({ where: { wallet: u } });
    await prisma.referral.deleteMany({
      where: {
        OR: [
          { referrer: { username: { startsWith: PREFIX } } },
          { referee: { username: { startsWith: PREFIX } } },
        ],
      },
    });
    await prisma.wallet.deleteMany({ where: u });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('sign-up milestone credits both wallets, ledger, and mirror', async () => {
    const referrer = await makeUser(0);
    const referee = await makeUser(0);
    const ref = await makeReferral(referrer.id, referee.id);

    await referrals.awardSignUpBonus(referee.id);

    const r = await walletState(referrer.id);
    const e = await walletState(referee.id);
    expect(r.wallet.balance).toBe(10);
    expect(r.user.creditBalance).toBe(10); // mirror maintained
    expect(e.wallet.balance).toBe(25);
    expect(e.user.creditBalance).toBe(25);

    const ledger = await referralLedger(ref.id);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((t) => t.amount).sort((a, b) => a - b)).toEqual([10, 25]);
    expect(ledger.every((t) => t.type === TransactionType.EARN_REFERRAL_BONUS)).toBe(true);
    // Ledger chain per wallet is contiguous.
    for (const t of ledger) expect(t.balanceAfter).toBe(t.balanceBefore + t.amount);

    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } });
    expect((updated.milestones as Record<string, boolean>).sign_up).toBe(true);
    expect(updated.creditsAwarded).toBe(10);
  });

  it('is idempotent — a second award attempt pays nothing', async () => {
    const referrer = await makeUser(0);
    const referee = await makeUser(0);
    const ref = await makeReferral(referrer.id, referee.id);

    await referrals.awardSignUpBonus(referee.id);
    await referrals.awardSignUpBonus(referee.id);

    expect((await walletState(referrer.id)).wallet.balance).toBe(10);
    expect((await walletState(referee.id)).wallet.balance).toBe(25);
    expect(await referralLedger(ref.id)).toHaveLength(2);
    // Only the first (committed) call notifies — the repeat is a no-op.
    expect(notificationsMock.createNotification).toHaveBeenCalledTimes(2);
  });

  it('concurrent awarders for the same milestone pay exactly once', async () => {
    const referrer = await makeUser(0);
    const referee = await makeUser(0);
    const ref = await makeReferral(referrer.id, referee.id);

    await Promise.all([
      referrals.awardSignUpBonus(referee.id),
      referrals.awardSignUpBonus(referee.id),
      referrals.awardSignUpBonus(referee.id),
    ]);

    expect((await walletState(referrer.id)).wallet.balance).toBe(10);
    expect((await walletState(referee.id)).wallet.balance).toBe(25);
    expect(await referralLedger(ref.id)).toHaveLength(2);
    expect((await walletState(referrer.id)).user.creditBalance).toBe(10);
    expect((await walletState(referee.id)).user.creditBalance).toBe(25);
    // Exactly one committed award → exactly one notification pair
    // (referrer + referee). Concurrent losers emit nothing.
    expect(notificationsMock.createNotification).toHaveBeenCalledTimes(2);
  });

  it('concurrent qualifyReferral calls award first_task exactly once', async () => {
    const referrer = await makeUser(0);
    const referee = await makeUser(0);
    const ref = await makeReferral(referrer.id, referee.id);

    await Promise.all([
      referrals.qualifyReferral(referee.id),
      referrals.qualifyReferral(referee.id),
      referrals.qualifyReferral(referee.id),
    ]);

    // first_task: referrer +25, referee +0
    expect((await walletState(referrer.id)).wallet.balance).toBe(25);
    expect((await walletState(referee.id)).wallet.balance).toBe(0);
    const ledger = await referralLedger(ref.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(25);
    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } });
    expect((updated.milestones as Record<string, boolean>).first_task).toBe(true);
    // One committed first_task award → one notification pair only.
    expect(notificationsMock.createNotification).toHaveBeenCalledTimes(2);
  });

  it('award racing ordinary settlements leaves exact balances and chain', async () => {
    const referrer = await makeUser(100);
    const referee = await makeUser(500);
    await makeReferral(referrer.id, referee.id);

    await Promise.allSettled([
      referrals.awardSignUpBonus(referee.id),
      wallet.credit(referee.id, 300, {
        type: TransactionType.EARN_ADMIN_GRANT,
        description: 'racing credit',
      }),
      wallet.debit(referrer.id, 5, {
        type: TransactionType.SPEND_ADMIN_DEDUCT,
        description: 'racing debit',
      }),
    ]);

    const e = await walletState(referee.id);
    expect(e.wallet.balance).toBe(825); // 500 + 25 referral + 300 credit
    expect(e.user.creditBalance).toBe(825);
    const r = await walletState(referrer.id);
    // referrer: 100 + 10 referral − 5 debit = 105
    expect(r.wallet.balance).toBe(105);
    expect(r.user.creditBalance).toBe(105);

    // Referee ledger: referral row's before/after must chain with the
    // racing credit's row (contiguous, no overlap).
    const ledger = await prisma.transaction.findMany({
      where: { walletId: e.wallet.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(2);
    const sorted = [...ledger].sort((a, b) => a.balanceBefore - b.balanceBefore);
    expect(sorted[0].balanceBefore).toBe(500);
    expect(sorted[sorted.length - 1].balanceAfter).toBe(825);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].balanceBefore).toBe(sorted[i - 1].balanceAfter);
    }
  });

  it('WalletContentionException retries the whole referral transaction', async () => {
    const referrer = await makeUser(0);
    const referee = await makeUser(0);
    const ref = await makeReferral(referrer.id, referee.id);

    // Wrap the real WalletService so the FIRST credit call inside the
    // referral tx throws WalletContentionException — forcing the whole
    // award tx (milestone claim + re-read + both awards) to restart.
    const { ws: realWallet } = buildServices();
    let threw = false;
    const flakyWallet = new Proxy(realWallet, {
      get(target, prop, recv) {
        if (prop === 'credit') {
          return async (...args: unknown[]) => {
            if (!threw) {
              threw = true;
              throw new WalletContentionException();
            }
            return (target.credit as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const { rs: flakyReferrals } = buildServices(flakyWallet as WalletService);

    await flakyReferrals.awardSignUpBonus(referee.id);

    expect(threw).toBe(true);
    const r = await walletState(referrer.id);
    const e = await walletState(referee.id);
    expect(r.wallet.balance).toBe(10);
    expect(r.user.creditBalance).toBe(10);
    expect(e.wallet.balance).toBe(25);
    expect(e.user.creditBalance).toBe(25);
    // Exactly one award despite the retry: 2 ledger rows, milestone set.
    expect(await referralLedger(ref.id)).toHaveLength(2);
    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: ref.id } });
    expect((updated.milestones as Record<string, boolean>).sign_up).toBe(true);
  });

  it('reconcileCreditBalanceMirror cannot leave the mirror stale under settlement races', async () => {
    const user = await makeUser(200);
    // Seed mirror drift the way the old referral path produced it.
    await prisma.user.update({ where: { id: user.id }, data: { creditBalance: 140 } });

    for (let i = 0; i < 6; i++) {
      await Promise.allSettled([
        wallet.reconcileCreditBalanceMirror(user.id),
        wallet.credit(user.id, 10, {
          type: TransactionType.EARN_ADMIN_GRANT,
          description: `race credit ${i}`,
        }),
        i % 2 === 0
          ? wallet.debit(user.id, 5, {
              type: TransactionType.SPEND_ADMIN_DEDUCT,
              description: `race debit ${i}`,
            })
          : Promise.resolve(),
      ]);
      const s = await walletState(user.id);
      // After every round the mirror must equal the ledger-backed balance.
      expect(s.user.creditBalance).toBe(s.wallet.balance);
    }

    const s = await walletState(user.id);
    expect(s.wallet.balance).toBe(s.user.creditBalance);
    expect(s.wallet.balance).toBeGreaterThan(200);
  });
});
