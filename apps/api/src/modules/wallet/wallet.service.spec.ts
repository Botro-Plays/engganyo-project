import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepositMethod, DepositStatus, TransactionType, TransactionStatus } from '@prisma/client';

import { WalletService, CreditOptions } from './wallet.service';
import { PrismaService } from '../../database/prisma.service';
import { CurrencyService } from './currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { PayMongoService } from '../paymongo/paymongo.service';
import { PayPalService } from '../paypal/paypal.service';

const MOCK_WALLET = {
  id: 'wallet-1',
  balance: 1000,
  version: 1,
  lifetimeEarned: 5000,
  lifetimeSpent: 4000,
};

const MOCK_TRANSACTION = {
  id: 'tx-1',
  walletId: MOCK_WALLET.id,
  type: TransactionType.EARN_TASK_COMPLETION,
  status: TransactionStatus.COMPLETED,
  amount: 100,
  balanceBefore: 1000,
  balanceAfter: 1100,
  description: 'Test credit',
  referenceId: null,
  referenceType: null,
  metadata: null,
  createdAt: new Date(),
};

const CREDIT_OPTS: CreditOptions = {
  type: TransactionType.EARN_TASK_COMPLETION,
  description: 'Test credit',
};

const paymongoServiceMock = {
  archiveLink: jest.fn().mockResolvedValue(true),
};

describe('WalletService', () => {
  let service: WalletService;
  let prisma: jest.Mocked<PrismaService>;

  const prismaWalletMock = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };

  const prismaDepositMock = {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };

  const prismaTransactionMock = {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  };

  const prismaUserMock = {
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: PrismaService,
          useValue: {
            wallet: prismaWalletMock,
            deposit: prismaDepositMock,
            transaction: prismaTransactionMock,
            user: prismaUserMock,
            withTransaction: jest.fn(),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            getUsdToPhp: jest.fn().mockResolvedValue(56.5),
            getUsdToRate: jest.fn().mockResolvedValue(56.5),
            getRates: jest.fn().mockResolvedValue({ usdToPhp: 56.5, usdToEur: 0.92, usdToSgd: 1.35, usdToGbp: 0.79 }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: EventsService,
          useValue: {
            emitToUser: jest.fn(),
            emitToRoom: jest.fn(),
            emitBroadcast: jest.fn(),
          },
        },
        {
          provide: PayMongoService,
          useValue: paymongoServiceMock,
        },
        {
          provide: PayPalService,
          useValue: { cancelOrder: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getWallet ──────────────────────────────────────────────

  describe('getWallet', () => {
    it('returns wallet when found', async () => {
      prismaWalletMock.findUnique.mockResolvedValue(MOCK_WALLET);
      const result = await service.getWallet('user-1');
      expect(result).toBe(MOCK_WALLET);
      expect(prismaWalletMock.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it('throws NotFoundException when wallet does not exist', async () => {
      prismaWalletMock.findUnique.mockResolvedValue(null);
      await expect(service.getWallet('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── credit ─────────────────────────────────────────────────

  describe('credit', () => {
    it('throws BadRequestException for amount <= 0', async () => {
      await expect(service.credit('user-1', 0, CREDIT_OPTS)).rejects.toThrow(BadRequestException);
      await expect(service.credit('user-1', -50, CREDIT_OPTS)).rejects.toThrow(BadRequestException);
    });

    it('credits successfully via optimistic lock', async () => {
      prismaWalletMock.findUnique.mockResolvedValue(MOCK_WALLET);
      prismaUserMock.update.mockResolvedValue({});

      (prisma.withTransaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof prisma) => Promise<unknown>) => {
          const fakeTx = {
            wallet: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            transaction: {
              create: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
            },
            user: {
              update: jest.fn().mockResolvedValue({}),
            },
          };
          return cb(fakeTx as unknown as typeof prisma);
        },
      );

      const result = await service.credit('user-1', 100, CREDIT_OPTS);
      expect(result).toEqual(MOCK_TRANSACTION);
    });

    it('throws NotFoundException when wallet missing during optimistic lock', async () => {
      prismaWalletMock.findUnique.mockResolvedValue(null);
      await expect(service.credit('user-1', 100, CREDIT_OPTS)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── debit ──────────────────────────────────────────────────

  describe('debit', () => {
    it('throws BadRequestException for amount <= 0', async () => {
      await expect(
        service.debit('user-1', -1, { type: TransactionType.SPEND_CAMPAIGN_CREATE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for insufficient balance', async () => {
      prismaWalletMock.findUnique.mockResolvedValue({ ...MOCK_WALLET, balance: 50 });

      (prisma.withTransaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof prisma) => Promise<unknown>) => {
          const fakeTx = {
            wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            transaction: { create: jest.fn().mockResolvedValue(MOCK_TRANSACTION) },
            user: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(fakeTx as unknown as typeof prisma);
        },
      );

      await expect(
        service.debit('user-1', 200, { type: TransactionType.SPEND_CAMPAIGN_CREATE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelDeposit', () => {
    it('atomically cancels deposit with status guard and archives link', async () => {
      const existing = {
        id: 'dep-1',
        userId: 'user-1',
        status: DepositStatus.PENDING,
        method: DepositMethod.PAYMONGO,
        paymentRef: 'plink_123',
        gatewayData: { foo: 'bar' },
      };

      const updated = {
        ...existing,
        status: DepositStatus.CANCELLED,
        adminNotes: 'Cancelled by user',
        gatewayData: { foo: 'bar', cancelledAt: '2026-06-06T00:00:00.000Z', cancelledBy: 'user-1' },
      };

      prismaDepositMock.findUnique.mockResolvedValue(existing);
      prismaDepositMock.updateMany.mockResolvedValue({ count: 1 });
      prismaDepositMock.update.mockResolvedValue(updated);

      const result = await service.cancelDeposit('user-1', 'dep-1');

      expect(result).toBe(updated);
      // Step 1: atomic status guard
      expect(prismaDepositMock.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dep-1',
          status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
        },
        data: { status: DepositStatus.CANCELLED },
      });
      // Step 2: update metadata
      expect(prismaDepositMock.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: expect.objectContaining({
          adminNotes: 'Cancelled by user',
          gatewayData: expect.objectContaining({
            cancelledAt: expect.any(String),
            cancelledBy: 'user-1',
          }),
        }),
      });
      expect(paymongoServiceMock.archiveLink).toHaveBeenCalledWith('plink_123');
    });

    it('aborts cancel when deposit was already processed (race guard)', async () => {
      const existing = {
        id: 'dep-1',
        userId: 'user-1',
        status: DepositStatus.PENDING,
        method: DepositMethod.PAYMONGO,
        paymentRef: 'plink_123',
        gatewayData: {},
      };

      prismaDepositMock.findUnique.mockResolvedValue(existing);
      prismaDepositMock.updateMany.mockResolvedValue({ count: 0 });
      // Simulate webhook completed the deposit right before our cancel
      prismaDepositMock.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, status: DepositStatus.COMPLETED });

      await expect(service.cancelDeposit('user-1', 'dep-1')).rejects.toThrow(BadRequestException);
      expect(prismaDepositMock.update).not.toHaveBeenCalled();
    });
  });
});
