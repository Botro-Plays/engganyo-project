/**
 * Campaign cancellation must be atomic and refund only funded pools:
 * - the campaign row is locked FOR UPDATE inside the transaction, and
 *   each locked counter is validated (nonneg integers, no oversubscription,
 *   valid credit_per_task) — malformed rows fail closed for manual review
 * - an atomic status claim prevents concurrent double-refunds
 * - funding resolution distinguishes ABSENT funding (audited no-refund
 *   cancel) from MALFORMED funding (wrong wallet, bad status/direction,
 *   inconsistent amounts → manual review). Pool is bounded separately
 *   from the retained fee; prior validated refunds reduce capacity
 * - cancellation, wallet credit, ledger entry, and audit share one tx
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CampaignStatus, TransactionType } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { AdminService } from '../admin/admin.service';

const mockService = () => new Proxy({} as Record<string, jest.Mock>, {
  get: (target, prop: string) => {
    if (!target[prop]) target[prop] = jest.fn();
    return target[prop];
  },
});

const lockedRow = (overrides: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  total_slots: 10,
  completed_slots: 0,
  pending_slots: 0,
  credit_per_task: 50,
  ...overrides,
});

type TxOpts = {
  funding?: Array<Record<string, unknown>>;
  priorRefunds?: Array<Record<string, unknown>>;
  row?: Array<Record<string, unknown>>;
} & Record<string, unknown>;

const goodFunding = (amount = -525) => [
  { amount, status: 'COMPLETED', wallet: { userId: 'owner' } },
];

const makeTx = (opts: TxOpts = {}) => ({
  $queryRaw: jest.fn().mockResolvedValue(opts.row ?? [lockedRow()]),
  campaign: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({ id: 'new-campaign-id' }),
    ...(opts['campaign'] as object | undefined),
  },
  transaction: {
    findMany: jest.fn().mockImplementation(({ where }: { where: { type: string } }) =>
      Promise.resolve(
        where.type === 'SPEND_CAMPAIGN_CREATE'
          ? (opts.funding ?? [])
          : (opts.priorRefunds ?? []),
      ),
    ),
    ...(opts['transaction'] as object | undefined),
  },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  taskCompletion: {
    count: jest.fn().mockResolvedValue(0),
    ...(opts['taskCompletion'] as object | undefined),
  },
  user: { update: jest.fn().mockResolvedValue({}) },
  platformRevenue: { create: jest.fn().mockResolvedValue({}) },
});

const campaignRow = () => ({ id: 'c1', userId: 'owner', title: 'Funded campaign', feeAmount: 25 });

describe('CampaignsService — cancellation funding & atomicity', () => {
  let prisma: Record<string, jest.Mock>;
  let walletService: Record<string, jest.Mock>;
  let eventsService: Record<string, jest.Mock>;
  let service: CampaignsService;

  beforeEach(() => {
    prisma = mockService();
    walletService = mockService();
    eventsService = mockService();
    const gamificationService = mockService();
    const socialAuthService = mockService();
    const notificationsService = mockService();
    gamificationService.getVipStatus = jest.fn().mockResolvedValue({ perks: { feeDiscountPercent: 0 } });
    socialAuthService.isPlatformEnabled = jest.fn().mockResolvedValue(true);
    notificationsService.createNotification = jest.fn().mockResolvedValue({});
    service = new CampaignsService(
      prisma as never,
      mockService() as never,
      walletService as never,
      gamificationService as never,
      mockService() as never,
      socialAuthService as never,
      notificationsService as never,
      eventsService as never,
      mockService() as never,
    );
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
  });

  const wire = (tx: unknown) => {
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;
  };

  it('debits the wallet inside the creation transaction, linked to the new campaign', async () => {
    const tx = makeTx();
    wire(tx);
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    prisma.wallet = { findUnique: jest.fn().mockResolvedValue({ lifetimeSpent: 0 }) } as never;
    prisma.platformConfig = { findMany: jest.fn().mockResolvedValue([]) } as never;
    prisma.trustScore = { findUnique: jest.fn().mockResolvedValue(null) } as never;
    prisma.campaign = {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalCost: 0 } }),
    } as never;

    await service.create('u1', 'ADMIN', {
      taskType: 'TIKTOK_FOLLOW', title: 'Promo campaign', targetUrl: 'https://tiktok.com/@x',
      totalSlots: 10, creditPerTask: 50,
    } as never);

    expect(walletService.debit).toHaveBeenCalledWith(
      'u1',
      expect.any(Number),
      expect.objectContaining({
        type: TransactionType.SPEND_CAMPAIGN_CREATE,
        referenceId: 'new-campaign-id',
        referenceType: 'campaign',
      }),
      tx,
    );
  });

  it('owner cancel on a funded campaign: lock + atomic claim + ledgered refund + audit in one tx', async () => {
    const tx = makeTx({ funding: goodFunding() });
    wire(tx);

    const result = await service.cancel('owner', 'c1');

    expect(tx.$queryRaw).toHaveBeenCalled(); // FOR UPDATE lock acquired
    expect(tx.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'c1' }),
      data: expect.objectContaining({ status: CampaignStatus.CANCELLED }),
    }));
    expect(walletService.credit).toHaveBeenCalledWith(
      'owner', 500,
      expect.objectContaining({ type: TransactionType.REFUND_CAMPAIGN_CANCEL, referenceId: 'c1' }),
      tx,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'campaign.cancelled',
        entityId: 'c1',
        newValue: expect.objectContaining({ refunded: 500 }),
      }),
    }));
    expect(result.refundAmount).toBe(500);
  });

  it('owner cancel on an unfunded campaign cancels + audits without minting credits', async () => {
    const tx = makeTx(); // no linked funding rows at all
    wire(tx);

    const result = await service.cancel('owner', 'c1');

    expect(tx.campaign.updateMany).toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newValue: expect.objectContaining({ refunded: 0, refundSkippedUnfunded: true }),
      }),
    }));
    expect(result.refundAmount).toBe(0);
  });

  it.each([
    ['negative pending_slots', { pending_slots: -1 }],
    ['negative completed_slots', { completed_slots: -1 }],
    ['oversubscribed counters', { completed_slots: 6, pending_slots: 5 }],
    ['zero credit_per_task', { credit_per_task: 0 }],
    ['non-integer total_slots', { total_slots: 10.5 }],
  ])('locked counters %s fail closed — no claim, no credit', async (_label, row) => {
    const tx = makeTx({ row: [lockedRow(row)], funding: goodFunding() });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow('Inconsistent campaign counters');
    expect(tx.campaign.updateMany).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong wallet', [{ amount: -525, status: 'COMPLETED', wallet: { userId: 'other' } }]],
    ['non-COMPLETED status', [{ amount: -525, status: 'PENDING', wallet: { userId: 'owner' } }]],
    ['positive amount', [{ amount: 525, status: 'COMPLETED', wallet: { userId: 'owner' } }]],
    ['debit below pool', [{ amount: -400, status: 'COMPLETED', wallet: { userId: 'owner' } }]],
    ['debit covering fee only', [{ amount: -25, status: 'COMPLETED', wallet: { userId: 'owner' } }]],
  ])('malformed funding (%s) → manual review, not silent no-refund', async (_label, funding) => {
    const tx = makeTx({ funding });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow('Inconsistent campaign funding ledger');
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('prior refund reduces capacity — over-refunding fails closed', async () => {
    const tx = makeTx({
      funding: goodFunding(),
      priorRefunds: [{ amount: 200, status: 'COMPLETED', wallet: { userId: 'owner' } }],
    });
    wire(tx);

    // poolFunded 500 − prior 200 = 300 < requested 500
    await expect(service.cancel('owner', 'c1')).rejects.toThrow('Inconsistent campaign funding ledger');
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('malformed prior refund row fails closed rather than being ignored', async () => {
    const tx = makeTx({
      funding: goodFunding(),
      priorRefunds: [{ amount: 200, status: 'PENDING', wallet: { userId: 'owner' } }],
    });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow('Inconsistent campaign funding ledger');
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('concurrent cancel loses the status claim and cannot double-refund', async () => {
    const tx = makeTx({
      campaign: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      funding: goodFunding(),
    });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow(BadRequestException);
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('locked read of a CANCELLED campaign fails before any refund work', async () => {
    const tx = makeTx({ row: [lockedRow({ status: 'CANCELLED' })] });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow(BadRequestException);
    expect(tx.campaign.updateMany).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('cancel with existing completions is refused under the lock', async () => {
    const tx = makeTx({ taskCompletion: { count: jest.fn().mockResolvedValue(2) } });
    wire(tx);

    await expect(service.cancel('owner', 'c1')).rejects.toThrow(ForbiddenException);
    expect(walletService.credit).not.toHaveBeenCalled();
  });
});

describe('AdminService — cancellation funding & atomicity', () => {
  let prisma: Record<string, jest.Mock>;
  let walletService: Record<string, jest.Mock>;
  let service: AdminService;

  beforeEach(() => {
    prisma = mockService();
    walletService = mockService();
    service = new AdminService(
      prisma as never,
      mockService() as never,
      walletService as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
      mockService() as never,
    );
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
  });

  const wire = (tx: unknown) => {
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;
  };

  it('funded campaign: lock + status + ledgered refund + audit share one tx', async () => {
    const tx = makeTx({ funding: goodFunding() });
    wire(tx);

    const result = await service.cancelUserCampaign('admin1', 'c1', 'cleanup');

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'c1' }),
    }));
    expect(walletService.credit).toHaveBeenCalledWith(
      'owner', 500,
      expect.objectContaining({ type: TransactionType.REFUND_CAMPAIGN_CANCEL, referenceId: 'c1' }),
      tx,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'user_campaign.cancelled',
        newValue: expect.objectContaining({ refunded: 500 }),
      }),
    }));
    expect(result.refunded).toBe(500);
  });

  it('unfunded campaign: cancels and audits, but issues no credits and writes refundSkippedUnfunded', async () => {
    const tx = makeTx();
    wire(tx);

    const result = await service.cancelUserCampaign('admin1', 'c1');

    expect(tx.campaign.updateMany).toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled(); // never bypass the wallet ledger again
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newValue: expect.objectContaining({ refunded: 0, refundSkippedUnfunded: true }),
      }),
    }));
    expect(result.refunded).toBe(0);
  });

  it.each([
    ['negative pending_slots', { pending_slots: -3 }, null],
    ['oversubscribed counters', { completed_slots: 8, pending_slots: 3 }, null],
    ['wrong-wallet funding', null, [{ amount: -525, status: 'COMPLETED', wallet: { userId: 'intruder' } }]],
    ['non-COMPLETED funding', null, [{ amount: -525, status: 'FAILED', wallet: { userId: 'owner' } }]],
    ['debit below pool', null, [{ amount: -300, status: 'COMPLETED', wallet: { userId: 'owner' } }]],
  ])('bad state (%s) fails closed — no credit, no audit', async (_label, row, funding) => {
    const tx = makeTx({ row: row ? [lockedRow(row)] : undefined, funding: funding ?? goodFunding() });
    wire(tx);

    await expect(service.cancelUserCampaign('admin1', 'c1')).rejects.toThrow(BadRequestException);
    // The claim may have executed in the mock, but the tx throws → rollback;
    // the observable assertions are: no refund credit and no audit row.
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('repeat cancel fails at the locked status check — cannot refund twice', async () => {
    const tx = makeTx({ row: [lockedRow({ status: 'CANCELLED' })] });
    wire(tx);

    await expect(service.cancelUserCampaign('admin1', 'c1')).rejects.toThrow(BadRequestException);
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
