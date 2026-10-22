/**
 * Campaign cancellation must be atomic and refund only funded pools:
 * - the campaign row is locked FOR UPDATE inside the transaction, so
 *   reads/counters used for the refund are protected and assignments
 *   serialize against it
 * - an atomic status claim prevents concurrent double-refunds
 * - refunds resolve only against a verified, owner-wallet,
 *   COMPLETED SPEND_CAMPAIGN_CREATE debit (resolveFundedRefund)
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

const makeTx = (overrides: Record<string, unknown> = {}) => ({
  $queryRaw: jest.fn().mockResolvedValue([lockedRow()]),
  campaign: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({ id: 'new-campaign-id' }),
    ...(overrides['campaign'] as object | undefined),
  },
  transaction: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    ...(overrides['transaction'] as object | undefined),
  },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  taskCompletion: {
    count: jest.fn().mockResolvedValue(0),
    ...(overrides['taskCompletion'] as object | undefined),
  },
  user: { update: jest.fn().mockResolvedValue({}) },
  platformRevenue: { create: jest.fn().mockResolvedValue({}) },
});

const campaignRow = () => ({ id: 'c1', userId: 'owner', title: 'Funded campaign', feeAmount: 25 });
// Pool 10×50 = 500 + 25 fee = 525 debited at creation
const FUNDING_TX = [{ amount: -525 }];

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
  });

  it('debits the wallet inside the creation transaction, linked to the new campaign', async () => {
    const tx = makeTx();
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;
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
    const tx = makeTx({ transaction: { findMany: jest.fn().mockResolvedValue(FUNDING_TX) } });
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

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
    const tx = makeTx(); // transaction.findMany → [] (no funding debit)
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

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

  it('funding smaller than the computed refund fails closed — no credit', async () => {
    const tx = makeTx({ transaction: { findMany: jest.fn().mockResolvedValue([{ amount: -100 }]) } });
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

    await expect(service.cancel('owner', 'c1')).rejects.toThrow('Inconsistent campaign funding ledger');
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('concurrent cancel loses the status claim and cannot double-refund', async () => {
    const tx = makeTx({
      campaign: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      transaction: { findMany: jest.fn().mockResolvedValue(FUNDING_TX) },
    });
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

    await expect(service.cancel('owner', 'c1')).rejects.toThrow(BadRequestException);
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('locked read of a CANCELLED campaign fails before any refund work', async () => {
    const tx = makeTx();
    (tx.$queryRaw as jest.Mock).mockResolvedValue([lockedRow({ status: 'CANCELLED' })]);
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

    await expect(service.cancel('owner', 'c1')).rejects.toThrow(BadRequestException);
    expect(tx.campaign.updateMany).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('cancel with existing completions is refused under the lock', async () => {
    const tx = makeTx({ taskCompletion: { count: jest.fn().mockResolvedValue(2) } });
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

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
  });

  it('funded campaign: lock + status + ledgered refund + audit share one tx', async () => {
    const tx = makeTx({ transaction: { findMany: jest.fn().mockResolvedValue(FUNDING_TX) } });
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

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
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

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

  it('repeat cancel fails at the locked status check — cannot refund twice', async () => {
    const tx = makeTx();
    (tx.$queryRaw as jest.Mock).mockResolvedValue([lockedRow({ status: 'CANCELLED' })]);
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue(campaignRow()) } as never;
    prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx)) as never;

    await expect(service.cancelUserCampaign('admin1', 'c1')).rejects.toThrow(BadRequestException);
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
