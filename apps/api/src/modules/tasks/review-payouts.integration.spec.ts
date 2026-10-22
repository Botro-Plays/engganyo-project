/**
 * Integration tests for review/verification payout atomicity against a
 * REAL isolated PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * The completion claim, campaign counters, wallet credit, ledger entry,
 * balance mirror, and (admin path) audit row share one transaction.
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

  const buildServices = (client: PrismaClient) => {
    const gamification = mockService();
    gamification.getVipStatus = jest.fn().mockResolvedValue({ perks: {} });
    const social = mockService();
    social.isPlatformEnabled = jest.fn().mockResolvedValue(true);
    social.hasLinkedAccount = jest.fn().mockResolvedValue(true);
    social.verifyPlatformAction = jest.fn().mockResolvedValue(null);
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

  const makeCampaign = async (ownerId: string, autoVerify = false) =>
    prisma.campaign.create({
      data: {
        userId: ownerId,
        title: `${PREFIX}campaign`,
        taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@x',
        totalSlots: 2,
        creditPerTask: 50,
        totalCost: 100,
        feeAmount: 5,
        status: CampaignStatus.ACTIVE,
        autoVerify,
        requiresProof: true,
        targetCountries: [],
        targetLanguages: [],
      },
    });

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
    expect(s.audits.filter((a) => a.action === 'submission.approved')).toHaveLength(1);
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
});
