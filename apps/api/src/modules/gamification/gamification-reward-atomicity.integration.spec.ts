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

  beforeAll(async () => {
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
  // One shared campaign is fine: (campaignId, userId) is unique and
  // every test uses a fresh user.
  let outcomeCampaignId: string | null = null;
  const ensureOutcomeCampaign = async (uid: string) => {
    if (outcomeCampaignId) return outcomeCampaignId;
    const c = await prisma.campaign.create({
      data: {
        userId: uid,
        title: `${PREFIX}outcome-campaign`,
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
    outcomeCampaignId = c.id;
    return c.id;
  };

  const mkVerifiedCompletion = async (uid: string, status: 'VERIFIED' | 'SUBMITTED' = 'VERIFIED') =>
    prisma.taskCompletion.create({
      data: {
        userId: uid,
        campaignId: await ensureOutcomeCampaign(uid),
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
    const boostMock = (service as any).storeService.getActiveXpBoost as jest.Mock;

    // Case 1: 2x boost active at the qualifying event, gone by recovery.
    const u1 = await mkUser();
    const c1 = await mkVerifiedCompletion(u1.id);
    boostMock.mockResolvedValue({ multiplier: 2, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u1.id, c1.id);
    });
    boostMock.mockResolvedValue(null); // boost "expired" before processing
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
    boostMock.mockResolvedValue(null);
    await prisma.$transaction(async (tx) => {
      await service.recordTaskCompletionOutcome(tx as never, u2.id, c2.id);
    });
    boostMock.mockResolvedValue({ multiplier: 2, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await service.awardTaskCompletionOutcome(u2.id, c2.id);

    const xp2 = await prisma.xpEvent.findFirstOrThrow({
      where: { userId: u2.id, source: 'task_completion', referenceId: c2.id },
    });
    expect(xp2.amount).toBe(50); // frozen "no boost" — later activation irrelevant
    expect(xp2.boostMultiplier).toBeNull();

    boostMock.mockResolvedValue(null);
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
});
