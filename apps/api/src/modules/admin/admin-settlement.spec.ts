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
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'd1', method: DepositMethod.PAYPAL, paymentRef: 'ORD1', completedAt: new Date('2026-01-01'),
    providerFee: null, providerNet: null, providerConverted: null, ...over,
  });

  it('groups each figure by its own currency; converted receivables separate per currency', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      dep({ providerFee: 0.34, providerFeeCurrency: 'USD', providerNet: 0.66, providerNetCurrency: 'USD', providerConverted: 40.5, providerConvertedCur: 'PHP' }),
      dep({ providerFee: 0.34, providerFeeCurrency: 'USD', providerNet: 0.66, providerNetCurrency: 'USD', providerConverted: 30.0, providerConvertedCur: 'EUR' }),
    ]);
    const [g] = await svc.getSettlementSummary();
    expect(g.gross).toBe(2);
    expect(g.fees).toEqual([{ currency: 'USD', total: 0.68, count: 2 }]);
    expect(g.nets[0].total).toBeCloseTo(1.32, 5);
    expect(g.converted.map((c) => c.currency).sort()).toEqual(['EUR', 'PHP']);
  });

  it('per-figure coverage: verified zero counts, null is missing', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      dep({ providerFee: 0, providerFeeCurrency: 'USD', providerConverted: 40.5, providerConvertedCur: 'PHP' }),
      dep(),
    ]);
    const [g] = await svc.getSettlementSummary();
    expect(g.feeCount).toBe(1); expect(g.fees[0].total).toBe(0);
    expect(g.netCount).toBe(0); expect(g.netPartial).toBe(true);
    expect(g.convertedCount).toBe(1); expect(g.convertedPartial).toBe(true);
  });

  it('backfill writes only missing figures, each conditioned on still-null + status + ref', async () => {
    prisma.deposit.findMany.mockResolvedValue([
      row({ id: 'd1', providerFee: 0.34 }),               // fee already set — only net/converted missing
      row({ id: 'd2', paymentRef: 'ORD2' }),              // provider unavailable → skip
      row({ id: 'd3', method: DepositMethod.PAYMONGO, paymentRef: 'pay_x' }),
    ]);
    paypal.getOrderSettlement
      .mockResolvedValueOnce({ fee: 0.34, feeCurrency: 'USD', net: 0.66, netCurrency: 'USD', converted: 40.5, convertedCurrency: 'PHP' })
      .mockResolvedValueOnce(undefined);
    paymongo.getPaymentSettlement.mockResolvedValueOnce({ fee: 0.02, feeCurrency: 'PHP', net: 0.98, netCurrency: 'PHP' });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const out = await svc.backfillSettlement(10);
    expect(out.updated).toBe(2); expect(out.skipped).toBe(1);
    // d1: providerFee preserved (not re-written); net+converted written each with a null-condition
    const calls = prisma.deposit.updateMany.mock.calls.map((c) => c[0]);
    const d1writes = calls.filter((c) => c.where.id === 'd1');
    expect(d1writes.map((w) => Object.keys(w.where))).not.toContainEqual(expect.arrayContaining(['providerFee']));
    expect(d1writes.some((w) => w.where.providerNet === null && w.where.status === DepositStatus.COMPLETED && w.where.paymentRef === 'ORD1')).toBe(true);
    for (const c of calls) expect(Object.keys(c.data)).not.toContain('status');
  });

  it('overlapping run: a concurrently-filled fee is preserved while this run fills the missing net', async () => {
    prisma.deposit.findMany.mockResolvedValue([row({ id: 'd9', paymentRef: 'ORD9' })]);
    paypal.getOrderSettlement.mockResolvedValueOnce({ fee: 0.30, feeCurrency: 'USD', net: 0.70, netCurrency: 'USD' });
    // fee write loses the race (count 0 → another run already set it); net write wins.
    prisma.deposit.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const out = await svc.backfillSettlement(10);
    expect(out.updated).toBe(1);
    const [feeCall, netCall] = prisma.deposit.updateMany.mock.calls.map((c) => c[0]);
    expect(feeCall.where.providerFee).toBeNull();
    expect(netCall.where.providerNet).toBeNull();
    expect(netCall.data).toEqual({ providerNet: 0.70, providerNetCurrency: 'USD' });
  });

  it('limit reached mid-page: cursor resumes at the last examined row, not the page end', async () => {
    prisma.deposit.findMany.mockResolvedValueOnce([
      row({ id: 'a', paymentRef: 'ORDa', completedAt: new Date('2026-01-02') }),
      row({ id: 'b', paymentRef: 'ORDb', completedAt: new Date('2026-01-01') }),
    ]);
    paypal.getOrderSettlement.mockResolvedValueOnce({ fee: 0.34, feeCurrency: 'USD', net: 0.66, netCurrency: 'USD' });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const first = await svc.backfillSettlement(1);
    expect(first.updated).toBe(1);
    expect(first.scanned).toBe(1);                       // only 'a' examined
    expect(first.nextCursor).toBeTruthy();
    // cursor must point at 'a', not page-end 'b'
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64').toString('utf8'));
    expect(decoded.id).toBe('a');

    prisma.deposit.findMany.mockReset();
    prisma.deposit.findMany.mockResolvedValueOnce([row({ id: 'b', paymentRef: 'ORDb', completedAt: new Date('2026-01-01') })]);
    paypal.getOrderSettlement.mockResolvedValueOnce({ fee: 0.34, feeCurrency: 'USD', net: 0.66, netCurrency: 'USD' });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const second = await svc.backfillSettlement(1, first.nextCursor!);
    expect(second.updated).toBe(1);
    const ids = prisma.deposit.updateMany.mock.calls.map((c) => c[0].where.id);
    expect(ids).toContain('b');
    // the second call's where carried the cursor condition
    expect(JSON.stringify(prisma.deposit.findMany.mock.calls[0][0].where)).toContain('completedAt');
  });

  it('unavailable records cannot starve older deposits — cursor continues past the scan cap', async () => {
    const mkPage = (n: number, tag: string) => Array.from({ length: n }, (_, i) =>
      row({ id: `${tag}${i}`, paymentRef: `ORD${tag}${i}` }));
    prisma.deposit.findMany
      .mockResolvedValueOnce(mkPage(100, 'a'))
      .mockResolvedValueOnce(mkPage(100, 'b'))
      .mockResolvedValueOnce(mkPage(100, 'c'))
      .mockResolvedValueOnce(mkPage(100, 'd'))
      .mockResolvedValueOnce(mkPage(100, 'e'));          // 500 scanned → cap hit
    paypal.getOrderSettlement.mockResolvedValue(undefined);
    const first = await svc.backfillSettlement(25);
    expect(first.scanned).toBe(500);
    expect(first.updated).toBe(0);
    expect(first.nextCursor).toBeTruthy();               // continuation cursor returned

    prisma.deposit.findMany.mockReset();
    const eligible = row({ id: 'old', paymentRef: 'ORDold', completedAt: new Date('2025-12-01') });
    prisma.deposit.findMany.mockResolvedValueOnce([eligible]);
    paypal.getOrderSettlement.mockResolvedValueOnce({ fee: 0.34, feeCurrency: 'USD', net: 0.66, netCurrency: 'USD' });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const second = await svc.backfillSettlement(25, first.nextCursor!);
    expect(second.updated).toBe(1);
    // cursor applied — the query carried a completedAt condition
    const secondCallWhere = prisma.deposit.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(secondCallWhere)).toContain('completedAt');
    const eligibleCalls = prisma.deposit.updateMany.mock.calls.map((c) => c[0]).filter((c) => c.where.id === 'old');
    expect(eligibleCalls.length).toBeGreaterThan(0);
  });
});
