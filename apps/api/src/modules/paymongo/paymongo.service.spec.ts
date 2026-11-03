import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DepositMethod, DepositStatus } from '@prisma/client';

import { PayMongoService } from './paymongo.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('PayMongoService', () => {
  let service: PayMongoService;
  const prismaMock = {
    platformConfig: {
      findUnique: jest.fn(),
    },
    deposit: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

  // A legacy Payment Link deposit — paymentRef is the link_ id.
  const linkDeposit = {
    id: 'dep-123',
    method: DepositMethod.PAYMONGO,
    status: DepositStatus.PENDING,
    amountFiat: 1,
    currency: 'PHP',
    paymentRef: 'link_123',
  };

  const walletServiceMock = {
    completeDeposit: jest.fn(),
  } as unknown as WalletService;

  const notificationsServiceMock = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    (prismaMock.platformConfig.findUnique as jest.Mock).mockResolvedValue({ value: 'whsec_test' });
    (prismaMock.deposit.findUnique as jest.Mock).mockReset();
    (prismaMock.deposit.findFirst as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayMongoService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletServiceMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
      ],
    }).compile();

    service = module.get(PayMongoService);
    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
  });

  const makePaymentPaidEvent = (overrides: Partial<Record<string, unknown>> = {}) => {
    const event: Record<string, any> = {
      data: {
        attributes: {
          type: 'payment.paid',
          livemode: true,
          data: {
            id: 'pay_123',
            attributes: {
              amount: 100,
              currency: 'PHP',
              external_reference_number: 'dep-123',
              payment_intent_id: 'pi_123',
              origin: 'link',
              metadata: { depositId: 'dep-123' },
            },
          },
        },
      },
    };

    const eventAttrs = event.data.attributes as Record<string, any>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'type')) {
      eventAttrs.type = overrides.type;
    }

    const dataAttrs = eventAttrs.data as Record<string, any>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'id')) {
      dataAttrs.id = overrides.id;
    }

    const paymentAttrs = dataAttrs.attributes as Record<string, any>;
    for (const key of ['external_reference_number', 'payment_intent_id', 'metadata', 'reference_number']) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const value = (overrides as Record<string, any>)[key];
        if (value === undefined) delete paymentAttrs[key];
        else paymentAttrs[key] = value;
      }
    }

    return JSON.stringify(event);
  };

  const makeLinkPaymentPaidEvent = (overrides: Partial<Record<string, unknown>> = {}) => {
    const event: Record<string, any> = {
      data: {
        attributes: {
          type: 'link.payment.paid',
          livemode: true,
          data: {
            id: 'plink_123',
            attributes: {
              external_reference_number: 'dep-123',
              reference_number: 'dep-123',
              metadata: { depositId: 'dep-123' },
              payments: [
                {
                  id: 'pay_123',
                  attributes: { payment_intent_id: 'pi_123' },
                },
              ],
            },
          },
        },
      },
    };

    const eventAttrs = event.data.attributes as Record<string, any>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'type')) {
      eventAttrs.type = overrides.type;
    }

    const linkData = eventAttrs.data as Record<string, any>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'id')) {
      linkData.id = overrides.id;
    }

    const linkAttrs = linkData.attributes as Record<string, any>;
    for (const key of ['external_reference_number', 'reference_number', 'metadata', 'payments']) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const value = (overrides as Record<string, any>)[key];
        if (value === undefined) delete linkAttrs[key];
        else linkAttrs[key] = value;
      }
    }

    return JSON.stringify(event);
  };

  it('completes matching deposit for payment.paid via external_reference_number', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    const rawBody = makePaymentPaidEvent();

    await service.processWebhookEvent(rawBody, 't=123,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('falls back to linkId match when depositId missing in link event', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    const rawBody = makeLinkPaymentPaidEvent({ external_reference_number: undefined, reference_number: undefined });

    await service.processWebhookEvent(rawBody, 't=456,li=signature');

    expect(prismaMock.deposit.findFirst).toHaveBeenCalledWith({
      where: {
        paymentRef: 'plink_123',
        method: DepositMethod.PAYMONGO,
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
      },
    });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('completes matching deposit for payment.paid via metadata depositId when external reference absent', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    const rawBody = makePaymentPaidEvent({ external_reference_number: undefined, metadata: { depositId: 'dep-123' } });

    await service.processWebhookEvent(rawBody, 't=234,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('completes deposit via link.payment.paid using reference_number metadata', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    const rawBody = makeLinkPaymentPaidEvent();

    await service.processWebhookEvent(rawBody, 't=345,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('ignores link.payment.paid when completion rejects with BadRequestException', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    (walletServiceMock.completeDeposit as jest.Mock).mockRejectedValueOnce(new BadRequestException('cancelled'));

    const rawBody = makeLinkPaymentPaidEvent();

    const result = await service.processWebhookEvent(rawBody, 't=789,li=signature');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('ignores payment when deposit cannot be found and does not call fallback', async () => {
    const depositFindUniqueMock = prismaMock.deposit.findUnique as jest.Mock;
    depositFindUniqueMock.mockResolvedValueOnce(null);

    const rawBody = makePaymentPaidEvent({ external_reference_number: 'dep-missing', payment_intent_id: 'pi_missing' });

    const result = await service.processWebhookEvent(rawBody, 't=456,li=signature');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
    expect(depositFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('ignores payment.paid when completion rejects with NotFoundException', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...linkDeposit });

    (walletServiceMock.completeDeposit as jest.Mock).mockRejectedValueOnce(new NotFoundException('missing'));

    const rawBody = makePaymentPaidEvent();

    const result = await service.processWebhookEvent(rawBody, 't=901,li=signature');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  const makeSessionPaidEvent = (overrides: Record<string, unknown> = {}) => {
    const event: Record<string, any> = {
      data: {
        attributes: {
          type: 'checkout_session.payment.paid',
          livemode: true,
          data: {
            id: 'cs_abc123',
            attributes: {
              metadata: { depositId: 'dep-123' },
              payments: [
                { id: 'pay_sess1', attributes: { amount: 100, currency: 'PHP', payment_intent_id: 'pi_sess1' } },
              ],
              payment_intent: { id: 'pi_sess1' },
              line_items: [{ amount: 100, currency: 'PHP', quantity: 1 }],
            },
          },
        },
      },
    };
    const sAttrs = (event.data.attributes as any).data.attributes;
    for (const key of ['metadata', 'payments', 'line_items', 'payment_intent']) {
      if (key in overrides) sAttrs[key] = overrides[key];
    }
    if ('id' in overrides) (event.data.attributes as any).data.id = overrides.id;
    return JSON.stringify(event);
  };

  const pendingPhpDeposit = {
    id: 'dep-123',
    method: DepositMethod.PAYMONGO,
    status: DepositStatus.PENDING,
    amountFiat: 1,
    currency: 'PHP',
    paymentRef: 'pi_sess1',
  };

  it('completes deposit on checkout_session.payment.paid via metadata.depositId', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(makeSessionPaidEvent(), 't=100,li=sig');

    expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess1' });
  });

  it('falls back to paymentRef (payment intent) match when metadata missing', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    await service.processWebhookEvent(makeSessionPaidEvent({ metadata: {} }), 't=101,li=sig');

    expect(prismaMock.deposit.findFirst).toHaveBeenCalledWith({
      where: {
        paymentRef: 'pi_sess1',
        method: DepositMethod.PAYMONGO,
      },
    });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess1' });
  });

  it('ignores session event on amount mismatch', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaidEvent({ payments: [{ id: 'pay_sess1', attributes: { amount: 5000, currency: 'PHP' } }] }),
      't=102,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores session event on currency mismatch', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaidEvent({ payments: [{ id: 'pay_sess1', attributes: { amount: 100, currency: 'USD' } }] }),
      't=103,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores session event when deposit already completed (redelivery)', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      ...pendingPhpDeposit,
      status: DepositStatus.COMPLETED,
    });

    const result = await service.processWebhookEvent(makeSessionPaidEvent(), 't=104,li=sig');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  // payment.paid is the actual settling event for Checkout Sessions — the
  // session emits a payment object whose payment_intent_id matches paymentRef.
  const makeSessionPaymentPaidEvent = (overrides: Record<string, unknown> = {}) => {
    const event: Record<string, any> = {
      data: {
        attributes: {
          type: 'payment.paid',
          livemode: true,
          data: {
            id: 'pay_sess_pay1',
            attributes: {
              amount: 100,
              currency: 'PHP',
              payment_intent_id: 'pi_sess1',
              origin: 'checkout_session',
            },
          },
        },
      },
    };
    const pAttrs = (event.data.attributes as any).data.attributes;
    for (const key of ['amount', 'currency', 'payment_intent_id', 'external_reference_number', 'metadata', 'reference_number']) {
      if (key in overrides) {
        if (overrides[key] === undefined) delete pAttrs[key];
        else pAttrs[key] = overrides[key];
      }
    }
    return JSON.stringify(event);
  };

  it('settles a session payment via payment.paid + payment_intent_id correlation', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(makeSessionPaymentPaidEvent(), 't=200,li=sig');

    expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
    expect(prismaMock.deposit.findFirst).toHaveBeenCalledWith({
      where: {
        paymentRef: 'pi_sess1',
        method: DepositMethod.PAYMONGO,
      },
    });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess_pay1' });
  });

  it('ignores a session payment on amount mismatch via payment.paid', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(makeSessionPaymentPaidEvent({ amount: 5000 }), 't=201,li=sig');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores a session payment on currency mismatch via payment.paid', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(makeSessionPaymentPaidEvent({ currency: 'USD' }), 't=202,li=sig');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores payment.paid with no provider payment id', async () => {
    const event = JSON.parse(makeSessionPaymentPaidEvent());
    (event.data.attributes.data as any).id = undefined;
    const result = await service.processWebhookEvent(JSON.stringify(event), 't=210,li=sig');
    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('verifies via provider fetch when the event omits amount/currency', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { attributes: { amount: 100, currency: 'PHP', payment_intent_id: 'pi_sess1' } } }),
    } as never);
    try {
      const result = await service.processWebhookEvent(
        makeSessionPaymentPaidEvent({ amount: undefined, currency: undefined }),
        't=211,li=sig',
      );
      expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
      expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess_pay1' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws (retryable) when the event omits fields and the provider fetch fails', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({ ok: false } as never);
    try {
      await expect(
        service.processWebhookEvent(makeSessionPaymentPaidEvent({ amount: undefined, currency: undefined }), 't=212,li=sig'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('intent match wins over a conflicting metadata depositId', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaymentPaidEvent({ metadata: { depositId: 'dep-victim-999' } }),
      't=213,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess_pay1' });
    // The hinted deposit was never touched
    expect(prismaMock.deposit.findUnique).not.toHaveBeenCalledWith({ where: { id: 'dep-victim-999' } });
  });

  it('rejects a different payment intent for an intent-bound deposit', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce(null);
    // No deposit matches the foreign intent → hint path must not rescue it.
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaymentPaidEvent({ payment_intent_id: 'pi_foreign', metadata: { depositId: 'dep-123' } }),
      't=214,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores a concurrent second delivery (claim lost)', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    (prismaMock.deposit.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    const result = await service.processWebhookEvent(makeSessionPaymentPaidEvent(), 't=215,li=sig');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('reconciles a valid paid event that arrives after a local cancel', async () => {
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({
      ...pendingPhpDeposit,
      status: DepositStatus.CANCELLED,
    });

    const result = await service.processWebhookEvent(makeSessionPaymentPaidEvent(), 't=216,li=sig');

    expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess_pay1' });
  });

  it('verifies intent via provider fetch when the event omits it (session deposit)', async () => {
    // Hint locates the deposit; only the fetched intent authorizes it.
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { attributes: { amount: 100, currency: 'PHP', payment_intent_id: 'pi_sess1' } } }),
    } as never);
    try {
      const result = await service.processWebhookEvent(
        makeSessionPaymentPaidEvent({ payment_intent_id: undefined, metadata: { depositId: 'dep-123' } }),
        't=220,li=sig',
      );
      expect(result).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });
      expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess_pay1' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('refuses settlement when neither event nor provider yields an intent (500-retryable)', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { attributes: { amount: 100, currency: 'PHP' } } }),
    } as never);
    try {
      await expect(
        service.processWebhookEvent(
          makeSessionPaymentPaidEvent({ payment_intent_id: undefined, metadata: { depositId: 'dep-123' } }),
          't=221,li=sig',
        ),
      ).rejects.toThrow(InternalServerErrorException);
      expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not authorize a session deposit via a metadata depositId hint alone', async () => {
    // Event carries the deposit's own id as metadata but a foreign intent →
    // hint path must not rescue it.
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaymentPaidEvent({ payment_intent_id: 'pi_foreign', metadata: { depositId: 'dep-123' } }),
      't=222,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('expires provider-dead sessions even when no legacy links are due', async () => {
    (prismaMock.deposit.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // expiredWithData
      .mockResolvedValueOnce([]) // expiredOld — zero legacy links
      .mockResolvedValueOnce([
        { id: 'dep-sess', gatewayData: { kind: 'checkout_session', sessionId: 'cs_dead1' } },
      ]); // stale sessions
    (prismaMock.deposit.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { attributes: { expired_at: 1730000000, payments: [] } } }),
    } as never);
    try {
      await service.cancelExpiredPayMongoDeposits();
      expect(prismaMock.deposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'dep-sess' }),
          data: expect.objectContaining({ status: DepositStatus.CANCELLED }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('leaves still-payable sessions open (provider says active)', async () => {
    (prismaMock.deposit.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'dep-sess', gatewayData: { kind: 'checkout_session', sessionId: 'cs_live1' } },
      ]);
    const cancelSpy = prismaMock.deposit.updateMany as jest.Mock;
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { attributes: { status: 'active', payments: [] } } }),
    } as never);
    try {
      await service.cancelExpiredPayMongoDeposits();
      expect(cancelSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('settles a delayed verified paid event on a stale session deposit exactly once', async () => {
    // Deposit still PENDING past the stale window; paid event arrives late.
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });
    const first = await service.processWebhookEvent(makeSessionPaymentPaidEvent(), 't=225,li=sig');
    expect(first).toEqual({ received: true, action: 'completed', depositId: 'dep-123' });

    // Redelivery after completion → ignored, no second credit.
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({
      ...pendingPhpDeposit,
      status: DepositStatus.COMPLETED,
    });
    const second = await service.processWebhookEvent(makeSessionPaymentPaidEvent(), 't=226,li=sig');
    expect(second).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledTimes(1);
  });

  // ── createCheckoutSession: never hand off a URL without a verified pi_* ──
  const sessionCreateResponse = (overrides: Record<string, unknown> = {}) => ({
    data: {
      id: 'cs_new1',
      attributes: {
        checkout_url: 'https://checkout.paymongo.com/new1',
        payment_intent: { id: 'pi_new1' },
        ...overrides,
      },
    },
  });

  it('persists the payment intent before returning the checkout URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValueOnce({
      ok: true,
      json: async () => sessionCreateResponse(),
    } as never);
    try {
      const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');
      expect(result).toEqual({ linkId: 'pi_new1', checkoutUrl: 'https://checkout.paymongo.com/new1' });
      expect(prismaMock.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dep-1' },
          data: expect.objectContaining({ paymentRef: 'pi_new1' }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('recovers a missing intent via session retrieval before handoff', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sessionCreateResponse({ payment_intent: undefined }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { attributes: { payment_intent: { id: 'pi_recovered' } } } }),
      } as never);
    try {
      const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');
      expect(result.linkId).toBe('pi_recovered');
      expect(prismaMock.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentRef: 'pi_recovered' }),
        }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('refuses handoff when the intent is absent in both create and retrieval (recoverable)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sessionCreateResponse({ payment_intent: undefined }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { attributes: { payment_intent: null } } }),
      } as never);
    try {
      await expect(service.createCheckoutSession('dep-1', 100, 'desc', 'PHP')).rejects.toThrow(
        BadRequestException,
      );
      // Nothing persisted — deposit stays eligible for a clean retry.
      expect(prismaMock.deposit.update).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects a malformed (non-pi_) intent and recovers it via retrieval', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sessionCreateResponse({ payment_intent: { id: 'notanintent' } }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { attributes: { payment_intent: { id: 'pi_recovered' } } } }),
      } as never);
    try {
      const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');
      expect(result.linkId).toBe('pi_recovered');
      expect(prismaMock.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentRef: 'pi_recovered' }) }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reuses the existing session URL on sequential retry — no new session', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      paymentRef: 'pi_a1',
      gatewayData: { kind: 'checkout_session', sessionId: 'cs_a1', checkoutUrl: 'https://checkout.paymongo.com/a1' },
    });
    const fetchSpy = jest.spyOn(global, 'fetch' as never);

    const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');

    expect(result).toEqual({ linkId: 'pi_a1', checkoutUrl: 'https://checkout.paymongo.com/a1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.deposit.update).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reuses a legacy link_* checkout on retry (preserved settlement path)', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      paymentRef: 'link_leg1',
      gatewayData: { checkoutUrl: 'https://pm.link/leg1', expiredAt: '2030-01-01T00:00:00Z' },
    });
    const fetchSpy = jest.spyOn(global, 'fetch' as never);

    const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');

    expect(result).toEqual({ linkId: 'link_leg1', checkoutUrl: 'https://pm.link/leg1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the existing URL when a concurrent request wins the claim', async () => {
    // First read: no checkout yet. Claim update loses (count 0). Re-read:
    // winner already persisted pi_* + URL.
    (prismaMock.deposit.findUnique as jest.Mock)
      .mockResolvedValueOnce({ paymentRef: null, gatewayData: {} })
      .mockResolvedValueOnce({
        paymentRef: 'pi_winner',
        gatewayData: { kind: 'checkout_session', sessionId: 'cs_w', checkoutUrl: 'https://checkout.paymongo.com/w' },
      });
    (prismaMock.deposit.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    const fetchSpy = jest.spyOn(global, 'fetch' as never);

    const result = await service.createCheckoutSession('dep-1', 100, 'desc', 'PHP');

    expect(result).toEqual({ linkId: 'pi_winner', checkoutUrl: 'https://checkout.paymongo.com/w' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('tells the loser to retry when the winner is still preparing', async () => {
    (prismaMock.deposit.findUnique as jest.Mock)
      .mockResolvedValueOnce({ paymentRef: null, gatewayData: {} })
      .mockResolvedValueOnce({ paymentRef: 'creating:other', gatewayData: {} });
    (prismaMock.deposit.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(service.createCheckoutSession('dep-1', 100, 'desc', 'PHP')).rejects.toThrow(
      'Checkout is being prepared',
    );
  });
});
