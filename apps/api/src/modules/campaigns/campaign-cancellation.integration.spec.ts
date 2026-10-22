/**
 * Integration tests for campaign cancellation funding/atomicity against a
 * REAL isolated PostgreSQL database and the REAL WalletService.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable schema-synced database
 * (never production). Skipped automatically when unset.
 *
 * Covers:
 *  - owner concurrent cancellation (exactly one refund)
 *  - admin concurrent cancellation (exactly one refund)
 *  - cancellation racing assignment (no slot refunded after assignment,
 *    no assignment on a cancelled campaign)
 *  - full rollback when ledger creation fails
 *  - full rollback when audit creation fails
 * Asserts persisted state: wallet balance, User.creditBalance mirror,
 * ledger rows, campaign status/counters, and audit rows.
 */
import { PrismaClient, CampaignStatus, TransactionType } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { AdminService } from '../admin/admin.service';
import { TasksService } from '../tasks/tasks.service';
import { WalletService } from '../wallet/wallet.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `itest_${Date.now().toString(36)}_`;

const mockService = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (target, prop: string) => {
      if (!target[prop]) target[prop] = jest.fn().mockResolvedValue({});
      return target[prop];
    },
  });

run('Campaign cancellation — real PostgreSQL integration', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let wallet: WalletService;
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

  const makeUser = async (role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' = 'USER') => {
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

  /** Creates a campaign funded exactly like production create(): real debit. */
  const makeFundedCampaign = async (ownerId: string) => {
    const campaign = await prisma.campaign.create({
      data: {
        userId: ownerId,
        title: `${PREFIX}campaign`,
        taskType: 'TIKTOK_FOLLOW',
        targetUrl: 'https://tiktok.com/@x',
        totalSlots: 10,
        creditPerTask: 50,
        totalCost: 500,
        feeAmount: 25,
        status: CampaignStatus.ACTIVE,
        targetCountries: [],
        targetLanguages: [],
      },
    });
    await wallet.credit(ownerId, 1000, {
      type: TransactionType.EARN_ADMIN_GRANT,
      description: 'fixture funding',
    });
    await wallet.debit(ownerId, 525, {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      description: `Campaign creation: ${campaign.title}`,
      referenceId: campaign.id,
      referenceType: 'campaign',
    });
    return campaign; // owner balance 475, campaign pool 500
  };

  /** Wraps a client so `model.create` matching `match` rejects inside any tx. */
  const sabotage = (
    client: PrismaClient,
    model: 'transaction' | 'auditLog',
    match: (data: Record<string, unknown>) => boolean = () => true,
  ): PrismaClient => {
    const wrapTx = (tx: never) =>
      new Proxy(tx as Record<string, unknown>, {
        get(t, p) {
          if (p === model) {
            const delegate = t[p] as Record<string, unknown>;
            return new Proxy(delegate, {
              get(d, m) {
                const v = d[m as string];
                if (m === 'create') {
                  return (args: { data: Record<string, unknown> }) =>
                    match(args.data)
                      ? Promise.reject(new Error(`forced ${model} create failure`))
                      : (v as (a: unknown) => unknown)(args);
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

  const state = async (campaignId: string, ownerId: string) => ({
    campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    walletRow: await prisma.wallet.findUniqueOrThrow({ where: { userId: ownerId } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: ownerId } }),
    refunds: await prisma.transaction.findMany({
      where: { referenceId: campaignId, type: TransactionType.REFUND_CAMPAIGN_CANCEL },
    }),
    audits: await prisma.auditLog.findMany({
      where: { entityId: campaignId, action: { contains: 'cancel' } },
    }),
    completions: await prisma.taskCompletion.findMany({ where: { campaignId } }),
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    (prisma as never as Record<string, unknown>).withTransaction = (
      fn: (tx: never) => unknown,
    ) => prisma.$transaction(fn as never);
    const svc = buildServices(prisma);
    wallet = svc.walletSvc;
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

  it('owner concurrent cancellation: exactly one refund, all rows persisted', async () => {
    const owner = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    const results = await Promise.allSettled([
      campaigns.cancel(owner.id, campaign.id),
      campaigns.cancel(owner.id, campaign.id),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    expect(succeeded).toHaveLength(1);
    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(s.refunds).toHaveLength(1);
    expect(s.refunds[0].amount).toBe(500);
    expect(s.refunds[0].status).toBe('COMPLETED');
    expect(s.walletRow.balance).toBe(975); // 475 + 500
    expect(s.user.creditBalance).toBe(975); // denormalized mirror in sync
    expect(s.audits).toHaveLength(1);
    expect((s.audits[0].newValue as { refunded: number }).refunded).toBe(500);
  });

  it('admin concurrent cancellation: exactly one refund + audit', async () => {
    const owner = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeFundedCampaign(owner.id);

    const results = await Promise.allSettled([
      admin.cancelUserCampaign(adminUser.id, campaign.id, 'review'),
      admin.cancelUserCampaign(adminUser.id, campaign.id, 'review'),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    expect(succeeded).toHaveLength(1);
    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(s.refunds).toHaveLength(1);
    expect(s.refunds[0].amount).toBe(500);
    expect(s.walletRow.balance).toBe(975);
    expect(s.user.creditBalance).toBe(975);
    expect(s.audits).toHaveLength(1);
  });

  it('forced order: assignment first → owner cancel refuses (active completion)', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    await expect(campaigns.cancel(owner.id, campaign.id)).rejects.toThrow();

    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.ACTIVE);
    expect(s.campaign.pendingSlots).toBe(1);
    expect(s.completions).toHaveLength(1);
    expect(s.refunds).toHaveLength(0);
    expect(s.walletRow.balance).toBe(475);
    expect(s.user.creditBalance).toBe(475);
  });

  it('forced order: assignment first → admin cancel keeps the pending slot consumed and refunds only the free pool', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const adminUser = await makeUser('SUPER_ADMIN');
    const campaign = await makeFundedCampaign(owner.id);

    await tasks.assignTask(worker.id, campaign.id, 'ADMIN');
    const result = await admin.cancelUserCampaign(adminUser.id, campaign.id, 'review');

    // Defined behavior: the in-flight assignment remains the worker's — its
    // slot is NOT refunded. Refund = (10 − 0 − 1) × 50 = 450.
    const s = await state(campaign.id, owner.id);
    expect(result.refunded).toBe(450);
    expect(s.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(s.campaign.pendingSlots).toBe(1);
    expect(s.completions).toHaveLength(1);
    expect(s.refunds).toHaveLength(1);
    expect(s.refunds[0].amount).toBe(450);
    expect(s.walletRow.balance).toBe(925);
    expect(s.user.creditBalance).toBe(925);
  });

  it('forced order: cancellation first → assignment cannot claim a refunded slot', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    await campaigns.cancel(owner.id, campaign.id);
    await expect(tasks.assignTask(worker.id, campaign.id, 'ADMIN')).rejects.toThrow();

    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.CANCELLED);
    expect(s.campaign.pendingSlots).toBe(0);
    expect(s.completions).toHaveLength(0);
    expect(s.refunds).toHaveLength(1);
    expect(s.refunds[0].amount).toBe(500);
    expect(s.walletRow.balance).toBe(975);
  });

  it('concurrent cancel/assign: never refunds a consumed slot, never assigns on a cancelled campaign', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    await Promise.allSettled([
      tasks.assignTask(worker.id, campaign.id, 'ADMIN'),
      campaigns.cancel(owner.id, campaign.id),
    ]);

    const s = await state(campaign.id, owner.id);
    if (s.campaign.status === CampaignStatus.CANCELLED) {
      // Cancellation won the row lock: no assignment may exist and the full
      // 10-slot pool was refunded.
      expect(s.completions).toHaveLength(0);
      expect(s.campaign.pendingSlots).toBe(0);
      expect(s.refunds).toHaveLength(1);
      expect(s.refunds[0].amount).toBe(500);
      expect(s.walletRow.balance).toBe(975);
      expect(s.user.creditBalance).toBe(975);
    } else {
      // Assignment claimed the slot first: cancellation must refuse (active
      // completion) and the slot must remain consumed.
      expect(s.completions).toHaveLength(1);
      expect(s.campaign.pendingSlots).toBe(1);
      expect(s.refunds).toHaveLength(0);
      expect(s.walletRow.balance).toBe(475);
    }
    // Invariant under either interleaving:
    expect(!(s.campaign.status === CampaignStatus.CANCELLED && s.completions.length > 0)).toBe(true);
  });

  it('ledger failure rolls back status claim, wallet credit, and audit', async () => {
    const owner = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    const failing = sabotage(prisma, 'transaction', (d) => d.type === TransactionType.REFUND_CAMPAIGN_CANCEL);
    const svc = buildServices(failing);

    await expect(svc.campaignsSvc.cancel(owner.id, campaign.id)).rejects.toThrow();

    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.ACTIVE); // claim rolled back
    expect(s.campaign.cancelledAt).toBeNull();
    expect(s.walletRow.balance).toBe(475); // no credit persisted
    expect(s.user.creditBalance).toBe(475);
    expect(s.refunds).toHaveLength(0); // no ledger row
    expect(s.audits).toHaveLength(0); // no audit row
  });

  it('audit failure rolls back status claim, wallet credit, and ledger', async () => {
    const owner = await makeUser();
    const campaign = await makeFundedCampaign(owner.id);

    const failing = sabotage(prisma, 'auditLog');
    const svc = buildServices(failing);

    await expect(svc.campaignsSvc.cancel(owner.id, campaign.id)).rejects.toThrow();

    const s = await state(campaign.id, owner.id);
    expect(s.campaign.status).toBe(CampaignStatus.ACTIVE);
    expect(s.campaign.cancelledAt).toBeNull();
    expect(s.walletRow.balance).toBe(475);
    expect(s.user.creditBalance).toBe(475);
    expect(s.refunds).toHaveLength(0);
  });
});
