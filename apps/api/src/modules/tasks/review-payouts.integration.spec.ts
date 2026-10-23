/**
 * Integration tests for review/verification payout atomicity against a
 * REAL isolated PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * The completion claim, campaign counters, wallet credit, ledger entry,
 * balance mirror, and audit row share one transaction.
 * Post-commit effects (XP/VP, notifications, events, referrals) are
 * outside the tx and are NOT asserted here.
 */
import {
  PrismaClient, CampaignStatus, CompletionStatus, TransactionType,
} from '@prisma/client';
import { TasksService } from './tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { AdminService } from '../admin/admin.service';
import { WalletService } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `rpay_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Review payouts — real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let campaigns: CampaignsService;
  let admin: AdminService;
  let tasks: TasksService;
  let seq = 0;

  const buildServices = (client: PrismaClient, verifyResult: boolean | null = null) => {
    const gamification = mockService();
    gamification.getVipStatus = jest.fn().mockResolvedValue({ perks: {} });
    const social = mockService();
    social.isPlatformEnabled = jest.fn().mockResolvedValue(true);
    social.hasLinkedAccount = jest.fn().mockResolvedValue(true);
    social.verifyPlatformAction = jest.fn().mockResolvedValue(verifyResult);
    const notifications = mockService();
    notifications.createNotification = jest.fn().mockResolvedValue({});
    const events = mockService();
    const store = mockService();
    store.getActiveTaskLimitBoost = jest.fn().mockResolvedValue(null);
    const antiAbuse = mockService();
    antiAbuse.flagUser = jest.fn().mockResolvedValue({});

    const walletSvc = new WalletService(
      client as never, mockService() as never, notifications as never,
      events as never, mockService() as never, mockService() as never,
      mockService() as never, gamification as never, mockService() as never,
    );
    const campaignsSvc = new CampaignsService(
      client as never, mockService() as never, walletSvc as never,
      gamification as never, mockService() as never, social as never,
      notifications as never, events as never, mockService() as never,
    );
    const adminSvc = new AdminService(
      client as never, mockService() as never, walletSvc as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never,
    );
    const tasksSvc = new TasksService(
      client as never, mockService() as never, walletSvc as never,
      campaignsSvc as never, gamification as never, antiAbuse as never,
      social as never, notifications as never, events as never,
      mockService() as never, store as never,
    );
    return { walletSvc, campaignsSvc, adminSvc, tasksSvc };
  };

  const makeUser = async (role: 'USER' | 'SUPER_ADMIN' = 'USER') => {
    const tag = `${PREFIX}${seq++}`;
    return prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        role,
        wallet: { create: {} },
      },
    });
  };

  const makeCampaign = async (ownerId: string, autoVerify = false, totalSlots = 2) =>
    prisma.campaign.create({
      data: {
        userId: ownerId,
        title: `${PREFIX}campaign`,
        taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@x',
        totalSlots,
        creditPerTask: 50,
        totalCost: totalSlots * 50,
        feeAmount: 5,
        status: CampaignStatus.ACTIVE,
        autoVerify,
        requiresProof: true,
        targetCountries: [],
        targetLanguages: [],
      },
    });

  /** Wraps a client so `model.create` rejects inside any tx (full rollback probe). */
  const sabotage = (
    client: PrismaClient,
    model: 'transaction' | 'auditLog',
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
                  return () => Promise.reject(new Error(`forced ${model} create failure`));
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

  const state = async (campaignId: string, workerId: string) => ({
    campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    completion: await prisma.taskCompletion.findFirst({ where: { campaignId, userId: workerId } }),
    walletRow: await prisma.wallet.findUniqueOrThrow({ where: { userId: workerId } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: workerId } }),
    earnLedger: await prisma.transaction.findMany({
      where: { referenceId: campaignId, type: TransactionType.EARN_TASK_COMPLETION },
    }),
    audits: await prisma.auditLog.findMany({ where: { entityType: 'TaskCompletion' } }),
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    const svc = buildServices(prisma);
    campaigns = svc.campaignsSvc;
    admin = svc.adminSvc;
    tasks = svc.tasksSvc;
    await prisma.$connect();
  });

  afterAll(async () => {
    const u = { user: { username: { startsWith: PREFIX } } };
    await prisma.taskCompletion.deleteMany({ where: { campaign: u } });
    await prisma.auditLog.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
    await prisma.transaction.deleteMany({ where: { wallet: u } });
    await prisma.campaign.deleteMany({ where: u });
    await prisma.wallet.deleteMany({ where: u });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('ordered outcome — assign → submit → owner approve pays exactly once with correct counters', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);

    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const mid = await state(campaign.id, worker.id);
    expect(mid.completion?.status).toBe(CompletionStatus.SUBMITTED);

    await campaigns.reviewSubmission(owner.id, campaign.id, mid.completion!.id, { action: 'approve' });

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.completion?.creditsEarned).toBe(50);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.earnLedger[0].amount).toBe(50);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
    // Owner path now writes its audit inside the same transaction.
    const audits = s.audits.filter(
      (a) => a.entityId === mid.completion!.id && a.action === 'submission.approved',
    );
    expect(audits).toHaveLength(1);
    expect((audits[0].newValue as Record<string, unknown>).reviewedBy).toBe('campaign_owner');
  });

  it('concurrent double owner approval: exactly one pays', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    const results = await Promise.allSettled([
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
  });

  it('concurrent double admin approval: exactly one pays, one audit row', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    const results = await Promise.allSettled([
      admin.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
      admin.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(
      s.audits.filter((a) => a.entityId === completion.id && a.action === 'submission.approved'),
    ).toHaveLength(1);
  });

  it('ordered outcome — reject releases the pending slot; a later approve fails', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    await campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'reject', reason: 'blurry' });
    await expect(
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow();

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.REJECTED);
    expect(s.campaign.pendingSlots).toBe(0); // released exactly once
    expect(s.campaign.completedSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);
  });

  it('concurrent reject+approve on the same completion: exactly one lands', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    await Promise.allSettled([
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'reject' }),
    ]);

    const s = await state(campaign.id, worker.id);
    const status = s.completion?.status;
    expect([CompletionStatus.VERIFIED, CompletionStatus.REJECTED]).toContain(status);
    expect(s.campaign.pendingSlots).toBe(0); // exactly one decrement either way
    if (status === CompletionStatus.VERIFIED) {
      expect(s.campaign.completedSlots).toBe(1);
      expect(s.earnLedger).toHaveLength(1);
      expect(s.walletRow.balance).toBe(50);
    } else {
      expect(s.campaign.completedSlots).toBe(0);
      expect(s.earnLedger).toHaveLength(0);
      expect(s.walletRow.balance).toBe(0);
    }
  });

  it('counter-integrity fail-closed: SUBMITTED completion with no pending slot refuses to pay', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    // Corrupt the counter — the anomaly class that produced pending_slots=-1.
    await prisma.campaign.update({ where: { id: campaign.id }, data: { pendingSlots: 0 } });

    await expect(
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow(/Inconsistent campaign counters/);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.SUBMITTED); // rolled back
    expect(s.campaign.completedSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);
  });

  it('autoVerify submit: one tx pays once; a concurrent resubmit cannot double-pay', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id, true); // autoVerify
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');

    const results = await Promise.allSettled([
      tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/a.png' }),
      tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/b.png' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
  });

  it('concurrent owner vs admin approval: exactly one pays, exactly one audit row', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    const results = await Promise.allSettled([
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
      admin.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
    // Exactly one audit — the loser's claim aborts before its audit write.
    const approvals = s.audits.filter(
      (a) => a.entityId === completion.id && a.action === 'submission.approved',
    );
    expect(approvals).toHaveLength(1);
  });

  it('autoVerify submit racing admin review: exactly one pays', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeCampaign(owner.id, true); // autoVerify
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    const completion = (await state(campaign.id, worker.id)).completion!;

    // On an autoVerify campaign the completion never persists as SUBMITTED,
    // so the manual path cannot interleave — this asserts the claim guard
    // keeps it from paying even if the state check were bypassed.
    const results = await Promise.allSettled([
      tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/a.png' }),
      admin.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    // Admin-path audit exists iff the admin path won the race; never more than one.
    expect(
      s.audits.filter((a) => a.entityId === completion.id && a.action === 'submission.approved').length,
    ).toBeLessThanOrEqual(1);
  });

  it('automatic submit racing recheck on the same completion: exactly one pays', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id, true); // autoVerify
    const svc = buildServices(prisma, true); // API verification succeeds → both paths auto-verify
    await svc.tasksSvc.assignTask(worker.id, campaign.id, 'ADMIN');

    const results = await Promise.allSettled([
      svc.tasksSvc.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/a.png' }),
      svc.tasksSvc.recheckTask(worker.id, campaign.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
  });

  it('forced ledger failure rolls back claim, counters, profile counter, wallet, mirror, and audit', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    const sabotaged = buildServices(sabotage(prisma, 'transaction'));
    await expect(
      sabotaged.adminSvc.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow(/forced transaction create failure/);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.SUBMITTED); // claim rolled back
    expect(s.campaign.completedSlots).toBe(0);
    expect(s.campaign.pendingSlots).toBe(1); // slot still reserved
    expect(s.campaign.status).toBe(CampaignStatus.ACTIVE);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);
    expect(s.user.creditBalance).toBe(0); // mirror rolled back
    const profile = await prisma.userProfile.findFirst({ where: { userId: worker.id } });
    expect(profile?.totalTasksDone ?? 0).toBe(0);
    expect(s.audits.filter((a) => a.entityId === completion.id)).toHaveLength(0);
  });

  it('forced audit failure rolls back claim, counters, wallet, mirror, and ledger', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    const sabotaged = buildServices(sabotage(prisma, 'auditLog'));
    await expect(
      sabotaged.adminSvc.reviewSubmission(adminUser.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow(/forced auditLog create failure/);

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.SUBMITTED);
    expect(s.campaign.completedSlots).toBe(0);
    expect(s.campaign.pendingSlots).toBe(1);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);
    expect(s.user.creditBalance).toBe(0);
  });

  it('malformed counters (completed + pending > total, or negative) refuse without status change or pay', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeCampaign(owner.id);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    // Corruption 1: completed(0) + pending(3) > total(2).
    await prisma.campaign.update({ where: { id: campaign.id }, data: { pendingSlots: 3 } });
    await expect(
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow(/Inconsistent campaign counters/);

    let s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.SUBMITTED);
    expect(s.campaign.completedSlots).toBe(0);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);

    // Corruption 2: negative completed counter.
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { pendingSlots: 1, completedSlots: -1 },
    });
    await expect(
      campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' }),
    ).rejects.toThrow(/Inconsistent campaign counters/);

    s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.SUBMITTED);
    expect(s.earnLedger).toHaveLength(0);
    expect(s.walletRow.balance).toBe(0);
  });

  it('in-flight completion approved after admin cancellation pays once and preserves CANCELLED', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    // Single slot — completing it would fill the campaign entirely.
    const campaign = await makeCampaign(owner.id, false, 1);
    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await tasks.submitProof(worker.id, campaign.id, { proofUrl: 'https://example.com/p.png' });
    const completion = (await state(campaign.id, worker.id)).completion!;

    await admin.cancelUserCampaign(adminUser.id, campaign.id, 'policy violation');
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status,
    ).toBe(CampaignStatus.CANCELLED);

    await campaigns.reviewSubmission(owner.id, campaign.id, completion.id, { action: 'approve' });

    const s = await state(campaign.id, worker.id);
    expect(s.completion?.status).toBe(CompletionStatus.VERIFIED);
    expect(s.campaign.completedSlots).toBe(1);
    expect(s.campaign.pendingSlots).toBe(0);
    // The in-flight completion filled the last slot but must not resurrect
    // the cancelled campaign.
    expect(s.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(s.campaign.completedAt).toBeNull();
    expect(s.earnLedger).toHaveLength(1);
    expect(s.walletRow.balance).toBe(50);
    expect(s.user.creditBalance).toBe(50);
    expect(
      s.audits.filter((a) => a.entityId === completion.id && a.action === 'submission.approved'),
    ).toHaveLength(1);
  });
});
