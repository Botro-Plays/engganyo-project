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
      { createNotification: jest.fn(async () => ({})) } as never,
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
      where: { userId: u.id, source: 'mission_complete' },
    });
    expect(xpEvents).toHaveLength(1);
    expect(xpEvents[0].amount).toBe(25);
    // Stable per-day identity: mission.id + UTC date.
    expect(xpEvents[0].referenceId).toMatch(new RegExp(`^${mission.id}:\\d{4}-\\d{2}-\\d{2}$`));

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

  it('awardXp records the applied delta; boosted and unboosted reconcile', async () => {
    const u = await mkUser();
    await service.awardXp(u.id, 10, 'acct_test', 'acct-1');
    let ev = await prisma.xpEvent.findFirstOrThrow({ where: { userId: u.id, source: 'acct_test' } });
    expect(ev.amount).toBe(10);
    expect(ev.baseAmount).toBe(10);
    expect(ev.boostMultiplier).toBeNull();
    expect((await xpOf(u.id)).xp).toBe(10);

    // Boosted award: event.amount = applied delta, base + multiplier kept.
    const boostStore = (service as any).storeService;
    const orig = boostStore.getActiveXpBoost;
    boostStore.getActiveXpBoost = jest.fn(async () => ({ multiplier: 2 }));
    try {
      await service.awardXp(u.id, 10, 'acct_test', 'acct-2');
    } finally {
      boostStore.getActiveXpBoost = orig;
    }
    ev = await prisma.xpEvent.findFirstOrThrow({ where: { userId: u.id, source: 'acct_test', referenceId: 'acct-2' } });
    expect(ev.amount).toBe(20);
    expect(ev.baseAmount).toBe(10);
    expect(ev.boostMultiplier).toBe(2);
    expect((await xpOf(u.id)).xp).toBe(30);
  });

  it('a rolled-back award leaves no XP, no event, and no outbox rows', async () => {
    const u = await mkUser();
    // Force failure INSIDE the tx via the level-up VP award (100 XP →
    // level 2 → leveledUp). The whole award must roll back: no xp, no
    // xpEvent, no outbox rows.
    const spy = jest.spyOn(service, 'awardVp').mockRejectedValueOnce(new Error('vp boom'));
    await expect(service.awardXp(u.id, 100, 'rollback_test', 'rb-1')).rejects.toThrow('vp boom');
    spy.mockRestore();

    expect((await xpOf(u.id)).xp).toBe(0);
    expect(await prisma.xpEvent.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.rewardOutboxEvent.count({ where: { userId: u.id } })).toBe(0);
  });

  it('a retryable tx failure retries the whole award exactly once', async () => {
    const u = await mkUser();
    // P2034 inside the tx → withTransactionRetry re-runs the whole
    // callback; the rolled-back first attempt cannot double-pay.
    const spy = jest
      .spyOn(service, 'awardVp')
      .mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: 'P2034' }));
    await service.awardXp(u.id, 100, 'retry_test', 'rt-1');
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2); // failed attempt + retry
    spy.mockRestore();

    expect((await xpOf(u.id)).xp).toBe(100);
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'retry_test' } })).toBe(1);
  });

  it('flushRewardOutbox delivers committed rows once and retries failures', async () => {
    const u = await mkUser();
    const notes: any[] = [];
    const emitted: any[] = [];
    (service as any).notificationsService.createNotification = jest.fn(async (...a: any[]) => {
      notes.push(a);
      return {};
    });
    (service as any).eventsService.emitToUser = jest.fn((...a: any[]) => emitted.push(a));

    const n = await prisma.rewardOutboxEvent.create({
      data: { userId: u.id, kind: 'notification', notificationType: 'LEVEL_UP', title: 'T', body: 'B', data: { k: 1 } },
    });
    const s = await prisma.rewardOutboxEvent.create({
      data: { userId: u.id, kind: 'socket', socketEvent: 'level:up', socketPayload: { lvl: 2 } },
    });

    await service.flushRewardOutbox();
    await service.flushRewardOutbox(); // second flush must not redeliver

    expect(notes).toHaveLength(1);
    expect(notes[0][0]).toBe(u.id);
    expect(notes[0][2]).toBe('T');
    expect(emitted).toHaveLength(1);
    expect(emitted[0][1]).toBe('level:up');
    expect((await prisma.rewardOutboxEvent.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('DELIVERED');
    expect((await prisma.rewardOutboxEvent.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DELIVERED');
  });

  it('a failing outbox row retries then lands FAILED without affecting rewards', async () => {
    const u = await mkUser();
    (service as any).notificationsService.createNotification = jest.fn(async () => {
      throw new Error('notify down');
    });
    const row = await prisma.rewardOutboxEvent.create({
      data: { userId: u.id, kind: 'notification', notificationType: 'LEVEL_UP', title: 'X', body: 'Y' },
    });

    for (let i = 0; i < 5; i++) await service.flushRewardOutbox();
    const after = await prisma.rewardOutboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(5);
    expect(after.lastError).toContain('notify down');
  });

  it('duplicate source delivery pays once; concurrent distinct rewards each pay', async () => {
    const u = await mkUser();
    // Same (source, referenceId) delivered twice — sequentially and
    // concurrently — must settle exactly once.
    await Promise.all([
      service.awardXp(u.id, 10, 'dup_test', 'dup-ref'),
      service.awardXp(u.id, 10, 'dup_test', 'dup-ref'),
      service.awardVp(u.id, 4, 'dup_test', 'dup-ref'),
      service.awardVp(u.id, 4, 'dup_test', 'dup-ref'),
    ]);
    // Sequential replay after commit.
    await service.awardXp(u.id, 10, 'dup_test', 'dup-ref');
    await service.awardVp(u.id, 4, 'dup_test', 'dup-ref');

    expect((await xpOf(u.id)).xp).toBe(10);
    expect(await vpOf(u.id)).toBe(4);
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'dup_test' } })).toBe(1);
    expect(await prisma.vpEvent.count({ where: { userId: u.id, source: 'dup_test' } })).toBe(1);

    // Distinct references are distinct rewards — both pay.
    await Promise.all([
      service.awardXp(u.id, 10, 'dup_test', 'dup-ref-A'),
      service.awardXp(u.id, 10, 'dup_test', 'dup-ref-B'),
    ]);
    expect((await xpOf(u.id)).xp).toBe(30);
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'dup_test' } })).toBe(3);
  });
});
