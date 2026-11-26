/**
 * Integration tests for campaign ownership vs platform-task classification
 * against a REAL isolated PostgreSQL database and real services.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced database
 * (never production). Skipped automatically when unset.
 *
 * Covers:
 *  - user-facing create() always produces a personal campaign, including
 *    for admin-role creators (platform tasks come only from the admin path)
 *  - owner listMyCampaigns includes all own campaigns (platform flag or not)
 *  - browseActive never shows the viewer's own campaign, platform flag or not
 *  - assignment + recheck owner rejection is unconditional
 *  - settlement refuses a self-completion even if a completion row exists
 *  - non-owner cannot view or edit another user's campaign
 */
import {
  PrismaClient, CampaignStatus, CompletionStatus, TransactionType, TrustLevel,
} from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { AdminService } from '../admin/admin.service';
import { TasksService } from '../tasks/tasks.service';
import { WalletService } from '../wallet/wallet.service';
import { claimCompletionForVerification } from '../tasks/task-completion-verify';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `itest_own_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Campaign ownership classification - real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let wallet: WalletService;
  let campaigns: CampaignsService;
  let admin: AdminService;
  let tasks: TasksService;
  let seq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    // PrismaService.withTransaction is a $transaction alias; replicate it on
    // the raw client so real services (WalletService et al.) work unchanged.
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
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
    const redis = mockService();
    redis.get = jest.fn().mockResolvedValue(null); // no browse cache hits

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
    admin = new AdminService(
      prisma as never, mockService() as never, wallet as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never, mockService() as never, mockService() as never,
      mockService() as never);
    tasks = new TasksService(
      prisma as never, mockService() as never, wallet as never,
      campaigns as never, gamification as never, antiAbuse as never,
      social as never, notifications as never, events as never,
      mockService() as never, store as never,
    );
  });

  afterAll(async () => {
    const tagged = { startsWith: PREFIX };
    await prisma.taskCompletion.deleteMany({ where: { campaign: { title: tagged } } });
    await prisma.campaign.deleteMany({ where: { title: tagged } });
    await prisma.user.deleteMany({ where: { email: tagged } });
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

  it('user-facing create() by a normal user produces a listed personal campaign', async () => {
    const u = await makeUser('USER');
    await fund(u.id);
    const c = await campaigns.create(u.id, 'USER', createDto());
    expect(c.isPlatformTask).toBe(false);

    const mine = await campaigns.listMyCampaigns(u.id, {} as never);
    expect(mine.items.map((i) => i.id)).toContain(c.id);
    // Second load behaves identically (reload persistence).
    const again = await campaigns.listMyCampaigns(u.id, {} as never);
    expect(again.items.map((i) => i.id)).toContain(c.id);
  });

  it('user-facing create() by an ADMIN still produces a personal campaign', async () => {
    const a = await makeUser('ADMIN');
    await fund(a.id);
    const c = await campaigns.create(a.id, 'ADMIN', createDto());
    expect(c.isPlatformTask).toBe(false);

    const mine = await campaigns.listMyCampaigns(a.id, {} as never);
    expect(mine.items.map((i) => i.id)).toContain(c.id);
  });

  it('browseActive hides the viewers own campaign even when flagged platform task', async () => {
    const a = await makeUser('ADMIN');
    const other = await makeUser('USER');
    await fund(a.id);
    const personal = await campaigns.create(a.id, 'ADMIN', createDto());
    const platform = await admin.createPlatformTask(a.id, {
      title: `${PREFIX}platform`, taskType: 'TIKTOK_FOLLOW' as never,
      targetUrl: 'https://tiktok.com/@p', totalSlots: 5, creditPerTask: 10,
    } as never);
    expect(platform.isPlatformTask).toBe(true);

    // Both stay manageable by their owner.
    const mine = await campaigns.listMyCampaigns(a.id, {} as never);
    const ids = mine.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([personal.id, platform.id]));

    // Neither appears in the owner's own discovery.
    const ownBrowse = await campaigns.browseActive(a.id, { limit: 50 });
    const ownIds = ownBrowse.items.map((i: { id: string }) => i.id);
    expect(ownIds).not.toContain(personal.id);
    expect(ownIds).not.toContain(platform.id);

    // The platform task is still discoverable by everyone else.
    const otherBrowse = await campaigns.browseActive(other.id, { limit: 50 });
    const otherIds = otherBrowse.items.map((i: { id: string }) => i.id);
    expect(otherIds).toContain(platform.id);
    expect(otherIds).toContain(personal.id);
  });

  it('owner assignment is refused unconditionally (personal and platform-flagged)', async () => {
    const a = await makeUser('ADMIN');
    const personal = await prisma.campaign.create({
      data: {
        userId: a.id, title: `${PREFIX}p1`, taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@1', totalSlots: 10, creditPerTask: 50,
        totalCost: 500, feeAmount: 25, status: CampaignStatus.ACTIVE,
      },
    });
    const platform = await admin.createPlatformTask(a.id, {
      title: `${PREFIX}p2`, taskType: 'TIKTOK_FOLLOW' as never,
      targetUrl: 'https://tiktok.com/@2', totalSlots: 10, creditPerTask: 10,
    } as never);

    await expect(tasks.assignTask(a.id, personal.id, 'ADMIN'))
      .rejects.toThrow('Cannot assign your own campaign');
    await expect(tasks.assignTask(a.id, platform.id, 'ADMIN'))
      .rejects.toThrow('Cannot assign your own campaign');
  });

  it('settlement refuses a self-completion and pays nothing', async () => {
    const a = await makeUser('ADMIN');
    await fund(a.id);
    const c = await prisma.campaign.create({
      data: {
        userId: a.id, title: `${PREFIX}self`, taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@s', totalSlots: 10, creditPerTask: 50,
        totalCost: 500, feeAmount: 25, status: CampaignStatus.ACTIVE,
        pendingSlots: 1, isPlatformTask: true,
      },
    });
    // A self-completion row that predates the guard (worst case).
    const completion = await prisma.taskCompletion.create({
      data: {
        userId: a.id, campaignId: c.id, status: CompletionStatus.SUBMITTED,
      },
    });
    const before = await balance(a.id);

    // Owner-review path refuses.
    await expect(
      campaigns.reviewSubmission(a.id, c.id, completion.id, { action: 'approve' } as never),
    ).rejects.toThrow(/own (tasks|task)/i);

    // Direct settlement path refuses too (admin-review shares it).
    await expect(
      prisma.$transaction(async (tx) => {
        await claimCompletionForVerification(tx, {
          completionId: completion.id,
          campaignId: c.id,
          completerUserId: a.id,
          fromStatuses: [CompletionStatus.SUBMITTED],
          setData: { status: CompletionStatus.VERIFIED, creditsEarned: 50 },
        });
      }),
    ).rejects.toThrow('Campaign owners cannot complete their own tasks');

    const row = await prisma.taskCompletion.findUniqueOrThrow({ where: { id: completion.id } });
    expect(row.status).toBe(CompletionStatus.SUBMITTED);
    expect(await balance(a.id)).toBe(before); // no self-reward
    const camp = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(camp.completedSlots).toBe(0);
    expect(camp.pendingSlots).toBe(1);
  });

  it('non-owner cannot read or edit; owner safe-edit and pause/resume work', async () => {
    const a = await makeUser('USER');
    const stranger = await makeUser('USER');
    await fund(a.id);
    const c = await campaigns.create(a.id, 'USER', createDto());

    await expect(campaigns.getOne(stranger.id, c.id)).rejects.toThrow('Not your campaign');
    await expect(
      campaigns.update(stranger.id, c.id, { title: 'hostile takeover' }),
    ).rejects.toThrow('Not your campaign');
    await expect(campaigns.cancel(stranger.id, c.id)).rejects.toThrow('Not your campaign');

    const edited = await campaigns.update(a.id, c.id, {
      title: `${PREFIX}renamed`,
      description: 'updated desc',
      proofInstructions: 'new proof steps',
    });
    expect(edited.title).toBe(`${PREFIX}renamed`);
    expect(edited.description).toBe('updated desc');
    expect(edited.proofInstructions).toBe('new proof steps');

    const paused = await campaigns.update(a.id, c.id, { status: CampaignStatus.PAUSED });
    expect(paused.status).toBe(CampaignStatus.PAUSED);
    const resumed = await campaigns.update(a.id, c.id, { status: CampaignStatus.ACTIVE });
    expect(resumed.status).toBe(CampaignStatus.ACTIVE);
  });
});
