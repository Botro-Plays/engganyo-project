import { DepositMethod, DepositStatus } from '@prisma/client';
import { AdminService } from './admin.service';

describe('settlement summary + backfill', () => {
  const prisma = { deposit: { findMany: jest.fn(), updateMany: jest.fn() } };
  const paypal = { getOrderSettlement: jest.fn() };
  const paymongo = { getPaymentSettlement: jest.fn() };
  let svc: AdminService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new AdminService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, paymongo as never, paypal as never);
  });
  const dep = (over: Record<string, unknown> = {}) => ({
    method: DepositMethod.PAYPAL, currency: 'USD', amountFiat: 1,
    providerFee: null, providerFeeCurrency: null, providerNet: null, providerNetCurrency: null,
    providerConverted: null, providerConvertedCur: null, ...over,
  });

  it('groups each figure by its own currency; converted receivables separate per currency', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      dep({ providerFee: 0.34, providerFeeCurrency: 'USD', providerNet: 0.66, providerNetCurrency: 'USD', providerConverted: 40.5, providerConvertedCur: 'PHP' }),
      dep({ providerFee: 0.34, providerFeeCurrency: 'USD', providerNet: 0.66, providerNetCurrency: 'USD', providerConverted: 30.0, providerConvertedCur: 'EUR' }),
    ]);
    const [g] = await svc.getSettlementSummary();
    expect(g.gross).toBe(2);
    expect(g.fees).toEqual([{ currency: 'USD', total: 0.68, count: 2 }]);
    expect(g.converted.map((c) => c.currency).sort()).toEqual(['EUR', 'PHP']);
  });

  it('per-figure coverage: verified zero counts, null is missing', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      dep({ providerFee: 0, providerFeeCurrency: 'USD', providerNet: null, providerConverted: 40.5, providerConvertedCur: 'PHP' }),
      dep(),
    ]);
    const [g] = await svc.getSettlementSummary();
    expect(g.feeCount).toBe(1); expect(g.fees[0].total).toBe(0); // verified zero retained
    expect(g.netCount).toBe(0); expect(g.netPartial).toBe(true);
    expect(g.convertedCount).toBe(1); expect(g.convertedPartial).toBe(true);
  });

  it('partial backfill writes only missing fields, conditioned on status+ref; skips unavailable', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      { id: 'd1', method: DepositMethod.PAYPAL, paymentRef: 'ORD1', providerFee: 0.34, providerNet: null, providerConverted: null },
      { id: 'd2', method: DepositMethod.PAYPAL, paymentRef: 'ORD2', providerFee: null, providerNet: null, providerConverted: null },
      { id: 'd3', method: DepositMethod.PAYMONGO, paymentRef: 'pay_x', providerFee: null, providerNet: null, providerConverted: null },
    ]);
    paypal.getOrderSettlement
      .mockResolvedValueOnce({ fee: 0.34, feeCurrency: 'USD', net: 0.66, netCurrency: 'USD', converted: 40.5, convertedCurrency: 'PHP' })
      .mockResolvedValueOnce(undefined);
    paymongo.getPaymentSettlement.mockResolvedValueOnce({ fee: 0.02, feeCurrency: 'PHP', net: 0.98, netCurrency: 'PHP' });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const out = await svc.backfillSettlement(10);
    expect(out.updated).toBe(2); expect(out.skipped).toBe(1);
    // d1 had fee already — only missing net/converted written
    expect(prisma.deposit.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'd1', status: DepositStatus.COMPLETED, paymentRef: 'ORD1' },
      data: { providerNet: 0.66, providerNetCurrency: 'USD', providerConverted: 40.5, providerConvertedCur: 'PHP' },
    });
    // writes are settlement-fields only — no balance/status mutation
    for (const call of prisma.deposit.updateMany.mock.calls) {
      expect(Object.keys(call[0].data)).not.toContain('status');
      expect(call[0].where.status).toBe(DepositStatus.COMPLETED);
    }
  });
});
