import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepositMethod, DepositStatus } from '@prisma/client';

import { PayMongoService } from './paymongo.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

describe('PayMongoService', () => {
  let service: PayMongoService;
  const prismaMock = {
    platformConfig: {
      findUnique: jest.fn(),
    },
    deposit: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaService;

  const walletServiceMock = {
    completeDeposit: jest.fn(),
  } as unknown as WalletService;

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
});
