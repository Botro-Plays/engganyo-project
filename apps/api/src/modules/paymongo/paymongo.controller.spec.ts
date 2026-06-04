import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DepositMethod, DepositStatus, UserRole, UserStatus } from '@prisma/client';

import { PayMongoController } from './paymongo.controller';
import { PayMongoService } from './paymongo.service';
import { WalletService } from '../wallet/wallet.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

describe('PayMongoController', () => {
  let controller: PayMongoController;

  const createPaymentLinkMock = jest.fn<
    ReturnType<PayMongoService['createPaymentLink']>,
    Parameters<PayMongoService['createPaymentLink']>
  >();
  const getDepositForUserMock = jest.fn<
    ReturnType<WalletService['getDepositForUser']>,
    Parameters<WalletService['getDepositForUser']>
  >();

  const paymongoService: Pick<PayMongoService, 'createPaymentLink'> = {
    createPaymentLink: createPaymentLinkMock,
  };
  const walletService: Pick<WalletService, 'getDepositForUser'> = {
    getDepositForUser: getDepositForUserMock,
  };

  beforeEach(async () => {
    createPaymentLinkMock.mockReset();
    getDepositForUserMock.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayMongoController],
      providers: [
        { provide: PayMongoService, useValue: paymongoService },
        { provide: WalletService, useValue: walletService },
      ],
    }).compile();

    controller = module.get(PayMongoController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const user: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    username: 'user1',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  };

  it('throws BadRequestException when depositId missing', async () => {
    await expect(controller.createLink(user, { depositId: '' })).rejects.toThrow(BadRequestException);
    expect(walletService.getDepositForUser).not.toHaveBeenCalled();
  });

  type Deposit = NonNullable<Awaited<ReturnType<WalletService['getDepositForUser']>>>;

  const makeDeposit = (overrides: Partial<Deposit> = {}): Deposit => ({
    id: 'dep-1',
    userId: 'user-1',
    method: DepositMethod.PAYMONGO,
    status: DepositStatus.PENDING,
    amountFiat: 50,
    currency: 'PHP',
    creditsToAward: 500,
    bonusCredits: 0,
    ...overrides,
  });

  it('throws ForbiddenException when deposit not found for user', async () => {
    getDepositForUserMock.mockResolvedValue(null);

    await expect(controller.createLink(user, { depositId: 'dep-1' })).rejects.toThrow(ForbiddenException);

    expect(getDepositForUserMock).toHaveBeenCalledWith('user-1', 'dep-1');
    expect(createPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when deposit is not PayMongo', async () => {
    getDepositForUserMock.mockResolvedValue(makeDeposit({ method: DepositMethod.PAYPAL }));

    await expect(controller.createLink(user, { depositId: 'dep-1' })).rejects.toThrow(BadRequestException);

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when deposit status is terminal', async () => {
    getDepositForUserMock.mockResolvedValue(makeDeposit({ status: DepositStatus.COMPLETED }));

    await expect(controller.createLink(user, { depositId: 'dep-1' })).rejects.toThrow(BadRequestException);

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('creates payment link with derived amount and description', async () => {
    getDepositForUserMock.mockResolvedValue(makeDeposit({ amountFiat: 123.45, creditsToAward: 1500 }));

    createPaymentLinkMock.mockResolvedValue({ linkId: 'link-1', checkoutUrl: 'https://paymongo.test/link-1' });

    const result = await controller.createLink(user, { depositId: 'dep-1' });

    expect(createPaymentLinkMock).toHaveBeenCalledWith(
      'dep-1',
      12345,
      expect.stringContaining('1500'),
      'PHP',
    );
    expect(result).toEqual({ linkId: 'link-1', checkoutUrl: 'https://paymongo.test/link-1' });
  });
});
