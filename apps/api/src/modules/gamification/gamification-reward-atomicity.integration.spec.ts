/**
 * PostgreSQL-backed integration tests for reward atomicity.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level:
 * - updateMissionProgress pays exactly once under concurrent qualifying
 *   events (advisory-serialized progress + payout in one transaction).
 * - awardXp / awardVp serialize the user-row read-modify-write — no lost
 *   updates under concurrent awards.
 * - unlockAchievement settles row + credit + XP atomically; concurrent
 *   unlocks pay exactly once via the unique constraint.
 */
import { PrismaClient, MissionType, AchievementCategory, TransactionType } from '@prisma/client';
import { GamificationService } from './gamification.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `rw_${Date.now().toString(36)}_`;

run('reward atomicity — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: GamificationService;
  let seq = 0;

  const walletStub = {
    credit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId: uid } });
      if (!wallet) throw new Error('Wallet not found');
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
    debit: jest.fn(),
  };

  const mkUser = async (balance = 0) => {
    seq += 1;
    const tag = `${Date.now().toString(36)}_${seq}`;
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

  const xpOf = async (uid: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { xp: true, level: true } }));
  const vpOf = async (uid: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { vp: true } })).vp;
  const balanceOf = async (uid: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } })).balance;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new GamificationService(
      prisma as never,
      { get: jest.fn(async () => null), set: jest.fn(async () => {}), del: jest.fn(async () => {}) } as never,
      walletStub as never,
      { createNotification: jest.fn() } as never,
      { emitToUser: jest.fn() } as never,
      {
        getActiveXpBoost: jest.fn(async () => null),
        getActiveTaskLimitBoost: jest.fn(async () => null),
        extendOrCreateActiveEffect: jest.fn(async () => ({})),
        syncEffectCaches: jest.fn(async () => {}),
      } as never,
    );
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('concurrent mission progress pays exactly once', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 3,
        creditReward: 50,
        xpReward: 25,
        isActive: true,
      },
    });

    // 6 concurrent +1 events; requirement is 3 → exactly one payout.
    await Promise.all(
      Array.from({ length: 6 }, () => service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1)),
    );

    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(50);
    const payouts = await prisma.transaction.findMany({
      where: { walletId: w.id, type: TransactionType.EARN_MISSION_COMPLETE },
    });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(50);

    const xpEvents = await prisma.xpEvent.findMany({
      where: { userId: u.id, source: 'mission_complete', referenceId: mission.id },
    });
    expect(xpEvents).toHaveLength(1);
    expect(xpEvents[0].amount).toBe(25);

    const progress = await prisma.userMissionProgress.findUnique({
      where: {
        userId_missionId_date: {
          userId: u.id,
          missionId: mission.id,
          date: new Date(new Date().setUTCHours(0, 0, 0, 0)),
        },
      },
    });
    expect(progress?.isCompleted).toBe(true);
    expect(progress?.progress).toBeGreaterThanOrEqual(3);
  });

  it('concurrent awardXp calls do not lose updates', async () => {
    const u = await mkUser();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.awardXp(u.id, 10, 'test_xp', `ref-${i}`),
      ),
    );
    const { xp } = await xpOf(u.id);
    expect(xp).toBe(100);
    const events = await prisma.xpEvent.count({ where: { userId: u.id, source: 'test_xp' } });
    expect(events).toBe(10);
  });

  it('concurrent awardVp calls do not lose updates', async () => {
    const u = await mkUser();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.awardVp(u.id, 5, 'test_vp', `ref-${i}`),
      ),
    );
    expect(await vpOf(u.id)).toBe(50);
    const events = await prisma.vpEvent.count({ where: { userId: u.id, source: 'test_vp' } });
    expect(events).toBe(10);
  });

  it('concurrent unlockAchievement settles exactly once', async () => {
    const u = await mkUser();
    const achievement = await prisma.achievement.create({
      data: {
        name: `${PREFIX}ach`,
        slug: `${PREFIX}ach`,
        description: 'test',
        category: AchievementCategory.ENGAGEMENT,
        requirement: 1,
        creditReward: 30,
        xpReward: 15,
        isActive: true,
      },
    });

    const unlock = (service as any).unlockAchievement.bind(service);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        unlock(u.id, achievement.id, 30, 15, 'Test Achievement'),
      ),
    );

    const rows = await prisma.userAchievement.count({ where: { userId: u.id, achievementId: achievement.id } });
    expect(rows).toBe(1);
    expect(await balanceOf(u.id)).toBe(30);
    const xpEvents = await prisma.xpEvent.count({ where: { userId: u.id, source: 'achievement', referenceId: achievement.id } });
    expect(xpEvents).toBe(1);
  });
});
