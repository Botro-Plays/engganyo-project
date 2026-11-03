import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

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
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

    const rawBody = makePaymentPaidEvent();

    await service.processWebhookEvent(rawBody, 't=123,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('falls back to linkId match when depositId missing in link event', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prismaMock.deposit.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

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
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

    const rawBody = makePaymentPaidEvent({ external_reference_number: undefined, metadata: { depositId: 'dep-123' } });

    await service.processWebhookEvent(rawBody, 't=234,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('completes deposit via link.payment.paid using reference_number metadata', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

    const rawBody = makeLinkPaymentPaidEvent();

    await service.processWebhookEvent(rawBody, 't=345,li=signature');

    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_123' });
  });

  it('ignores link.payment.paid when completion rejects with BadRequestException', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

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
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'dep-123',
      method: DepositMethod.PAYMONGO,
      status: DepositStatus.PENDING,
    });

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
              payments: [{ id: 'pay_sess1' }],
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
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
      },
    });
    expect(walletServiceMock.completeDeposit).toHaveBeenCalledWith('dep-123', { paymentRef: 'pay_sess1' });
  });

  it('ignores session event on amount mismatch', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaidEvent({ line_items: [{ amount: 5000, currency: 'PHP', quantity: 1 }] }),
      't=102,li=sig',
    );

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
  });

  it('ignores session event on currency mismatch', async () => {
    (prismaMock.deposit.findUnique as jest.Mock).mockResolvedValueOnce({ ...pendingPhpDeposit });

    const result = await service.processWebhookEvent(
      makeSessionPaidEvent({ line_items: [{ amount: 100, currency: 'USD', quantity: 1 }] }),
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
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
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
});
