import { Test, TestingModule } from '@nestjs/testing';
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
    },
  } as unknown as PrismaService;

  const walletServiceMock = {
    completeDeposit: jest.fn(),
  } as unknown as WalletService;

  beforeEach(async () => {
    jest.clearAllMocks();

    (prismaMock.platformConfig.findUnique as jest.Mock).mockResolvedValue({ value: 'whsec_test' });
    (prismaMock.deposit.findUnique as jest.Mock).mockReset();

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
    const base = {
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
            },
          },
        },
      },
    };
    return JSON.stringify({
      ...base,
      data: {
        ...base.data,
        attributes: {
          ...base.data.attributes,
          ...(overrides.type ? { type: overrides.type } : {}),
          data: {
            ...base.data.attributes.data,
            ...(overrides.id ? { id: overrides.id } : {}),
            attributes: {
              ...base.data.attributes.data.attributes,
              ...(overrides.external_reference_number
                ? { external_reference_number: overrides.external_reference_number }
                : {}),
              ...(overrides.payment_intent_id ? { payment_intent_id: overrides.payment_intent_id } : {}),
            },
          },
        },
      },
    });
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

  it('ignores payment when deposit cannot be found and does not call fallback', async () => {
    const depositFindUniqueMock = prismaMock.deposit.findUnique as jest.Mock;
    depositFindUniqueMock.mockResolvedValueOnce(null);

    const rawBody = makePaymentPaidEvent({ external_reference_number: 'dep-missing', payment_intent_id: 'pi_missing' });

    const result = await service.processWebhookEvent(rawBody, 't=456,li=signature');

    expect(result).toEqual({ received: true, action: 'ignored' });
    expect(walletServiceMock.completeDeposit).not.toHaveBeenCalled();
    expect(depositFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});
