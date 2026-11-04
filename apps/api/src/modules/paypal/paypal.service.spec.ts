import { BadRequestException } from '@nestjs/common';
import { DepositStatus, DepositMethod } from '@prisma/client';
import { PayPalService } from './paypal.service';

describe('PayPalService', () => {
  const prisma = {
    platformConfig: { findUnique: jest.fn() },
    deposit: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  };
  const walletService = { completeDeposit: jest.fn() };
  const eventsService = {};
  let service: PayPalService;

  const deposit = (over: Record<string, unknown> = {}) => ({
    id: 'dep-1',
    userId: 'user-1',
    method: DepositMethod.PAYPAL,
    status: DepositStatus.PENDING,
    amountFiat: 1,
    currency: 'USD',
    paymentRef: 'ORDER-123',
    gatewayData: {},
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.platformConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve({
        paypal_enabled: { value: true },
        paypal_client_id: { value: 'cid' },
        paypal_client_secret: { value: 'sec' },
        paypal_mode: { value: 'sandbox' },
        paypal_webhook_id: { value: null },
      }[where.key] ?? null),
    );
    service = new PayPalService(prisma as never, walletService as never, eventsService as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok' }) } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reuses an existing payable order + approval URL (no new provider call)', async () => {
    prisma.deposit.findUnique.mockResolvedValue(
      deposit({ gatewayData: { approvalUrl: 'https://paypal.com/approve?x' } }),
    );
    const out = await service.createOrder('dep-1', 1, 'USD');
    expect(out).toEqual({ orderId: 'ORDER-123', approvalUrl: 'https://paypal.com/approve?x' });
    expect(fetch).not.toHaveBeenCalled();
  });

  const captureResponse = (over: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => ({
      status: 'COMPLETED',
      purchase_units: [
        {
          reference_id: 'dep-1',
          payments: { captures: [{ amount: { value: '1.00', currency_code: 'USD' } }] },
        },
      ],
      ...over,
    }),
  });

  it('captureOrder verifies capture + credits the deposit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(captureResponse());
    const out = await service.captureOrder('ORDER-123');
    expect(out.status).toBe('COMPLETED');
    expect(walletService.completeDeposit).toHaveBeenCalledWith('dep-1', { paymentRef: 'ORDER-123' });
  });

  it.each([
    ['amount mismatch', { payments: { captures: [{ amount: { value: '5.00', currency_code: 'USD' } }] }, reference_id: 'dep-1' }],
    ['currency mismatch', { payments: { captures: [{ amount: { value: '1.00', currency_code: 'PHP' } }] }, reference_id: 'dep-1' }],
    ['foreign reference', { payments: { captures: [{ amount: { value: '1.00', currency_code: 'USD' } }] }, reference_id: 'dep-OTHER' }],
  ])('rejects capture with %s — wallet untouched', async (_n, unit) => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'COMPLETED', purchase_units: [unit] }),
      });
    await expect(service.captureOrder('ORDER-123')).rejects.toThrow(BadRequestException);
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('rejects a non-COMPLETED order status (pending/denied)', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(captureResponse({ status: 'APPROVED' }));
    await expect(service.captureOrder('ORDER-123')).rejects.toThrow(BadRequestException);
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('captureOrder on COMPLETED deposit is idempotent', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.COMPLETED }));
    const out = await service.captureOrder('ORDER-123');
    expect(out.status).toBe('COMPLETED');
    expect(fetch).not.toHaveBeenCalled();
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  const captureEvent = (value = '1.00', currency = 'USD') => ({
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'ORDER-123', amount: { value, currency_code: currency } },
  });

  const signedWebhook = async (payload: unknown) => {
    jest.spyOn(service as never, 'verifyWebhookSignature' as never).mockResolvedValue(true as never);
    return service.processWebhookEvent(JSON.stringify(payload), {} as never);
  };

  it('webhook CAPTURE.COMPLETED settles a matching deposit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    const out = await signedWebhook(captureEvent());
    expect(out.action).toBe('completed');
    expect(walletService.completeDeposit).toHaveBeenCalledWith('dep-1', { paymentRef: 'ORDER-123' });
  });

  it.each([
    ['amount mismatch', captureEvent('9.99')],
    ['currency mismatch', captureEvent('1.00', 'PHP')],
  ])('webhook %s is ignored — wallet untouched', async (_n, payload) => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    const out = await signedWebhook(payload);
    expect(out.action).toBe('ignored_amount_mismatch');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('webhook redelivery on COMPLETED deposit settles exactly once', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.COMPLETED }));
    const out = await signedWebhook(captureEvent());
    expect(out.action).toBe('already_completed');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it("concurrent create: B cannot steal A claim; A persists; B retry returns A order", async () => {
    // Faithful predicate evaluation against a shared row, mirroring Postgres updateMany.
    const row: { paymentRef: string | null; updatedAt: Date } = { paymentRef: null, updatedAt: new Date() };
    const evalWhere = (where: { OR?: Array<Record<string, unknown>> }) =>
      where.OR!.some((c) => {
        if (c.paymentRef === null) return row.paymentRef === null;
        const sw = (c.paymentRef as { startsWith?: string }).startsWith;
        const lt = (c.updatedAt as { lt?: Date })?.lt;
        if (sw) return !!row.paymentRef?.startsWith(sw) && (!lt || row.updatedAt < lt);
        return false;
      });
    prisma.deposit.updateMany.mockImplementation(({ where, data }: { where: { OR?: Array<Record<string, unknown>>; paymentRef?: string }; data: { paymentRef: string } }) => {
      if (where.paymentRef) {
        if (row.paymentRef === where.paymentRef) { row.paymentRef = data.paymentRef; row.updatedAt = new Date(); return { count: 1 }; }
        return { count: 0 };
      }
      if (evalWhere(where)) { row.paymentRef = data.paymentRef; row.updatedAt = new Date(); return { count: 1 }; }
      return { count: 0 };
    });

    let resolveProvider: (v: unknown) => void;
    const providerGate = new Promise((r) => { resolveProvider = r; });
    (fetch as jest.Mock)
      .mockResolvedValue({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockImplementationOnce(async () => { await providerGate; return { ok: true, json: async () => ({ id: 'ORDER-A', links: [{ rel: 'approve', href: 'https://paypal.com/approveA' }] }) }; });
    prisma.deposit.findUnique.mockImplementation(async () => ({ id: 'dep-1', paymentRef: row.paymentRef, gatewayData: row.paymentRef?.startsWith('ORDER-') ? { approvalUrl: 'https://paypal.com/approveA' } : {} }));

    const a = service.createOrder('dep-1', 1, 'USD');
    await new Promise((r) => setImmediate(r)); // let A acquire + start provider call
    // B attempts mid-flight — must not claim or call the provider.
    await expect(service.createOrder('dep-1', 1, 'USD')).rejects.toThrow('being prepared');
    resolveProvider!(null);
    const aOut = await a;
    expect(aOut.orderId).toBe('ORDER-A');
    // B retry — sees persisted order, reuses it.
    const bOut = await service.createOrder('dep-1', 1, 'USD');
    expect(bOut.orderId).toBe('ORDER-A');
  });

  it("stale claim reclaim: reclaimer persists; old owner conditional persist fails", async () => {
    const row: { paymentRef: string | null; updatedAt: Date } = { paymentRef: 'creating:old', updatedAt: new Date(Date.now() - 120_000) };
    prisma.deposit.updateMany.mockImplementation(({ where, data }: { where: { OR?: Array<Record<string, unknown>>; paymentRef?: string }; data: { paymentRef: string | null } }) => {
      if (where.paymentRef) {
        if (row.paymentRef === where.paymentRef) { row.paymentRef = data.paymentRef; row.updatedAt = new Date(); return { count: 1 }; }
        return { count: 0 };
      }
      const ok = where.OR!.some((c) => c.paymentRef === null ? row.paymentRef === null : !!row.paymentRef?.startsWith('creating:') && row.updatedAt < ((c.updatedAt as { lt: Date }).lt));
      if (ok) { row.paymentRef = data.paymentRef; row.updatedAt = new Date(); return { count: 1 }; }
      return { count: 0 };
    });
    (fetch as jest.Mock)
      .mockResolvedValue({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ORDER-B', links: [{ rel: 'approve', href: 'https://paypal.com/approveB' }] }) });
    prisma.deposit.findUnique.mockImplementation(async () => ({ id: 'dep-1', paymentRef: row.paymentRef, gatewayData: { approvalUrl: 'https://paypal.com/approveB' } }));
    const out = await service.createOrder('dep-1', 1, 'USD');
    expect(out.orderId).toBe('ORDER-B');
    // Simulate old owner finishing its conditional persist — count=0, no overwrite.
    expect(row.paymentRef).toBe('ORDER-B');
  });
});
