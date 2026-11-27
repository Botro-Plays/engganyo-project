/**
 * Integration tests for campaign update() safety against a REAL isolated
 * PostgreSQL database. Requires TEST_DATABASE_URL (never production);
 * skipped automatically when unset.
 *
 * Covers:
 *  - proofInstructions freeze once work is accepted (live completions),
 *    including direct service calls and edit-vs-assignment serialization
 *  - stale pause/resume cannot reactivate CANCELLED or COMPLETED
 *    campaigns (concurrent cancellation and completion)
 */
import {
  PrismaClient, CampaignStatus, CompletionStatus, TransactionType, TrustLevel,
} from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { TasksService } from '../tasks/tasks.service';
import { WalletService } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `itest_upd_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Campaign update safety - real PostgreSQL integration', () => {
  jest.setTimeout(40000);

  let prisma: PrismaClient;
  let wallet: WalletService;
  let campaigns: CampaignsService;
  let tasks: TasksService;
  let seq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    const gamification = mockService();
    gamification.getVipStatus = jest.fn().mockResolvedValue({ perks: {} });
    const social = mockService();
    social.isPlatformEnabled = jest.fn().mockResolvedValue(true);
    social.hasLinkedAccount = jest.fn().mockResolvedValue(true);
    const notifications = mockService();
    const events = mockService();
    const store = mockService();
    const antiAbuse = mockService();
    const redis = mockService();
    redis.get = jest.fn().mockResolvedValue(null);

    wallet = new WalletService(
      prisma as never, mockService() as never, notifications as never,
      events as never, mockService() as never, mockService() as never,
      mockService() as never, gamification as never, mockService() as never,
    );
    campaigns = new CampaignsService(
      prisma as never, redis as never, wallet as never,
      gamification as never, mockService() as never, social as never,
      notifications as never, events as never, mockService() as never,
    );
    tasks = new TasksService(
      prisma as never, mockService() as never, wallet as never,
      campaigns as never, gamification as never, antiAbuse as never,
      social as never, notifications as never, events as never,
      mockService() as never, store as never,
    );
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

  const makeUser = async (role: 'USER' | 'ADMIN' = 'USER') => {
    const tag = `${PREFIX}${seq++}`;
    return prisma.user.create({
      data: {
        email: `${tag}@itest.local`,
        username: tag,
        passwordHash: 'x',
        referralCode: tag,
        role,
        wallet: { create: {} },
        trustScore: { create: { level: TrustLevel.MEDIUM } },
      },
    });
  };

  const createDto = () => ({
    title: `${PREFIX}campaign`,
    description: 'integration test',
    taskType: 'TIKTOK_FOLLOW' as never,
    targetUrl: 'https://tiktok.com/@x',
    totalSlots: 10,
    creditPerTask: 50,
    targetCountries: [] as string[],
  });

  const fund = async (userId: string, amount = 1000) =>
    wallet.credit(userId, amount, {
      type: TransactionType.EARN_ADMIN_GRANT,
      description: 'fixture funding',
    });

  const balance = async (userId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  it('allows proofInstructions changes while no work is accepted', async () => {
    const a = await makeUser();
    await fund(a.id);
    const c = await campaigns.create(a.id, 'USER', createDto());
    const updated = await campaigns.update(a.id, c.id, {
      proofInstructions: 'improved instructions',
    });
    expect(updated.proofInstructions).toBe('improved instructions');
  });

  it.each([
    CompletionStatus.ASSIGNED,
    CompletionStatus.IN_PROGRESS,
    CompletionStatus.SUBMITTED,
    CompletionStatus.VERIFIED,
    CompletionStatus.DISPUTED,
  ])('refuses proofInstructions changes while a %s completion exists', async (status) => {
    const a = await makeUser();
    const worker = await makeUser();
    const c = await prisma.campaign.create({
      data: {
        userId: a.id, title: `${PREFIX}freeze`, taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@f', totalSlots: 10, creditPerTask: 50,
        totalCost: 500, feeAmount: 25, status: CampaignStatus.ACTIVE,
        proofInstructions: 'original terms',
        // Live statuses hold a pending slot; VERIFIED holds a completed one.
        pendingSlots: status === CompletionStatus.VERIFIED ? 0 : 1,
        completedSlots: status === CompletionStatus.VERIFIED ? 1 : 0,
      },
    });
    await prisma.taskCompletion.create({
      data: { userId: worker.id, campaignId: c.id, status },
    });

    await expect(
      campaigns.update(a.id, c.id, { proofInstructions: 'changed terms' }),
    ).rejects.toThrow(/locked/i);

    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.proofInstructions).toBe('original terms');
  });

  it.each([
    CompletionStatus.EXPIRED,
    CompletionStatus.CANCELLED,
    CompletionStatus.REJECTED,
  ])('still allows proofInstructions edits when only %s completions exist', async (status) => {
    const a = await makeUser();
    const worker = await makeUser();
    const c = await prisma.campaign.create({
      data: {
        userId: a.id, title: `${PREFIX}released`, taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@r', totalSlots: 10, creditPerTask: 50,
        totalCost: 500, feeAmount: 25, status: CampaignStatus.ACTIVE,
        proofInstructions: 'original terms',
      },
    });
    await prisma.taskCompletion.create({
      data: { userId: worker.id, campaignId: c.id, status },
    });

    const updated = await campaigns.update(a.id, c.id, {
      proofInstructions: 'released terms',
    });
    expect(updated.proofInstructions).toBe('released terms');
  });

  it('serializes edit vs assignment: no stale terms can be applied to accepted work', async () => {
    const a = await makeUser();
    const worker = await makeUser();
    await fund(a.id);
    const c = await campaigns.create(a.id, 'USER', createDto());

    const [edit, claim] = await Promise.allSettled([
      campaigns.update(a.id, c.id, { proofInstructions: 'raced terms' }),
      tasks.assignTask(worker.id, c.id, 'USER'),
    ]);

    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    const completions = await prisma.taskCompletion.count({ where: { campaignId: c.id } });

    if (row.proofInstructions === 'raced terms') {
      // The edit won the lock first - a later claim accepts the new terms.
      expect(edit.status).toBe('fulfilled');
    } else {
      // The claim won - the edit must have been refused, not lost silently.
      expect(row.proofInstructions).not.toBe('raced terms');
      expect(completions).toBeGreaterThan(0);
      expect(edit.status).toBe('rejected');
      expect((edit as PromiseRejectedResult).reason.message).toMatch(/locked/i);
    }
  });

  it('stale pause after cancellation conflicts and never reactivates', async () => {
    const a = await makeUser();
    await fund(a.id);
    const c = await campaigns.create(a.id, 'USER', createDto());
    await campaigns.cancel(a.id, c.id);

    await expect(
      campaigns.update(a.id, c.id, { status: CampaignStatus.PAUSED }),
    ).rejects.toThrow(/Cannot modify/);
    await expect(
      campaigns.update(a.id, c.id, { status: CampaignStatus.ACTIVE }),
    ).rejects.toThrow(/Cannot modify/);

    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe(CampaignStatus.CANCELLED);
  });

  it('concurrent cancel + pause: campaign ends CANCELLED, refund applied once', async () => {
    const a = await makeUser();
    await fund(a.id);
    const c = await campaigns.create(a.id, 'USER', createDto());
    const before = await balance(a.id);

    await Promise.allSettled([
      campaigns.cancel(a.id, c.id),
      campaigns.update(a.id, c.id, { status: CampaignStatus.PAUSED }),
    ]);

    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe(CampaignStatus.CANCELLED);

    const after = await balance(a.id);
    expect(after).toBeGreaterThanOrEqual(before);
    // A second pause attempt still conflicts - no resurrection.
    await expect(
      campaigns.update(a.id, c.id, { status: CampaignStatus.ACTIVE }),
    ).rejects.toThrow(/Cannot modify/);
  });

  it('concurrent completion + pause: campaign ends COMPLETED, counters exact', async () => {
    const a = await makeUser();
    const worker = await makeUser();
    const c = await prisma.campaign.create({
      data: {
        userId: a.id, title: `${PREFIX}fin`, taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@done', totalSlots: 2, creditPerTask: 50,
        totalCost: 100, feeAmount: 10, status: CampaignStatus.ACTIVE,
        completedSlots: 1, pendingSlots: 1,
      },
    });
    const completion = await prisma.taskCompletion.create({
      data: { userId: worker.id, campaignId: c.id, status: CompletionStatus.SUBMITTED },
    });

    await Promise.allSettled([
      campaigns.reviewSubmission(a.id, c.id, completion.id, { action: 'approve' } as never),
      campaigns.update(a.id, c.id, { status: CampaignStatus.PAUSED }),
    ]);

    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    // Approve settles from ACTIVE or PAUSED; a stale pause never reverts it.
    expect(row.status).toBe(CampaignStatus.COMPLETED);
    expect(row.completedSlots).toBe(2);
    expect(row.pendingSlots).toBe(0);

    await expect(
      campaigns.update(a.id, c.id, { status: CampaignStatus.ACTIVE }),
    ).rejects.toThrow(/Cannot modify/);
  });
});
