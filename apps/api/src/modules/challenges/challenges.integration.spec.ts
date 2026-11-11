/**
 * PostgreSQL-backed integration tests for 1v1 challenges.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset — CI's api job runs
 * it because migrate deploy precedes npm test there.
 *
 * Covers the invariants that must hold at the database + ledger level:
 * atomic first-wins claim, self-claim/expiry rejection, private password
 * gating, atomic reserve + refunds, exactly-once settlement, fee revenue,
 * and the campaign/challenge XOR constraint on task_completions.
 */
import { PrismaClient, ChallengeStatus, CompletionStatus, TaskType, TransactionType, TrustLevel } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `ch_${Date.now().toString(36)}_`;

run('1v1 challenges — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: ChallengesService;
  let creatorId: string;
  let playerA: string;
  let playerB: string;
  let seq = 0;

  // Faithful wallet stub: real wallet + transaction rows inside the caller's tx,
  // mirroring WalletService.credit/debit semantics closely enough to verify
  // exact deltas and ledger entries.
  const walletStub = {
    debit: jest.fn(async (userId: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId } });
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
    credit: jest.fn(async (userId: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId } });
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

  const redisStore = new Map<string, number>();
  const redisStub = {
    get: jest.fn(async (k: string) => (redisStore.has(k) ? String(redisStore.get(k)) : null)),
    set: jest.fn(async (k: string, v: string) => { redisStore.set(k, Number(v)); return 'OK'; }),
    del: jest.fn(async (k: string) => { redisStore.delete(k); return 1; }),
    incr: jest.fn(async (k: string) => { const n = (redisStore.get(k) ?? 0) + 1; redisStore.set(k, n); return n; }),
    incrWithExpiry: jest.fn(async (k: string) => { const n = (redisStore.get(k) ?? 0) + 1; redisStore.set(k, n); return n; }),
    expire: jest.fn(async () => 1),
  };

  const noopEvents = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
  const noopNotify = { createNotification: jest.fn().mockResolvedValue(undefined) };
  const noopGamification = {
    awardVp: jest.fn().mockResolvedValue(undefined),
    updateMissionProgress: jest.fn().mockResolvedValue(undefined),
    checkAchievements: jest.fn().mockResolvedValue(undefined),
    awardTaskCompletionOutcome: jest.fn().mockResolvedValue(undefined),
    recordTaskCompletionOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const noopAbuse = {
    flagUser: jest.fn().mockResolvedValue(undefined),
    queueRecalculate: jest.fn().mockResolvedValue(undefined),
  };
  const socialStub = {
    isPlatformEnabled: jest.fn().mockResolvedValue(true),
    hasLinkedAccount: jest.fn().mockResolvedValue(true),
  };

  const baseDto = {
    title: `Challenge ${++seq}`,
    actionText: 'Follow the target account',
    taskType: TaskType.TIKTOK_FOLLOW,
    targetUrl: 'https://tiktok.com/@target',
    rewardCredits: 50,
    requiresProof: true,
    proofInstructions: 'Screenshot proof',
    expiresInHours: 48,
    visibility: 'PUBLIC' as const,
  };

  const balanceOf = async (userId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  const txRowsFor = (userId: string) =>
    prisma.wallet.findUniqueOrThrow({ where: { userId } }).then((w) =>
      prisma.transaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'asc' } }),
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new ChallengesService(
      prisma as never,
      redisStub as never,
      walletStub as never,
      noopGamification as never,
      noopAbuse as never,
      socialStub as never,
      noopNotify as never,
      noopEvents as never,
      { qualifyReferral: jest.fn(async () => {}), checkMilestones: jest.fn(async () => {}) } as never,
    );
    await prisma.$connect();

    const mkUser = async (suffix: string, balance: number) => {
      const u = await prisma.user.create({
        data: {
          email: `${PREFIX}${suffix}@itest.local`,
          username: `${PREFIX}${suffix}`,
          passwordHash: 'x',
          referralCode: `${PREFIX}${suffix}`,
          wallet: { create: { balance, lifetimeEarned: balance } },
          trustScore: { create: { level: TrustLevel.LOW } },
        },
      });
      return u.id;
    };
    creatorId = await mkUser('creator', 1000);
    playerA = await mkUser('playera', 200);
    playerB = await mkUser('playerb', 200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes with atomic reserve and exact ledger entries', async () => {
    const before = await balanceOf(creatorId);
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Reserve test' });
    expect(ch.status).toBe(ChallengeStatus.OPEN);
    expect(ch.reservedCredits).toBe(50);
    expect(await balanceOf(creatorId)).toBe(before - 50);

    const txs = await txRowsFor(creatorId);
    const spend = txs.find((t) => t.referenceId === ch.id && t.type === TransactionType.SPEND_CHALLENGE_CREATE);
    expect(spend).toBeTruthy();
    expect(spend!.amount).toBe(-50);
    expect(spend!.balanceAfter).toBe(before - 50);
  });

  it('rejects publication when balance is insufficient — nothing persists', async () => {
    const poor = await prisma.user.create({
      data: {
        email: `${PREFIX}poor@itest.local`, username: `${PREFIX}poor`,
        passwordHash: 'x', referralCode: `${PREFIX}poor`,
        wallet: { create: { balance: 10 } },
        trustScore: { create: { level: TrustLevel.LOW } },
      },
    });
    await expect(service.create(poor.id, 'USER', baseDto)).rejects.toThrow(BadRequestException);
    const count = await prisma.challenge.count({ where: { creatorId: poor.id } });
    expect(count).toBe(0);
    expect(await balanceOf(poor.id)).toBe(10);
  });

  it('two concurrent claimants — exactly one wins', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Race test' });
    const results = await Promise.allSettled([
      service.claim(playerA, ch.id, {} as never, '10.0.0.1'),
      service.claim(playerB, ch.id, {} as never, '10.0.0.2'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(stored.status).toBe(ChallengeStatus.CLAIMED);
    const completions = await prisma.taskCompletion.findMany({ where: { challengeId: ch.id } });
    expect(completions).toHaveLength(1);
  });

  it('blocks self-claim and claims on closed challenges', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Self test' });
    await expect(service.claim(creatorId, ch.id, {} as never, '10.0.0.3'))
      .rejects.toThrow(ForbiddenException);
    await service.claim(playerA, ch.id, {} as never, '10.0.0.4');
    await expect(service.claim(playerB, ch.id, {} as never, '10.0.0.5'))
      .rejects.toThrow(ConflictException);
  });

  it('private challenge: wrong passwords fail, lockout engages, right password claims', async () => {
    const ch = await service.create(creatorId, 'USER', {
      ...baseDto, title: 'Private race', visibility: 'PRIVATE' as const, password: 'gate-pass-1',
    });
    // Public list must not contain it
    const list = await service.listPublic(playerA, 1, 50);
    expect(list.items.map((i: any) => i.id)).not.toContain(ch.id);

    // Throttle is per challenge+IP — all five failures from one address
    for (let i = 0; i < 5; i++) {
      await expect(service.claim(playerB, ch.id, { password: 'wrong' } as never, '10.1.0.7'))
        .rejects.toThrow(ForbiddenException);
    }
    // Locked out now — even the right password is refused until the window resets
    await expect(service.claim(playerB, ch.id, { password: 'gate-pass-1' } as never, '10.1.0.7'))
      .rejects.toThrow(BadRequestException);

    // Different IP still works
    const res = await service.claim(playerA, ch.id, { password: 'gate-pass-1' } as never, '10.1.0.9');
    expect(res.challengeId).toBe(ch.id);
  });

  it('creator cancel refunds reward + fee exactly once', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Cancel refund' });
    const before = await balanceOf(creatorId);
    await service.cancel(creatorId, ch.id);
    expect(await balanceOf(creatorId)).toBe(before + 50);
    const txs = await txRowsFor(creatorId);
    const refunds = txs.filter((t) => t.referenceId === ch.id && t.type === TransactionType.REFUND_CHALLENGE_CLOSE);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(50);
    // Second cancel rejected
    await expect(service.cancel(creatorId, ch.id)).rejects.toThrow();
    expect(await balanceOf(creatorId)).toBe(before + 50);
  });

  it('approve settles reward to claimant + fee revenue, exactly once', async () => {
    // Enable a fee for this challenge via platform config snapshot path:
    // create reads live config, so set fee rate first.
    await prisma.platformConfig.upsert({
      where: { key: 'challenge_fee_rate' },
      create: { key: 'challenge_fee_rate', value: 0.1, isPublic: true },
      update: { value: 0.1 },
    });
    try {
      const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Approve settle', rewardCredits: 100 });
      expect(ch.feeAmount).toBe(10); // ceil(100 * 0.1)
      expect(ch.reservedCredits).toBe(110);

      const creatorBefore = await balanceOf(creatorId);
      const claim = await service.claim(playerA, ch.id, {} as never, '10.3.0.1');
      // Submit proof directly (bypasses HTTP layer — same row the API writes)
      await prisma.taskCompletion.update({
        where: { id: claim.completionId },
        data: { status: CompletionStatus.SUBMITTED, submittedAt: new Date(), proofUrl: 'https://proof/img.png' },
      });

      const res = await service.reviewSubmission(creatorId, ch.id, claim.completionId, { action: 'approve' });
      expect(res.creditsAwarded).toBe(100);

      // Claimant got exactly the advertised reward
      const playerTxs = await txRowsFor(playerA);
      const earn = playerTxs.filter((t) => t.referenceId === ch.id && t.type === TransactionType.EARN_TASK_COMPLETION);
      expect(earn).toHaveLength(1);
      expect(earn[0].amount).toBe(100);

      // Fee recorded once as platform revenue
      const revenue = await prisma.platformRevenue.findMany({ where: { challengeId: ch.id } });
      expect(revenue).toHaveLength(1);
      expect(revenue[0].source).toBe('CHALLENGE_FEE');
      expect(revenue[0].amount).toBe(10);

      // Creator's reserve is consumed: -110 at create, no refund
      expect(await balanceOf(creatorId)).toBe(creatorBefore);
      const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: ch.id } });
      expect(stored.status).toBe(ChallengeStatus.COMPLETED);

      // Duplicate approve → rejected, no second payout
      await expect(service.reviewSubmission(creatorId, ch.id, claim.completionId, { action: 'approve' }))
        .rejects.toThrow();
      const earnAfter = (await txRowsFor(playerA)).filter((t) => t.referenceId === ch.id && t.type === TransactionType.EARN_TASK_COMPLETION);
      expect(earnAfter).toHaveLength(1);
      expect(await prisma.platformRevenue.count({ where: { challengeId: ch.id } })).toBe(1);
    } finally {
      await prisma.platformConfig.delete({ where: { key: 'challenge_fee_rate' } }).catch(() => null);
    }
  });

  it('reject closes permanently and refunds reward + fee to creator', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Reject refund' });
    const creatorBefore = await balanceOf(creatorId);
    const claim = await service.claim(playerB, ch.id, {} as never, '10.4.0.1');
    await prisma.taskCompletion.update({
      where: { id: claim.completionId },
      data: { status: CompletionStatus.SUBMITTED, submittedAt: new Date(), proofUrl: 'https://proof/bad.png' },
    });
    const res = await service.reviewSubmission(creatorId, ch.id, claim.completionId, { action: 'reject', reason: 'Fake' });
    expect(res.action).toBe('reject');
    expect(await balanceOf(creatorId)).toBe(creatorBefore + 50);
    const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(stored.status).toBe(ChallengeStatus.COMPLETED);
    const completion = await prisma.taskCompletion.findUniqueOrThrow({ where: { id: claim.completionId } });
    expect(completion.status).toBe(CompletionStatus.REJECTED);
    expect(completion.rejectionReason).toBe('Fake');
    // Claimant got nothing
    const playerTxs = await txRowsFor(playerB);
    expect(playerTxs.filter((t) => t.referenceId === ch.id)).toHaveLength(0);
  });

  it('expiry sweep refunds OPEN challenges and abandoned claims, holds SUBMITTED', async () => {
    const open = await service.create(creatorId, 'USER', { ...baseDto, title: 'Expire open', expiresInHours: 1 });
    const claimed = await service.create(creatorId, 'USER', { ...baseDto, title: 'Expire claimed', expiresInHours: 1 });
    const submitted = await service.create(creatorId, 'USER', { ...baseDto, title: 'Expire submitted', expiresInHours: 1 });

    const c1 = await service.claim(playerA, claimed.id, {} as never, '10.5.0.1');
    const c2 = await service.claim(playerB, submitted.id, {} as never, '10.5.0.2');
    await prisma.taskCompletion.update({
      where: { id: c2.completionId },
      data: { status: CompletionStatus.SUBMITTED, submittedAt: new Date() },
    });

    // Force all three past expiry
    const past = new Date(Date.now() - 60_000);
    await prisma.challenge.updateMany({ where: { id: { in: [open.id, claimed.id, submitted.id] } }, data: { expiresAt: past } });
    await prisma.taskCompletion.updateMany({ where: { id: { in: [c1.completionId, c2.completionId] } }, data: { expiresAt: past } });

    const creatorBefore = await balanceOf(creatorId);
    await service.sweepExpired();

    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: open.id } })).status).toBe(ChallengeStatus.EXPIRED);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: claimed.id } })).status).toBe(ChallengeStatus.EXPIRED);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe(ChallengeStatus.CLAIMED);
    expect((await prisma.taskCompletion.findUniqueOrThrow({ where: { id: c1.completionId } })).status).toBe(CompletionStatus.EXPIRED);
    expect((await prisma.taskCompletion.findUniqueOrThrow({ where: { id: c2.completionId } })).status).toBe(CompletionStatus.SUBMITTED);

    // Two refunds (open + abandoned claim), submitted reserve still held
    expect(await balanceOf(creatorId)).toBe(creatorBefore + 100);
  });

  it('stale open-offer sweep candidate: claimed challenge is untouched, reserve held, no refund', async () => {
    // Simulate the race: the sweep selected this row as OPEN+expired, but a
    // claimant won the slot before the close write landed. (In practice the
    // claim's expires_at guard makes this nearly impossible — the guarded
    // close is defense-in-depth and must still write zero rows.)
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Stale sweep race' });
    const claim = await service.claim(playerA, ch.id, {} as never, '10.7.0.1');
    const creatorBefore = await balanceOf(creatorId);

    // Row now looks like the stale sweep candidate: past expiresAt, but CLAIMED
    await prisma.challenge.update({
      where: { id: ch.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Resume the stale close via the private path the sweep uses for OPEN offers
    await (service as any).closeWithoutAward(ch.id, ChallengeStatus.EXPIRED, 'Challenge offer expired', ChallengeStatus.OPEN);

    const stored = await prisma.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(stored.status).toBe(ChallengeStatus.CLAIMED); // NOT expired — claim won
    const completion = await prisma.taskCompletion.findUniqueOrThrow({ where: { id: claim.completionId } });
    expect(completion.status).toBe(CompletionStatus.ASSIGNED); // live assignment survives
    expect(await balanceOf(creatorId)).toBe(creatorBefore); // reserve still held
    const refunds = (await txRowsFor(creatorId)).filter((t) => t.referenceId === ch.id && t.type === TransactionType.REFUND_CHALLENGE_CLOSE);
    expect(refunds).toHaveLength(0);

    // And the assignment-aware sweep path still works on it once truly abandoned
    await prisma.taskCompletion.update({ where: { id: claim.completionId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await service.sweepExpired();
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe(ChallengeStatus.EXPIRED);
    expect((await prisma.taskCompletion.findUniqueOrThrow({ where: { id: claim.completionId } })).status).toBe(CompletionStatus.EXPIRED);
    expect(await balanceOf(creatorId)).toBe(creatorBefore + 50); // refunded exactly once
  });

  it('expired OPEN offer refunds exactly once across repeated sweeps', async () => {
    await service.sweepExpired(); // flush expired leftovers from earlier tests
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Sweep idempotent', expiresInHours: 1 });
    await prisma.challenge.update({ where: { id: ch.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const before = await balanceOf(creatorId);
    await service.sweepExpired();
    await service.sweepExpired(); // second sweep must be a no-op
    await service.sweepExpired();
    expect(await balanceOf(creatorId)).toBe(before + 50);
    const refunds = (await txRowsFor(creatorId)).filter((t) => t.referenceId === ch.id && t.type === TransactionType.REFUND_CHALLENGE_CLOSE);
    expect(refunds).toHaveLength(1);
  });

  it('concurrent reviews settle exactly once', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'Review race' });
    const claim = await service.claim(playerA, ch.id, {} as never, '10.8.0.1');
    await prisma.taskCompletion.update({
      where: { id: claim.completionId },
      data: { status: CompletionStatus.SUBMITTED, submittedAt: new Date(), proofUrl: 'https://proof/race.png' },
    });
    const results = await Promise.allSettled([
      service.reviewSubmission(creatorId, ch.id, claim.completionId, { action: 'approve' }),
      service.reviewSubmission(creatorId, ch.id, claim.completionId, { action: 'approve' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const earns = (await txRowsFor(playerA)).filter((t) => t.referenceId === ch.id && t.type === TransactionType.EARN_TASK_COMPLETION);
    expect(earns).toHaveLength(1);
    expect(await prisma.platformRevenue.count({ where: { challengeId: ch.id } })).toBe(0); // 0% fee
  });

  it('DB enforces: one completion per challenge, campaign XOR challenge', async () => {
    const ch = await service.create(creatorId, 'USER', { ...baseDto, title: 'DB guards' });
    const claim = await service.claim(playerA, ch.id, {} as never, '10.6.0.1');

    // Second completion for same challenge → unique violation
    await expect(
      prisma.taskCompletion.create({
        data: { challengeId: ch.id, userId: playerB, status: CompletionStatus.ASSIGNED },
      }),
    ).rejects.toThrow();

    // Both links set → CHECK constraint violation
    const campaign = await prisma.campaign.create({
      data: {
        userId: creatorId,
        title: `${PREFIX}camp`,
        description: 'regression fixture',
        taskType: TaskType.TIKTOK_FOLLOW,
        targetUrl: 'https://tiktok.com/@x',
        creditPerTask: 10,
        totalSlots: 1,
        totalCost: 10,
        status: 'ACTIVE' as never,
      },
    });
    await expect(
      prisma.taskCompletion.create({
        data: { campaignId: campaign.id, challengeId: ch.id, userId: playerB, status: CompletionStatus.ASSIGNED },
      }),
    ).rejects.toThrow();
    // Neither link → CHECK constraint violation
    await expect(
      prisma.taskCompletion.create({
        data: { userId: playerB, status: CompletionStatus.ASSIGNED },
      }),
    ).rejects.toThrow();
    void claim;
  });
});
