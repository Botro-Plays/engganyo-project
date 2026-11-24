/**
 * Integration tests for campaign assignment expiry against a REAL
 * isolated PostgreSQL database.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced
 * database (never production). Skipped automatically when unset.
 *
 * Covers: expirable vs protected statuses, pending-slot release under
 * the counter invariant, duplicate-sweep idempotency, submit/expiry
 * race, verify-after-expiry, cancellation interaction, batch binding,
 * the SINCE cutoff, the env gate, and exact funding reconciliation
 * (expiry moves no wallet credits).
 */
import {
  PrismaClient, CampaignStatus, CompletionStatus, TransactionType, TaskType,
} from '@prisma/client';
import { TasksService } from './tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { AdminService } from '../admin/admin.service';
import { WalletService } from '../wallet/wallet.service';
import { claimCompletionForVerification } from './task-completion-verify';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `axp_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Campaign assignment expiry - real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let tasks: TasksService;
  let admin: AdminService;
  let walletSvc: WalletService;
  let seq = 0;

  const buildServices = (client: PrismaClient) => {
    const gamification = mockService();
    gamification.getVipStatus = jest.fn().mockResolvedValue({ perks: {} });
    const social = mockService();
    social.isPlatformEnabled = jest.fn().mockResolvedValue(true);
    social.hasLinkedAccount = jest.fn().mockResolvedValue(true);
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
    const tasksSvc = new TasksService(
      client as never, mockService() as never, walletSvc as never,
      campaignsSvc as never, gamification as never, antiAbuse as never,
      social as never, notifications as never, events as never,
      mockService() as never, store as never,
    );
    const adminSvc = new AdminService(
      client as never, mockService() as never, walletSvc as never,
      mockService() as never, events as never, gamification as never,
      notifications as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never,
    );
    return { walletSvc, campaignsSvc, tasksSvc, adminSvc, notifications, events };
  };

  const makeUser = async () => {
    const tag = `${PREFIX}${seq++}`;
    return prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        wallet: { create: { balance: 10000 } },
      },
    });
  };

  const makeCampaign = async (ownerId: string, totalSlots = 2, creditPerTask = 50) =>
    prisma.campaign.create({
      data: {
        userId: ownerId,
        title: `${PREFIX}campaign`,
        taskType: 'TIKTOK_FOLLOW' as TaskType,
        targetUrl: 'https://tiktok.com/@x',
        totalSlots,
        creditPerTask,
        totalCost: totalSlots * creditPerTask,
        feeAmount: 5,
        status: CampaignStatus.ACTIVE,
        autoVerify: false,
        requiresProof: true,
        targetCountries: [],
        targetLanguages: [],
      },
    });

  const makeCompletion = (
    campaignId: string,
    userId: string,
    status: CompletionStatus,
    expiresAt: Date | null,
  ) =>
    prisma.taskCompletion.create({
      data: { campaignId, userId, status, expiresAt },
    });

  const counters = (campaignId: string) =>
    prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { status: true, totalSlots: true, completedSlots: true, pendingSlots: true },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    // PrismaService.withTransaction is just $transaction - attach the same
    // surface so wallet/service calls behave identically on the raw client.
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: unknown) => Promise<unknown>,
    ) => prisma.$transaction(fn as never);
    const built = buildServices(prisma);
    tasks = built.tasksSvc;
    admin = built.adminSvc;
    walletSvc = built.walletSvc;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.CAMPAIGN_ASSIGNMENT_SWEEP = 'true';
    delete process.env.CAMPAIGN_ASSIGNMENT_SWEEP_SINCE;
    delete process.env.CAMPAIGN_ASSIGNMENT_SWEEP_BATCH;
  });

  const past = (h: number) => new Date(Date.now() - h * 3600_000);

  it('expires ASSIGNED and IN_PROGRESS past deadline and releases pending slots', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeCampaign(owner.id, 3);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 3 } });
    const c1 = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));
    const c2 = await makeCompletion(c.id, b.id, 'IN_PROGRESS', past(2));

    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res).toEqual({ expired: 2, skipped: 0, failed: 0 });

    expect((await prisma.taskCompletion.findUnique({ where: { id: c1.id } }))!.status).toBe('EXPIRED');
    expect((await prisma.taskCompletion.findUnique({ where: { id: c2.id } }))!.status).toBe('EXPIRED');
    const row = await counters(c.id);
    expect(row.pendingSlots).toBe(1);
    expect(row.completedSlots).toBe(0);
  });

  it('never expires SUBMITTED, VERIFIED, REJECTED, DISPUTED, or CANCELLED rows', async () => {
    const owner = await makeUser();
    const users = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const c = await makeCampaign(owner.id, 5);
    const statuses: CompletionStatus[] = ['SUBMITTED', 'VERIFIED', 'REJECTED', 'DISPUTED', 'CANCELLED'];
    for (let i = 0; i < statuses.length; i++) {
      await makeCompletion(c.id, users[i].id, statuses[i], past(5));
    }
    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res.expired).toBe(0);
    const rows = await prisma.taskCompletion.findMany({ where: { campaignId: c.id } });
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(statuses));
  });

  it('leaves unexpired and null-deadline assignments untouched', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeCampaign(owner.id, 2);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 2 } });
    await makeCompletion(c.id, a.id, 'ASSIGNED', new Date(Date.now() + 3600_000));
    await makeCompletion(c.id, b.id, 'ASSIGNED', null);

    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res.expired).toBe(0);
    expect((await counters(c.id)).pendingSlots).toBe(2);
  });

  it('is idempotent across repeated sweeps', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));

    expect((await tasks.sweepExpiredCampaignAssignments()).expired).toBe(1);
    const second = await tasks.sweepExpiredCampaignAssignments();
    expect(second).toEqual({ expired: 0, skipped: 0, failed: 0 });
    expect((await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!.status).toBe('EXPIRED');
    expect((await counters(c.id)).pendingSlots).toBe(0);
  });

  it('submit-vs-expiry race: exactly one side wins', async () => {
    for (let round = 0; round < 3; round++) {
      const owner = await makeUser();
      const a = await makeUser();
      const c = await makeCampaign(owner.id, 1);
      await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
      const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));

      const [sweepRes, submitRes] = await Promise.allSettled([
        tasks.sweepExpiredCampaignAssignments(),
        tasks.submitProof(a.id, c.id, { proofUrl: '/uploads/proofs/x/p.png' }),
      ]);

      const final = (await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!;
      const row = await counters(c.id);
      if (final.status === 'EXPIRED') {
        expect(sweepRes.status).toBe('fulfilled');
        expect(submitRes.status).toBe('rejected');
        expect(row.pendingSlots).toBe(0);
      } else {
        expect(final.status).toBe('SUBMITTED');
        expect(submitRes.status).toBe('fulfilled');
        // Submitted work still holds its pending slot until review.
        expect(row.pendingSlots).toBe(1);
      }
      expect(row.completedSlots).toBe(0);
      expect(row.completedSlots + row.pendingSlots).toBeLessThanOrEqual(row.totalSlots);
    }
  });

  it('keeps work submitted before the deadline even after expiresAt passes', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', new Date(Date.now() + 3600_000));

    await tasks.submitProof(a.id, c.id, { proofUrl: '/uploads/proofs/x/p.png' });
    expect((await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!.status).toBe('SUBMITTED');

    // Deadline now passes - the review clock owns the row, not the claim clock.
    await prisma.taskCompletion.update({ where: { id: comp.id }, data: { expiresAt: past(1) } });
    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res.expired).toBe(0);
    expect((await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!.status).toBe('SUBMITTED');
    expect((await counters(c.id)).pendingSlots).toBe(1);
  });

  it('verification after expiry cannot consume the released slot', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));
    await tasks.sweepExpiredCampaignAssignments();

    // The completion claim for verification requires a submittable/review
    // status - EXPIRED matches none, so the guarded claim fails closed.
    await expect(
      prisma.$transaction(async (tx) => {
        await claimCompletionForVerification(tx, {
          completionId: comp.id,
          campaignId: c.id,
          completerUserId: a.id,
          fromStatuses: ['SUBMITTED'],
          setData: { status: 'VERIFIED' },
        });
      }),
    ).rejects.toThrow();
    const row = await counters(c.id);
    expect(row).toMatchObject({ completedSlots: 0, pendingSlots: 0 });
  });

  it('admin-cancel-then-sweep keeps refund accounting exact and never double-releases', async () => {
    const owner = await makeUser();
    const adminUser = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 3);
    // Funded provenance: a real funding debit so the refund resolves.
    await walletSvc.debit(owner.id, 3 * 50, {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      description: 'fixture campaign funding',
      referenceId: c.id,
      referenceType: 'campaign',
    });
    // One claimed-but-expired assignment among unclaimed slots.
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));

    // User-facing cancel blocks campaigns with completions by design;
    // admin cancel is the supported path here and refunds
    // (total - completed - pending) = 2 slots worth.
    const cancel = await admin.cancelUserCampaign(adminUser.id, c.id, 'test');
    expect(cancel.refunded).toBe(2 * 50);

    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res.expired).toBe(1);
    const row = await counters(c.id);
    expect(row.pendingSlots).toBe(0);
    expect(row.status).toBe('CANCELLED');

    // Expiry moves no wallet credits - the released slot's value was
    // already excluded from the cancel refund (it was pending then) and
    // stays in the platform pool, never refunded twice.
    const refunds = await prisma.transaction.findMany({
      where: { type: TransactionType.REFUND_CAMPAIGN_CANCEL, referenceId: c.id },
    });
    expect(refunds.length).toBe(1);
    expect(Math.abs(refunds[0].amount)).toBe(2 * 50);
  });

  it('moves no wallet funds on expiry (pool accounting only)', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));
    const involvedTxs = () =>
      prisma.transaction.count({ where: { wallet: { userId: { in: [owner.id, a.id] } } } });
    const txBefore = await involvedTxs();

    await tasks.sweepExpiredCampaignAssignments();
    // Scoped to fixture wallets - other suites share this test database.
    expect(await involvedTxs()).toBe(txBefore);
    const wallet = await prisma.wallet.findUnique({ where: { userId: a.id } });
    expect(wallet!.balance).toBe(10000);
  });

  it('honors the batch bound and the SINCE cutoff', async () => {
    const owner = await makeUser();
    const c = await makeCampaign(owner.id, 6);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 4 } });
    const users = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    for (const u of users) {
      await makeCompletion(c.id, u.id, 'ASSIGNED', past(1));
    }

    process.env.CAMPAIGN_ASSIGNMENT_SWEEP_BATCH = '2';
    const first = await tasks.sweepExpiredCampaignAssignments();
    expect(first.expired).toBe(2);
    delete process.env.CAMPAIGN_ASSIGNMENT_SWEEP_BATCH;

    // SINCE in the future - remaining expired rows predate it and stay.
    process.env.CAMPAIGN_ASSIGNMENT_SWEEP_SINCE = new Date(Date.now() + 3600_000).toISOString();
    const gated = await tasks.sweepExpiredCampaignAssignments();
    expect(gated.expired).toBe(0);
    delete process.env.CAMPAIGN_ASSIGNMENT_SWEEP_SINCE;

    const rest = await tasks.sweepExpiredCampaignAssignments();
    expect(rest.expired).toBe(2);
    expect((await counters(c.id)).pendingSlots).toBe(0);
  });

  it('does nothing when the env gate is off', async () => {
    process.env.CAMPAIGN_ASSIGNMENT_SWEEP = 'false';
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    await prisma.campaign.update({ where: { id: c.id }, data: { pendingSlots: 1 } });
    const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));

    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res).toEqual({ expired: 0, skipped: 0, failed: 0 });
    expect((await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!.status).toBe('ASSIGNED');
    expect((await counters(c.id)).pendingSlots).toBe(1);
  });

  it('fails closed on inconsistent counters (row retried, not stuck)', async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const c = await makeCampaign(owner.id, 1);
    // pending_slots = 0 while an ASSIGNED row claims a slot - malformed.
    const comp = await makeCompletion(c.id, a.id, 'ASSIGNED', past(1));

    const res = await tasks.sweepExpiredCampaignAssignments();
    expect(res.failed).toBe(1);
    // Completion untouched - eligible for a later pass once counters heal.
    expect((await prisma.taskCompletion.findUnique({ where: { id: comp.id } }))!.status).toBe('ASSIGNED');
  });
});
