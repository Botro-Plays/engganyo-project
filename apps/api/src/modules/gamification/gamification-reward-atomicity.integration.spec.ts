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
import { PrismaClient, MissionType, AchievementCategory, TransactionType, TaskType } from '@prisma/client';
import { GamificationService } from './gamification.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `rw_${Date.now().toString(36)}_`;

run('reward atomicity — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: GamificationService;
  let referralsStub: { qualifyReferral: jest.Mock; checkMilestones: jest.Mock };
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

  // Pin the period-catalog rollout boundary far in the future so every
  // pre-existing test exercises the LEGACY path regardless of the date
  // CI runs on. Period-catalog tests opt in per-test via
  // withPeriodCatalog().
  const EFFECTIVE_ENV = 'MISSION_PERIOD_TERMS_EFFECTIVE';
  let savedEffective: string | undefined;

  // The period catalog is keyed by real UTC day and shared across the
  // suite — reset it so each period-catalog test freezes a fresh
  // catalog containing exactly the missions it created.
  const resetPeriodCatalog = async () => {
    await prisma.missionPeriodTerm.deleteMany({});
    await prisma.missionPeriodCatalog.deleteMany({});
  };

  const withPeriodCatalog = async (fn: () => Promise<void>) => {
    const prev = process.env[EFFECTIVE_ENV];
    process.env[EFFECTIVE_ENV] = '2020-01-01'; // every real date is post-boundary
    try {
      await resetPeriodCatalog();
      await fn();
    } finally {
      if (prev === undefined) delete process.env[EFFECTIVE_ENV];
      else process.env[EFFECTIVE_ENV] = prev;
    }
  };

  beforeAll(async () => {
    savedEffective = process.env[EFFECTIVE_ENV];
    process.env[EFFECTIVE_ENV] = '2999-01-01';
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    referralsStub = {
      qualifyReferral: jest.fn(async () => {}),
      checkMilestones: jest.fn(async () => {}),
    };
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
      referralsStub as never,
    );
    await prisma.$connect();
  });

  afterAll(async () => {
    if (savedEffective === undefined) delete process.env[EFFECTIVE_ENV];
    else process.env[EFFECTIVE_ENV] = savedEffective;
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

  // ─── Durable task-completion outcomes ─────────────────────

  // task_completions_single_offer requires exactly one of
  // campaign_id/challenge_id — completions need a campaign parent.
  // One shared campaign per variant is fine: (campaignId, userId) is
  // unique and every test uses a fresh user (variant allows a second
  // completion per user for period-term tests).
  const outcomeCampaignIds = new Map<string, string>();
  const ensureOutcomeCampaign = async (uid: string, variant = '') => {
    const key = variant || 'default';
    const cached = outcomeCampaignIds.get(key);
    if (cached) return cached;
    const c = await prisma.campaign.create({
      data: {
        userId: uid,
        title: `${PREFIX}outcome-campaign${variant ? `-${variant}` : ''}`,
        taskType: TaskType.GOOGLE_REVIEW,
        targetUrl: 'https://example.com/review',
        totalSlots: 1000,
        completedSlots: 0,
        pendingSlots: 0,
        creditPerTask: 10,
        totalCost: 10000,
        targetCountries: [],
        targetLanguages: [],
        status: 'ACTIVE',
      },
    });
    outcomeCampaignIds.set(key, c.id);
    return c.id;
  };

  const mkVerifiedCompletion = async (uid: string, status: 'VERIFIED' | 'SUBMITTED' = 'VERIFIED', variant = '') =>
    prisma.taskCompletion.create({
      data: {
        userId: uid,
        campaignId: await ensureOutcomeCampaign(uid, variant),
        status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        verifiedBy: status === 'VERIFIED' ? 'system' : null,
      },
    });

  it('durable outcome settles every effect exactly once; replay is a no-op', async () => {
    const u = await mkUser();
    const completion = await mkVerifiedCompletion(u.id);

    // Simulate the VERIFIED transition tx: outcome row + completion
    // commit together.
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });
    await service.awardTaskCompletionOutcome(u.id, completion.id);
    // Replay — recovery/sweeper/duplicate call must not double-settle.
    await service.awardTaskCompletionOutcome(u.id, completion.id);
    await service.processPendingTaskOutcomes();

    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });
    expect(outcome.status).toBe('DONE');
    expect(outcome.xpSettled).toBe(true);
    expect(outcome.vpSettled).toBe(true);
    expect(outcome.missionSettled).toBe(true);
    expect(outcome.achievementsSettled).toBe(true);
    expect(outcome.referralSettled).toBe(true);

    // XP 50 + VP 1 for the task completion — exactly one event each.
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
    expect(await prisma.vpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
    expect(referralsStub.qualifyReferral).toHaveBeenCalledWith(u.id);
    expect(referralsStub.checkMilestones).toHaveBeenCalledWith(u.id);
  });

  it('a failing effect stays unsettled and recovers without double-paying settled effects', async () => {
    const u = await mkUser();
    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });

    // First pass: VP award throws — other effects still settle.
    const vpSpy = jest.spyOn(service, 'awardVp').mockRejectedValueOnce(new Error('vp transient'));
    await service.awardTaskCompletionOutcome(u.id, completion.id);
    vpSpy.mockRestore();

    let outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });
    expect(outcome.status).toBe('PENDING');
    expect(outcome.vpSettled).toBe(false);
    expect(outcome.xpSettled).toBe(true);
    expect(outcome.lastError).toContain('vp');

    // XP settled exactly once even though the outcome re-ran.
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion' } })).toBe(1);

    // Recovery pass settles the remaining effect.
    await service.processPendingTaskOutcomes();
    outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });
    expect(outcome.status).toBe('DONE');
    expect(await prisma.vpEvent.count({ where: { userId: u.id, source: 'task_completion' } })).toBe(1);
    expect(await vpOf(u.id)).toBe(1);
  });

  it('refuses to process an outcome whose completion is not VERIFIED or not owned', async () => {
    const u = await mkUser();
    const other = await mkUser();
    const pendingCompletion = await mkVerifiedCompletion(u.id, 'SUBMITTED');
    await prisma.taskCompletionOutcome.create({
      data: { completionId: pendingCompletion.id, userId: u.id },
    });
    // Wrong owner recorded on the outcome row.
    const wrongOwner = await mkVerifiedCompletion(other.id);
    await prisma.taskCompletionOutcome.create({
      data: { completionId: wrongOwner.id, userId: u.id },
    });

    await service.processPendingTaskOutcomes();

    for (const c of [pendingCompletion, wrongOwner]) {
      const o = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { completionId: c.id } });
      expect(o.status).toBe('CANCELLED');
    }
    expect(await prisma.xpEvent.count({ where: { userId: { in: [u.id, other.id] }, source: 'task_completion' } })).toBe(0);
    expect(await prisma.vpEvent.count({ where: { userId: { in: [u.id, other.id] }, source: 'task_completion' } })).toBe(0);
  });

  it('mission progress dedupes on sourceId — outcome replay cannot count a task twice', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}dedupe-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 5,
        creditReward: 10,
        xpReward: 5,
        isActive: true,
      },
    });

    // Same sourceId delivered repeatedly (outcome recovery) counts once.
    await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-X' });
    await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-X' });
    await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-X' });

    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const progress = await prisma.userMissionProgress.findUniqueOrThrow({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
    });
    expect(progress.progress).toBe(1);
    expect(await prisma.missionProgressEvent.count({ where: { missionId: mission.id, sourceId: 'completion-X' } })).toBe(1);

    // A distinct completion is a distinct event — counts again.
    await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-Y' });
    const after = await prisma.userMissionProgress.findUniqueOrThrow({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
    });
    expect(after.progress).toBe(2);
  });

  it('mission payout + outbox rows commit together; replay creates no duplicates', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}outbox-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 1,
        creditReward: 40,
        xpReward: 20,
        isActive: true,
      },
    });

    const notes: any[] = [];
    const origCreate = (service as any).notificationsService.createNotification;
    (service as any).notificationsService.createNotification = jest.fn(async (...a: any[]) => {
      notes.push(a);
      return {};
    });

    try {
      await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-Z' });
      // Replay the same event — early return, no new outbox rows.
      await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'completion-Z' });
    } finally {
      (service as any).notificationsService.createNotification = origCreate;
    }

    const rows = await prisma.rewardOutboxEvent.findMany({
      where: { userId: u.id, kind: 'notification' },
    });
    const missionRows = rows.filter((r) => (r.data as any)?.missionId === mission.id);
    expect(missionRows).toHaveLength(1);
    expect(missionRows[0].status).toBe('DELIVERED');
    // Exactly one persisted notification for THIS mission — other active
    // missions may also complete for the user, so match on the payload.
    const missionNotes = notes.filter((n) => (n[4] as any)?.missionId === mission.id);
    expect(missionNotes).toHaveLength(1);
    // Socket row carries a stable event identity for client dedupe.
    const socketRow = await prisma.rewardOutboxEvent.findFirst({
      where: {
        userId: u.id,
        kind: 'socket',
        socketEvent: 'mission:completed',
        socketPayload: { path: ['missionId'], equals: mission.id },
      },
    });
    expect(socketRow?.status).toBe('DELIVERED');
  });

  it('notification delivery is exactly-once across a crash before ack', async () => {
    const u = await mkUser();
    const notes: any[] = [];
    (service as any).notificationsService.createNotification = jest.fn(async (...a: any[]) => {
      notes.push(a);
      // Simulate the REAL persistence path: the notification row is
      // written with the outbox event id as its dedupe identity.
      const dedupeKey = (a[5] as any)?.dedupeKey;
      await prisma.notification.create({
        data: {
          userId: a[0],
          type: a[1],
          title: a[2],
          body: a[3],
          data: a[4] as any,
          ...(dedupeKey ? { dedupeKey } : {}),
        },
      });
      return {};
    });

    const ev = await prisma.rewardOutboxEvent.create({
      data: { userId: u.id, kind: 'notification', notificationType: 'LEVEL_UP', title: 'T', body: 'B' },
    });

    // First flush: creates notification + marks DELIVERED.
    await service.flushRewardOutbox();
    // Simulate crash-after-notification-commit: reset the outbox row to
    // PENDING (as if the ack write never landed) and flush again.
    await prisma.rewardOutboxEvent.update({
      where: { id: ev.id },
      data: { status: 'PENDING', deliveredAt: null, processingAt: null },
    });
    await service.flushRewardOutbox();

    // The retry found the existing dedupeKey row — no second notification.
    expect(notes).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: u.id, dedupeKey: ev.id } })).toBe(1);
    expect((await prisma.rewardOutboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('DELIVERED');
  });

  // ─── Outcome claim/lease + mission-date binding ──────────

  it('concurrent processors claim the outcome once — no duplicate effects', async () => {
    const u = await mkUser();
    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });
    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });

    // Slow the XP effect so all three callers overlap the claim window.
    const origAwardXp = service.awardXp.bind(service);
    const spy = jest.spyOn(service, 'awardXp').mockImplementation(async (...args: any[]) => {
      await new Promise((r) => setTimeout(r, 150));
      return (origAwardXp as any)(...args);
    });
    try {
      await Promise.all([
        service.processTaskCompletionOutcome(outcome.id),
        service.processTaskCompletionOutcome(outcome.id),
        service.processTaskCompletionOutcome(outcome.id),
      ]);
    } finally {
      spy.mockRestore();
    }

    const after = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(after.status).toBe('DONE');
    expect(after.claimToken).toBeNull();
    expect(after.claimedAt).toBeNull();
    // Exactly one pass ran: one claim → attempts == 1.
    expect(after.attempts).toBe(1);
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
    expect(await prisma.vpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
    // Mission events: one per active COMPLETE_N_TASKS mission, none doubled.
    const missionEvents = await prisma.missionProgressEvent.findMany({
      where: { sourceId: completion.id },
    });
    const activeMissions = await prisma.dailyMission.count({
      where: { type: MissionType.COMPLETE_N_TASKS, isActive: true },
    });
    expect(missionEvents.length).toBe(activeMissions);
    expect(new Set(missionEvents.map((e) => e.missionId)).size).toBe(missionEvents.length);
  });

  it('a held claim blocks other workers; an expired claim is recovered', async () => {
    const u = await mkUser();
    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });
    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });

    // Simulate a live worker holding the lease.
    await prisma.taskCompletionOutcome.update({
      where: { id: outcome.id },
      data: { claimedAt: new Date(), claimToken: 'worker-A' },
    });
    await service.processTaskCompletionOutcome(outcome.id);
    await service.processPendingTaskOutcomes();

    let row = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(row.status).toBe('PENDING');
    expect(row.claimToken).toBe('worker-A');
    expect(row.attempts).toBe(0); // blocked workers never claimed
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion' } })).toBe(0);

    // Worker A "crashes": lease goes stale → sweeper re-claims and finishes.
    await prisma.taskCompletionOutcome.update({
      where: { id: outcome.id },
      data: { claimedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    await service.processPendingTaskOutcomes();

    row = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(row.status).toBe('DONE');
    expect(row.claimToken).toBeNull();
    expect(row.attempts).toBe(1);
    expect(await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
    expect(await prisma.vpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } })).toBe(1);
  });

  it('mission progress binds to the VERIFIED date — recovery after midnight cannot advance today', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}datebind-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 1,
        creditReward: 10,
        xpReward: 5,
        isActive: true,
      },
    });

    // Completion verified yesterday 23:30 UTC; processed today.
    const verifiedAt = new Date();
    verifiedAt.setUTCDate(verifiedAt.getUTCDate() - 1);
    verifiedAt.setUTCHours(23, 30, 0, 0);
    const campaignId = await ensureOutcomeCampaign(u.id);
    const completion = await prisma.taskCompletion.create({
      data: {
        userId: u.id,
        campaignId,
        status: 'VERIFIED',
        verifiedAt,
        verifiedBy: 'system',
      },
    });
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });
    await service.awardTaskCompletionOutcome(u.id, completion.id);

    const yesterday = new Date(verifiedAt);
    yesterday.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const ev = await prisma.missionProgressEvent.findFirstOrThrow({
      where: { missionId: mission.id, sourceId: completion.id },
    });
    expect(ev.date.toISOString().slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));

    const yProgress = await prisma.userMissionProgress.findUnique({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: yesterday } },
    });
    expect(yProgress?.progress).toBe(1);
    expect(yProgress?.isCompleted).toBe(true);

    // No progress was written against the processing (today) period.
    const tProgress = await prisma.userMissionProgress.findUnique({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
    });
    expect(tProgress).toBeNull();
  });

  it('concurrent duplicate mission-event delivery counts once (conflict-safe path)', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}dupcon-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 5,
        creditReward: 10,
        xpReward: 5,
        isActive: true,
      },
    });

    // Same sourceId delivered concurrently — ON CONFLICT DO NOTHING
    // keeps the tx valid and exactly one delivery counts.
    await Promise.all([
      service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'dup-concurrent-1' }),
      service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'dup-concurrent-1' }),
      service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1, { sourceId: 'dup-concurrent-1' }),
    ]);

    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const progress = await prisma.userMissionProgress.findUniqueOrThrow({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
    });
    expect(progress.progress).toBe(1);
    expect(
      await prisma.missionProgressEvent.count({
        where: { missionId: mission.id, sourceId: 'dup-concurrent-1' },
      }),
    ).toBe(1);
  });

  it('mission terms frozen at VERIFIED: later edit/disable/new mission cannot change the reward', async () => {
    const u = await mkUser();
    const mission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}frozen-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 1,
        creditReward: 50,
        xpReward: 25,
        isActive: true,
      },
    });
    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });

    // Configuration drifts between the qualifying event and recovery:
    // original mission edited + disabled, a NEW mission appears.
    await prisma.dailyMission.update({
      where: { id: mission.id },
      data: { isActive: false, creditReward: 999, xpReward: 999 },
    });
    const lateMission = await prisma.dailyMission.create({
      data: {
        name: `${PREFIX}late-mission`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 1,
        creditReward: 77,
        xpReward: 88,
        isActive: true,
      },
    });

    await service.awardTaskCompletionOutcome(u.id, completion.id);

    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });
    expect(outcome.status).toBe('DONE');
    const snap = outcome.rewardSnapshot as { missions?: Array<{ id: string; creditReward: number; xpReward: number }> };
    expect(snap.missions?.some((m) => m.id === mission.id && m.creditReward === 50 && m.xpReward === 25)).toBe(true);
    expect(snap.missions?.some((m) => m.id === lateMission.id)).toBe(false);

    // Frozen mission still paid its recorded terms despite being disabled+edited.
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const progress = await prisma.userMissionProgress.findUniqueOrThrow({
      where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
    });
    expect(progress.isCompleted).toBe(true);
    const payout = await prisma.transaction.findFirstOrThrow({
      where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
    });
    expect(payout.amount).toBe(50); // frozen, not the edited 999
    const missionXp = await prisma.xpEvent.findFirstOrThrow({
      where: { userId: u.id, source: 'mission_complete', referenceId: { startsWith: `${mission.id}:` } },
    });
    expect(missionXp.amount).toBe(25); // frozen, not the edited 999

    // Mission created after the qualifying event got nothing.
    expect(
      await prisma.userMissionProgress.count({ where: { userId: u.id, missionId: lateMission.id } }),
    ).toBe(0);
    expect(
      await prisma.missionProgressEvent.count({ where: { missionId: lateMission.id, sourceId: completion.id } }),
    ).toBe(0);
  });

  it('XP boost frozen at VERIFIED: expiry before recovery cannot change the award; later activation cannot add one', async () => {
    // Boost eligibility is read from user_active_effects inside the
    // VERIFIED tx — create/delete rows to move the boost across the
    // completion→recovery boundary.
    const mkBoost = (userId: string, multiplier: number, ttlMs: number) =>
      prisma.userActiveEffect.create({
        data: {
          userId,
          type: 'xp_boost',
          metadata: { multiplier, expiresAt: new Date(Date.now() + ttlMs).toISOString() },
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });

    // Case 1: 2x boost active at the qualifying event, gone by recovery.
    const u1 = await mkUser();
    const boost1 = await mkBoost(u1.id, 2, 3600_000);
    const c1 = await mkVerifiedCompletion(u1.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u1.id, c1.id);
    });
    await prisma.userActiveEffect.delete({ where: { id: boost1.id } }); // "expired" before processing
    await service.awardTaskCompletionOutcome(u1.id, c1.id);

    const xp1 = await prisma.xpEvent.findFirstOrThrow({
      where: { userId: u1.id, source: 'task_completion', referenceId: c1.id },
    });
    expect(xp1.amount).toBe(100); // 50 × frozen 2
    expect(xp1.baseAmount).toBe(50);
    expect(xp1.boostMultiplier).toBe(2);

    // Case 2: no boost at the qualifying event, 2x appears before recovery.
    const u2 = await mkUser();
    const c2 = await mkVerifiedCompletion(u2.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u2.id, c2.id);
    });
    await mkBoost(u2.id, 2, 3600_000); // "activated" after recording
    await service.awardTaskCompletionOutcome(u2.id, c2.id);

    const xp2 = await prisma.xpEvent.findFirstOrThrow({
      where: { userId: u2.id, source: 'task_completion', referenceId: c2.id },
    });
    expect(xp2.amount).toBe(50); // frozen "no boost" — later activation irrelevant
    expect(xp2.boostMultiplier).toBeNull();
  });

  it('recovery scan skips live leases before the batch limit — later claimable rows are not starved', async () => {
    const base = Date.now();
    // 50 oldest outcomes held under live leases (synthetic completionIds —
    // they are never reached because the scan excludes them).
    for (let i = 0; i < 50; i += 1) {
      await prisma.taskCompletionOutcome.create({
        data: {
          completionId: `${PREFIX}lease-held-${i}`,
          userId: `${PREFIX}lease-user-${i}`,
          status: 'PENDING',
          claimedAt: new Date(base + i),
          claimToken: `held-${i}`,
          createdAt: new Date(base + i),
        },
      });
    }
    // 5 newer claimable outcomes backed by real VERIFIED completions.
    const freeIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const u = await mkUser();
      const completion = await mkVerifiedCompletion(u.id);
      await prisma.taskCompletionOutcome.create({
        data: {
          completionId: completion.id,
          userId: u.id,
          status: 'PENDING',
          createdAt: new Date(base + 60_000 + i),
        },
      });
      freeIds.push(completion.id);
    }

    // Batch limit 50: previously the 50 leased rows would fill the batch
    // and nothing would process. The claimable-predicate scan must reach
    // the 5 recoverable rows instead.
    await service.processPendingTaskOutcomes(50);

    for (const cid of freeIds) {
      const o = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { completionId: cid } });
      expect(o.status).toBe('DONE');
    }
    const leased = await prisma.taskCompletionOutcome.findMany({
      where: { completionId: { startsWith: `${PREFIX}lease-held-` } },
    });
    expect(leased).toHaveLength(50);
    for (const o of leased) {
      expect(o.status).toBe('PENDING');
      expect(o.claimToken).toMatch(/^held-/);
      expect(o.attempts).toBe(0); // never claimed — filtered before the limit
    }
  });

  it('a paused worker resuming after lease takeover cannot overwrite the new owner\'s DONE', async () => {
    const u = await mkUser();
    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });
    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });

    // Worker A claims, then pauses inside its first effect (awardXp).
    const origAwardXp = service.awardXp.bind(service);
    let entered!: () => void;
    let release!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    let xpCalls = 0;
    const spy = jest.spyOn(service, 'awardXp').mockImplementation(async (...args: any[]) => {
      xpCalls += 1;
      if (xpCalls === 1) {
        entered();
        await gate;
      }
      return origAwardXp(...(args as Parameters<GamificationService['awardXp']>));
    });

    const workerA = service.processTaskCompletionOutcome(outcome.id);
    await enteredP; // A holds claim token A and is mid-effect

    // A's lease expires; worker B claims and completes the outcome.
    await prisma.taskCompletionOutcome.update({
      where: { id: outcome.id },
      data: { claimedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    await service.processTaskCompletionOutcome(outcome.id);
    const afterB = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(afterB.status).toBe('DONE');
    expect(afterB.claimToken).toBeNull();

    // A resumes: its awardXp dedupes against B's event, then every
    // claim-conditional write matches zero rows and it stops.
    release();
    await workerA;
    spy.mockRestore();

    const final = await prisma.taskCompletionOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(final.status).toBe('DONE');
    expect(final.claimToken).toBeNull();
    expect(
      await prisma.xpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } }),
    ).toBe(1);
    expect(
      await prisma.vpEvent.count({ where: { userId: u.id, source: 'task_completion', referenceId: completion.id } }),
    ).toBe(1);
  });

  it('boost snapshot reads authoritative DB inside VERIFIED tx — Redis failure cannot corrupt it', async () => {
    const boostMock = (service as any).storeService.getActiveXpBoost as jest.Mock;
    boostMock.mockRejectedValue(new Error('redis down')); // cache path dead

    const u = await mkUser();
    // Active 2x boost in the authoritative table, expiring after the event.
    await prisma.userActiveEffect.create({
      data: {
        userId: u.id,
        type: 'xp_boost',
        metadata: { multiplier: 2, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    // An already-expired boost must NOT be eligible.
    await prisma.userActiveEffect.create({
      data: {
        userId: u.id,
        type: 'xp_boost',
        metadata: { multiplier: 5, expiresAt: new Date(Date.now() - 3600_000).toISOString() },
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });

    const completion = await mkVerifiedCompletion(u.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u.id, completion.id);
    });

    const outcome = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: completion.id },
    });
    const snap = outcome.rewardSnapshot as { xpBoostMultiplier?: number | null };
    // Explicitly recorded from DB — not absent (no live-state fallback).
    expect(snap.xpBoostMultiplier).toBe(2);

    // Recovery pays the frozen multiplier even though Redis is still down.
    await service.awardTaskCompletionOutcome(u.id, completion.id);
    const xp = await prisma.xpEvent.findFirstOrThrow({
      where: { userId: u.id, source: 'task_completion', referenceId: completion.id },
    });
    expect(xp.amount).toBe(100);
    expect(xp.boostMultiplier).toBe(2);

    // User with only an expired boost records explicit null.
    const u2 = await mkUser();
    await prisma.userActiveEffect.create({
      data: {
        userId: u2.id,
        type: 'xp_boost',
        metadata: { multiplier: 5, expiresAt: new Date(Date.now() - 60_000).toISOString() },
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const c2 = await mkVerifiedCompletion(u2.id);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u2.id, c2.id);
    });
    const o2 = await prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { completionId: c2.id },
    });
    expect((o2.rewardSnapshot as { xpBoostMultiplier?: number | null }).xpBoostMultiplier).toBeNull();

    boostMock.mockResolvedValue(null);
  });

  it('mission period terms freeze once — completions spanning an edit pay identical terms in either processing order', () =>
    withPeriodCatalog(async () => {
    // Scenario A: sequential recovery, later completion processed FIRST.
    const runScenario = async (order: 'early-first' | 'late-first' | 'concurrent') => {
      // The catalog freezes once per UTC day — reset so this scenario's
      // mission is inside today's frozen set.
      await resetPeriodCatalog();
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}period-${order}-mission`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 2,
          creditReward: 50,
          xpReward: 25,
          isActive: true,
        },
      });

      const cEarly = await mkVerifiedCompletion(u.id, 'VERIFIED', 'a');
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, cEarly.id);
      });
      // Config edit between the two qualifying events.
      await prisma.dailyMission.update({
        where: { id: mission.id },
        data: { creditReward: 999, xpReward: 999 },
      });
      const cLate = await mkVerifiedCompletion(u.id, 'VERIFIED', 'b');
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, cLate.id);
      });

      // Exactly one period-terms row, holding the FIRST event's terms.
      const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
      const periodRows = await prisma.missionPeriodTerm.findMany({
        where: { missionId: mission.id, periodDate: today },
      });
      expect(periodRows).toHaveLength(1);
      expect(periodRows[0].creditReward).toBe(50);
      expect(periodRows[0].xpReward).toBe(25);

      if (order === 'concurrent') {
        await Promise.all([
          service.awardTaskCompletionOutcome(u.id, cEarly.id),
          service.awardTaskCompletionOutcome(u.id, cLate.id),
        ]);
      } else if (order === 'late-first') {
        await service.awardTaskCompletionOutcome(u.id, cLate.id);
        await service.awardTaskCompletionOutcome(u.id, cEarly.id);
      } else {
        await service.awardTaskCompletionOutcome(u.id, cEarly.id);
        await service.awardTaskCompletionOutcome(u.id, cLate.id);
      }

      // Both completions counted (progress 2/2) but exactly ONE payout,
      // at the period-frozen terms — never the edited 999.
      const progress = await prisma.userMissionProgress.findUniqueOrThrow({
        where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
      });
      expect(progress.progress).toBe(2);
      expect(progress.isCompleted).toBe(true);
      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(50);
      const missionXp = await prisma.xpEvent.findMany({
        where: { userId: u.id, source: 'mission_complete', referenceId: { startsWith: `${mission.id}:` } },
      });
      expect(missionXp).toHaveLength(1);
      expect(missionXp[0].amount).toBe(25);
      expect(
        await prisma.missionProgressEvent.count({
          where: { missionId: mission.id, sourceId: { in: [cEarly.id, cLate.id] } },
        }),
      ).toBe(2);
    };

    await runScenario('early-first');
    await runScenario('late-first');
    await runScenario('concurrent');
    }));

  it('display matches payout: mid-period reward edit freezes today\'s terms and schedules the change next period', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}display-edit`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 2,
          creditReward: 50,
          xpReward: 25,
          isActive: true,
        },
      });
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // First touch freezes today's catalog.
      const before = await service.getDailyMissions(u.id);
      const shownBefore = before.find((m: any) => m.id === mission.id);
      expect(shownBefore!.creditReward).toBe(50);
      expect(shownBefore!.xpReward).toBe(25);

      // Mid-period edit via the admin path.
      await service.adminUpdateMission(mission.id, { creditReward: 999, xpReward: 999 });

      // Display still shows the frozen terms — not the live edit.
      const after = await service.getDailyMissions(u.id);
      const shownAfter = after.find((m: any) => m.id === mission.id);
      expect(shownAfter!.creditReward).toBe(50);
      expect(shownAfter!.xpReward).toBe(25);

      // Settlement pays the same frozen terms.
      const c1 = await mkVerifiedCompletion(u.id, 'VERIFIED', 'a');
      const c2 = await mkVerifiedCompletion(u.id, 'VERIFIED', 'b');
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, c1.id);
      });
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, c2.id);
      });
      await service.awardTaskCompletionOutcome(u.id, c1.id);
      await service.awardTaskCompletionOutcome(u.id, c2.id);

      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(50); // never the edited 999
      const missionXp = await prisma.xpEvent.findMany({
        where: { userId: u.id, source: 'mission_complete', referenceId: { startsWith: `${mission.id}:` } },
      });
      expect(missionXp).toHaveLength(1);
      expect(missionXp[0].amount).toBe(25);

      // Next period displays and will pay the edited terms.
      const nextDay = await service.getDailyMissions(u.id, tomorrow);
      const shownNext = nextDay.find((m: any) => m.id === mission.id);
      expect(shownNext!.creditReward).toBe(999);
      expect(shownNext!.xpReward).toBe(999);
    }));

  it('mid-period disable keeps today\'s eligibility; mission retires next period', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}disable-midday`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 10,
          xpReward: 5,
          isActive: true,
        },
      });
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await service.getDailyMissions(u.id); // freeze today
      await service.adminUpdateMission(mission.id, { isActive: false });

      // Today's frozen catalog still offers it.
      const todayDisplay = await service.getDailyMissions(u.id);
      expect(todayDisplay.find((m: any) => m.id === mission.id)).toBeDefined();

      // And it still settles earned progress.
      const c = await mkVerifiedCompletion(u.id);
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, c.id);
      });
      await service.awardTaskCompletionOutcome(u.id, c.id);
      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(10);

      // Tomorrow it is gone from the catalog.
      const nextDay = await service.getDailyMissions(u.id, tomorrow);
      expect(nextDay.find((m: any) => m.id === mission.id)).toBeUndefined();
    }));

  it('mid-period type change cannot alter today\'s eligibility; new type applies next period', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}type-change`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 10,
          xpReward: 5,
          isActive: true,
        },
      });
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await service.getDailyMissions(u.id); // freeze today as COMPLETE_N_TASKS
      await service.adminUpdateMission(mission.id, { type: MissionType.EARN_N_CREDITS });

      // A task completion still counts it today under the frozen type.
      const c = await mkVerifiedCompletion(u.id);
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, c.id);
      });
      await service.awardTaskCompletionOutcome(u.id, c.id);
      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(10);

      // Display: frozen type today, edited type tomorrow.
      const todayDisplay = await service.getDailyMissions(u.id);
      expect(todayDisplay.find((m: any) => m.id === mission.id)!.type).toBe('COMPLETE_N_TASKS');
      const nextDay = await service.getDailyMissions(u.id, tomorrow);
      expect(nextDay.find((m: any) => m.id === mission.id)!.type).toBe('EARN_N_CREDITS');
    }));

  it('a mission created mid-period joins the catalog next period, not today', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      await service.getDailyMissions(u.id); // freeze today first
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const mission = await service.adminCreateMission({
        name: `${PREFIX}created-midday`,
        description: 'test',
        type: MissionType.COMPLETE_N_TASKS,
        requirement: 1,
        creditReward: 10,
        xpReward: 5,
      });

      const todayDisplay = await service.getDailyMissions(u.id);
      expect(todayDisplay.find((m: any) => m.id === mission.id)).toBeUndefined();
      const nextDay = await service.getDailyMissions(u.id, tomorrow);
      expect(nextDay.find((m: any) => m.id === mission.id)).toBeDefined();

      // A task completion today does not advance it.
      const c = await mkVerifiedCompletion(u.id);
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, c.id);
      });
      await service.awardTaskCompletionOutcome(u.id, c.id);
      const progress = await prisma.userMissionProgress.findFirst({
        where: { userId: u.id, missionId: mission.id },
      });
      expect(progress).toBeNull();
    }));

  it('deletion retires missions and preserves frozen terms — in-flight progress still settles', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Both missions exist BEFORE today's catalog freezes.
      const withProgress = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}delete-with-progress`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 10,
          xpReward: 5,
          isActive: true,
        },
      });
      const noProgress = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}delete-no-progress`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 7,
          xpReward: 3,
          isActive: true,
        },
      });
      await service.getDailyMissions(u.id); // freeze today — both inside

      // Case A: mission WITH progress → retired, not deleted.
      const cA = await mkVerifiedCompletion(u.id, 'VERIFIED', 'a');
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, cA.id);
      });
      await service.awardTaskCompletionOutcome(u.id, cA.id);
      expect(
        await prisma.userMissionProgress.count({ where: { userId: u.id, missionId: withProgress.id } }),
      ).toBe(1);

      const delA = await service.adminDeleteMission(withProgress.id);
      expect(delA.retired).toBe(true);
      const rowA = await prisma.dailyMission.findUniqueOrThrow({ where: { id: withProgress.id } });
      expect(rowA.isActive).toBe(false); // FK target preserved
      // Still displayed today (frozen catalog), gone tomorrow.
      expect((await service.getDailyMissions(u.id)).find((m: any) => m.id === withProgress.id)).toBeDefined();
      expect((await service.getDailyMissions(u.id, tomorrow)).find((m: any) => m.id === withProgress.id)).toBeUndefined();

      // Case B: mission WITHOUT progress → also retired (deletion is
      // always retirement to preserve FK targets and frozen terms),
      // and today's frozen terms still settle a completion.
      const delB = await service.adminDeleteMission(noProgress.id);
      expect(delB.retired).toBe(true);
      const rowB = await prisma.dailyMission.findUniqueOrThrow({ where: { id: noProgress.id } });
      expect(rowB.isActive).toBe(false);

      // The frozen term row survives and still pays a completion today.
      const termB = await prisma.missionPeriodTerm.findFirst({
        where: { missionId: noProgress.id, periodDate: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      });
      expect(termB).not.toBeNull();
      expect(termB!.creditReward).toBe(7);

      const cB = await mkVerifiedCompletion(u.id, 'VERIFIED', 'b');
      await prisma.$transaction(async (tx) => {
        await service.recordTaskCompletionOutcome(tx as never, u.id, cB.id);
      });
      await service.awardTaskCompletionOutcome(u.id, cB.id);
      const payoutsB = await prisma.transaction.findMany({
        where: { referenceId: noProgress.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payoutsB).toHaveLength(1);
      expect(payoutsB[0].amount).toBe(7);
      expect((await service.getDailyMissions(u.id, tomorrow)).find((m: any) => m.id === noProgress.id)).toBeUndefined();
    }));

  it('pre-boundary periods keep legacy behavior: live display, live/snapshot settlement, no period terms', async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}legacy-day`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 10,
          xpReward: 5,
          isActive: true,
        },
      });

      // Legacy display follows the live row immediately.
      await service.adminUpdateMission(mission.id, { creditReward: 42 });
      const display = await service.getDailyMissions(u.id);
      expect(display.find((m: any) => m.id === mission.id)!.creditReward).toBe(42);

      // Legacy settlement uses live config too (no opts.missions).
      await service.updateMissionProgress(u.id, MissionType.COMPLETE_N_TASKS, 1);
      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(42);

      // No period-term rows were materialized for today.
      const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
      expect(
        await prisma.missionPeriodTerm.count({ where: { periodDate: today, missionId: mission.id } }),
      ).toBe(0);
    });

  it('failed catalog initialization leaves neither marker nor partial terms; the next attempt succeeds', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}freeze-abort`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 10,
          xpReward: 5,
          isActive: true,
        },
      });
      const today = new Date(new Date().setUTCHours(0, 0, 0, 0));

      // Simulate a crash after the freeze helper ran inside a
      // transaction: the whole tx — marker AND term rows — must roll
      // back, leaving no partially built catalog behind.
      await expect(
        prisma.$transaction(async (tx) => {
          await (service as any).freezeMissionPeriodCatalogTx(tx, today);
          throw new Error('simulated crash after freeze');
        }),
      ).rejects.toThrow('simulated crash');

      expect(await prisma.missionPeriodCatalog.count({ where: { periodDate: today } })).toBe(0);
      expect(await prisma.missionPeriodTerm.count({ where: { periodDate: today } })).toBe(0);

      // The next attempt materializes the complete catalog cleanly.
      const missions = await service.getDailyMissions(u.id);
      expect(missions.length).toBeGreaterThan(0);
      expect(await prisma.missionPeriodCatalog.count({ where: { periodDate: today } })).toBe(1);
      const activeCount = await prisma.dailyMission.count({ where: { isActive: true } });
      expect(await prisma.missionPeriodTerm.count({ where: { periodDate: today } })).toBe(activeCount);
    }));

  it('concurrent first-touch readers and reward processors freeze one complete catalog and pay once', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}freeze-race`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 2,
          creditReward: 50,
          xpReward: 25,
          isActive: true,
        },
      });
      const c1 = await mkVerifiedCompletion(u.id, 'VERIFIED', 'a');
      const c2 = await mkVerifiedCompletion(u.id, 'VERIFIED', 'b');
      // Pre-create outcome rows so processors don't race the upsert.
      await prisma.taskCompletionOutcome.createMany({
        data: [
          { completionId: c1.id, userId: u.id },
          { completionId: c2.id, userId: u.id },
        ],
      });

      const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
      await Promise.all([
        ...Array.from({ length: 4 }, () => service.getDailyMissions(u.id)),
        service.awardTaskCompletionOutcome(u.id, c1.id),
        service.awardTaskCompletionOutcome(u.id, c2.id),
      ]);

      // Exactly one freeze, one complete catalog, one payout.
      expect(await prisma.missionPeriodCatalog.count({ where: { periodDate: today } })).toBe(1);
      const term = await prisma.missionPeriodTerm.findFirst({
        where: { missionId: mission.id, periodDate: today },
      });
      expect(term).not.toBeNull();
      expect(term!.creditReward).toBe(50);

      const payouts = await prisma.transaction.findMany({
        where: { referenceId: mission.id, referenceType: 'mission', type: TransactionType.EARN_MISSION_COMPLETE },
      });
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(50);
      const progress = await prisma.userMissionProgress.findUniqueOrThrow({
        where: { userId_missionId_date: { userId: u.id, missionId: mission.id, date: today } },
      });
      expect(progress.progress).toBe(2);
      expect(progress.isCompleted).toBe(true);
    }));

  it('admin mutation racing first-touch freeze keeps pre-edit terms today and schedules next period', () =>
    withPeriodCatalog(async () => {
      const u = await mkUser();
      const mission = await prisma.dailyMission.create({
        data: {
          name: `${PREFIX}freeze-admin-race`,
          description: 'test',
          type: MissionType.COMPLETE_N_TASKS,
          requirement: 1,
          creditReward: 50,
          xpReward: 25,
          isActive: true,
        },
      });
      const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      // Race the mutation against concurrent first-touch readers. The
      // admin tx freezes-then-mutates atomically, so today's terms are
      // always the pre-edit values regardless of who wins the marker.
      await Promise.all([
        service.adminUpdateMission(mission.id, { creditReward: 777, xpReward: 777 }),
        service.getDailyMissions(u.id),
        service.getDailyMissions(u.id),
      ]);

      const todayTerm = await prisma.missionPeriodTerm.findFirst({
        where: { missionId: mission.id, periodDate: today },
      });
      expect(todayTerm).not.toBeNull();
      expect(todayTerm!.creditReward).toBe(50);
      expect(todayTerm!.xpReward).toBe(25);

      const tomorrowTerm = await prisma.missionPeriodTerm.findFirst({
        where: { missionId: mission.id, periodDate: tomorrow },
      });
      expect(tomorrowTerm).not.toBeNull();
      expect(tomorrowTerm!.creditReward).toBe(777);
      expect(tomorrowTerm!.xpReward).toBe(777);
    }));
});
