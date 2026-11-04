import { BadRequestException } from '@nestjs/common';
import { DepositStatus, DepositMethod } from '@prisma/client';
import { PayPalService } from './paypal.service';

describe('PayPalService', () => {
  const prisma = {
    platformConfig: { findUnique: jest.fn() },
    deposit: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  };
  const walletService = { completeDeposit: jest.fn() };
  const eventsService = { emitToUser: jest.fn() };
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

  const verifiedOrder = (over: Record<string, unknown> = {}, unitOver: Record<string, unknown> = {}) => ({
    id: 'ORDER-123',
    status: 'COMPLETED',
    purchase_units: [
      {
        reference_id: 'dep-1',
        payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] },
        ...unitOver,
      },
    ],
    ...over,
  });

  const captureResponse = (over: Record<string, unknown> = {}, unitOver: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => verifiedOrder(over, unitOver),
  });

  const alreadyCapturedError = () => ({
    ok: false,
    json: async () => ({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }),
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
    ['amount mismatch', { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '5.00', currency_code: 'USD' } }] } }],
    ['currency mismatch', { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'PHP' } }] } }],
    ['foreign reference', { reference_id: 'dep-OTHER' }],
    ['missing capture', { payments: { captures: [] } }],
    ['incomplete capture', { payments: { captures: [{ id: 'CAP-1', status: 'PENDING', amount: { value: '1.00', currency_code: 'USD' } }] } }],
  ])('rejects capture with %s — wallet untouched', async (_n, unitOver) => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(captureResponse({}, unitOver));
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

  const captureEvent = (value = '1.00', currency = 'USD', over: Record<string, unknown> = {}) => ({
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAP-1',
      status: 'COMPLETED',
      amount: { value, currency_code: currency },
      supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
      ...over,
    },
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

  // ── Lost response after capture ──

  it('lost response: PROCESSING deposit retry re-attempts provider and recovers via verified ORDER_ALREADY_CAPTURED', async () => {
    // First attempt timed out after PayPal captured; deposit stuck PROCESSING.
    prisma.deposit.findUnique
      .mockResolvedValueOnce(deposit({ status: DepositStatus.PROCESSING })) // initial lookup
      .mockResolvedValueOnce(deposit({ status: DepositStatus.PROCESSING })) // freshDeposit in recovery
      .mockResolvedValueOnce(deposit({ status: DepositStatus.COMPLETED })); // settled read-back
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) }) // token
      .mockResolvedValueOnce(alreadyCapturedError()) // capture POST → 422 already captured
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder() }); // GET /orders → verified capture
    const out = await service.captureOrder('ORDER-123', 'user-1');
    expect(out.status).toBe('COMPLETED');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wrong amount', {}, { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.99', currency_code: 'USD' } }] } }],
    ['wrong currency', {}, { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'PHP' } }] } }],
    ['mismatched order id', { id: 'ORDER-OTHER' }, {}],
    ['mismatched reference', {}, { reference_id: 'dep-OTHER' }],
    ['missing capture', {}, { payments: { captures: [] } }],
    ['incomplete capture', {}, { payments: { captures: [{ id: 'CAP-1', status: 'PENDING', amount: { value: '1.00', currency_code: 'USD' } }] } }],
  ])('ORDER_ALREADY_CAPTURED recovery rejects %s — wallet untouched', async (_n, orderOver, unitOver) => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.PROCESSING }));
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(alreadyCapturedError())
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder(orderOver, unitOver) });
    await expect(service.captureOrder('ORDER-123', 'user-1')).rejects.toThrow(BadRequestException);
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('ORDER_ALREADY_CAPTURED with unavailable order lookup is retryable — wallet untouched', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.PROCESSING }));
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(alreadyCapturedError())
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); // GET /orders down
    await expect(service.captureOrder('ORDER-123', 'user-1')).rejects.toThrow('retry');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('first response fails verification; retry sees ALREADY_CAPTURED with same bad evidence → zero credit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const badUnit = { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.99', currency_code: 'USD' } }] } };
    (fetch as jest.Mock)
      // Attempt 1: capture succeeds at PayPal but evidence mismatches → reject.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(captureResponse({}, badUnit))
      // Attempt 2 (retry): provider says already captured; GET order returns
      // the same mismatched capture → still rejected, zero credit.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce(alreadyCapturedError())
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder({}, badUnit) });
    await expect(service.captureOrder('ORDER-123', 'user-1')).rejects.toThrow(BadRequestException);
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.PROCESSING }));
    await expect(service.captureOrder('ORDER-123', 'user-1')).rejects.toThrow(BadRequestException);
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('lost response: signed webhook settles a PROCESSING deposit once', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.PROCESSING }));
    const out = await signedWebhook(captureEvent());
    expect(out.action).toBe('completed');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
    // Webhook redelivery — no second credit.
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.COMPLETED }));
    const dup = await signedWebhook(captureEvent());
    expect(dup.action).toBe('already_completed');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  it('webhook-then-capture and capture-then-webhook each settle exactly once', async () => {
    // Order 1: webhook first, then browser capture → early COMPLETED return.
    prisma.deposit.findUnique
      .mockResolvedValueOnce(deposit()) // webhook lookup
      .mockResolvedValueOnce(deposit({ status: DepositStatus.COMPLETED })); // capture lookup
    await signedWebhook(captureEvent());
    const out = await service.captureOrder('ORDER-123', 'user-1');
    expect(out.status).toBe('COMPLETED');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  // ── Order / capture binding ──

  it('signed event for a foreign order (same amount) cannot credit this deposit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(null); // no deposit for ORDER-FOREIGN
    const out = await signedWebhook(captureEvent('1.00', 'USD', { supplementary_data: { related_ids: { order_id: 'ORDER-FOREIGN' } } }));
    expect(out.action).toBe('ignored_no_deposit');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('foreign account cannot trigger capture on another user’s order', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit()); // userId: user-1
    await expect(service.captureOrder('ORDER-123', 'user-OTHER')).rejects.toThrow('Deposit not found');
    expect(fetch).not.toHaveBeenCalled();
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('foreign account cannot create/read an order for another user’s deposit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    await expect(service.createOrder('dep-1', 1, 'USD', 'user-OTHER')).rejects.toThrow('Deposit not found');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('unknown order id cannot trigger capture at all', async () => {
    prisma.deposit.findUnique.mockResolvedValue(null);
    await expect(service.captureOrder('ORDER-UNKNOWN', 'user-1')).rejects.toThrow('Deposit not found');
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── CAPTURE.COMPLETED evidence rules ──

  it.each([
    ['missing amount', captureEvent('1.00', 'USD', { amount: undefined })],
    ['missing currency', captureEvent('1.00', '', { amount: { value: '1.00' } })],
    ['malformed amount', captureEvent('not-a-number')],
    ['missing capture id', captureEvent('1.00', 'USD', { id: undefined })],
    ['missing status', captureEvent('1.00', 'USD', { status: undefined })],
  ])('insufficient evidence (%s) → provider lookup verifies then settles once', async (_n, payload) => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder() });
    const out = await signedWebhook(payload);
    expect(out.action).toBe('completed');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  it('insufficient evidence + mismatched capture id in retrieved order → ignored, zero credit', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder({}, { payments: { captures: [{ id: 'CAP-OTHER', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] } }) });
    const out = await signedWebhook(captureEvent('1.00', 'USD', { id: 'CAP-DIFF', status: undefined, amount: undefined }));
    expect(out.action).toBe('ignored');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('insufficient evidence + unavailable lookup → retryable, wallet untouched', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(signedWebhook(captureEvent('1.00', 'USD', { amount: undefined }))).rejects.toThrow('retry');
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('webhook-first then browser capture → one credit; browser-first then webhook → one credit', async () => {
    // Webhook-first.
    prisma.deposit.findUnique
      .mockResolvedValueOnce(deposit()) // webhook lookup
      .mockResolvedValueOnce(deposit({ status: DepositStatus.COMPLETED })); // browser lookup
    await signedWebhook(captureEvent());
    const out = await service.captureOrder('ORDER-123', 'user-1');
    expect(out.status).toBe('COMPLETED');
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  it('non-finite amount (Infinity) rejected via lookup path — zero credit when evidence missing', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedOrder() });
    // Infinity serializes oddly — send via raw payload to simulate malformed number
    const out = await signedWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1', status: 'COMPLETED', amount: { value: 'Infinity', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: 'ORDER-123' } } } });
    expect(out.action).toBe('completed'); // event evidence insufficient → provider lookup verified instead
    expect(walletService.completeDeposit).toHaveBeenCalledTimes(1);
  });

  // ── PENDING / DENIED transitions: production-shaped events + concurrency ──

  const pendingEvent = (over: Record<string, unknown> = {}) => ({
    event_type: 'PAYMENT.CAPTURE.PENDING',
    resource: {
      id: 'CAP-PEND-9',
      status: 'PENDING',
      amount: { value: '1.00', currency_code: 'USD' },
      supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
      ...over,
    },
  });
  const deniedEvent = (over: Record<string, unknown> = {}) => ({
    event_type: 'PAYMENT.CAPTURE.DENIED',
    resource: {
      id: 'CAP-DENY-7',
      status: 'DENIED',
      amount: { value: '1.00', currency_code: 'USD' },
      supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
      ...over,
    },
  });

  it('PENDING marks the deposit PROCESSING and emits once (distinct capture/order ids)', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit());
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const out = await signedWebhook(pendingEvent());
    expect(out.action).toBe('marked_processing');
    expect(eventsService.emitToUser).toHaveBeenCalledWith('user-1', 'deposit:updated', { depositId: 'dep-1', status: 'PROCESSING' });
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('DENIED marks the deposit FAILED and emits once', async () => {
    prisma.deposit.findUnique.mockResolvedValue(deposit({ status: DepositStatus.PROCESSING }));
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    const out = await signedWebhook(deniedEvent());
    expect(out.action).toBe('marked_failed');
    expect(eventsService.emitToUser).toHaveBeenCalledWith('user-1', 'deposit:updated', { depositId: 'dep-1', status: 'FAILED' });
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('PENDING racing a concurrent COMPLETED transition → zero-row write, stays COMPLETED, no emit, no extra credit', async () => {
    prisma.deposit.findUnique
      .mockResolvedValueOnce(deposit()) // initial read: PENDING
      .mockResolvedValueOnce(deposit({ status: DepositStatus.COMPLETED })); // fresh read
    prisma.deposit.updateMany.mockResolvedValue({ count: 0 }); // concurrent settle won
    const out = await signedWebhook(pendingEvent());
    expect(out.action).toBe('already_completed');
    expect(eventsService.emitToUser).not.toHaveBeenCalled();
    expect(walletService.completeDeposit).not.toHaveBeenCalled();
  });

  it('DENIED racing a concurrent COMPLETED transition → zero-row write, stays COMPLETED, no emit', async () => {
    prisma.deposit.findUnique
      .mockResolvedValueOnce(deposit({ status: DepositStatus.PROCESSING }))
      .mockResolvedValueOnce(deposit({ status: DepositStatus.COMPLETED }));
    prisma.deposit.updateMany.mockResolvedValue({ count: 0 });
    const out = await signedWebhook(deniedEvent());
    expect(out.action).toBe('already_completed');
    expect(eventsService.emitToUser).not.toHaveBeenCalled();
  });

  it('capture events without related order id leave the deposit untouched', async () => {
    const noOrder = { supplementary_data: { related_ids: {} } };
    for (const evt of [pendingEvent(noOrder), deniedEvent(noOrder)]) {
      const out = await signedWebhook(evt);
      expect(out.action).toBe('ignored_no_order_id');
    }
    expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
  });
});
