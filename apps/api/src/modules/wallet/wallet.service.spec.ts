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
import { CryptoVerificationService } from './crypto-verification.service';
import { GamificationService } from '../gamification/gamification.service';
import { ReferralsService } from '../referrals/referrals.service';

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
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
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

  const prismaPlatformConfigMock = {
    findMany: jest.fn().mockResolvedValue([
      { key: 'usdt_bep20_enabled', value: true },
      { key: 'usdt_bep20_wallet_address', value: '0xb6a1022f84f16a41a1f066f0e0fa6c89af8f941e' },
      { key: 'usdt_base_enabled', value: true },
      { key: 'usdt_base_wallet_address', value: '0xb6a1022f84f16a41a1f066f0e0fa6c89af8f941e' },
    ]),
    findUnique: jest.fn().mockResolvedValue({ value: 5000 }),
  };

  const prismaDepositPackageMock = {
    findUnique: jest.fn(),
  };

  const prismaWalletChallengeMock = {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
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
            depositPackage: prismaDepositPackageMock,
            platformConfig: prismaPlatformConfigMock,
            transaction: prismaTransactionMock,
            user: prismaUserMock,
            walletChallenge: prismaWalletChallengeMock,
            withTransaction: jest.fn((cb: (tx: unknown) => unknown) =>
              cb({
                wallet: prismaWalletMock,
                deposit: prismaDepositMock,
                transaction: prismaTransactionMock,
                user: prismaUserMock,
              }),
            ),
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
        {
          provide: CryptoVerificationService,
          useValue: { verifyDeposit: jest.fn().mockResolvedValue({ valid: true }) },
        },
        {
          provide: GamificationService,
          useValue: {
            awardVp: jest.fn().mockResolvedValue({ newVp: 0, tierUp: false, newTier: null }),
          },
        },
        {
          provide: ReferralsService,
          useValue: {
            checkMilestones: jest.fn().mockResolvedValue(undefined),
          },
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

// ─── Crypto deposit binding (release gate) ──────────────────

  describe('PayMongo PHP minimum / package charge consistency', () => {
    const currencyMock = () => (service as unknown as { currency: { getUsdToPhp: jest.Mock } }).currency;

    const DEFAULT_CONFIGS = [
      { key: 'usdt_bep20_enabled', value: true },
      { key: 'usdt_bep20_wallet_address', value: '0xb6a1022f84f16a41a1f066f0e0fa6c89af8f941e' },
      { key: 'usdt_base_enabled', value: true },
      { key: 'usdt_base_wallet_address', value: '0xb6a1022f84f16a41a1f066f0e0fa6c89af8f941e' },
    ];
    afterEach(() => {
      prismaPlatformConfigMock.findMany.mockResolvedValue(DEFAULT_CONFIGS);
    });

    const pkg = (over: Record<string, unknown> = {}) => ({
      id: 'pkg-1',
      usdAmount: 1,
      label: null,
      isActive: true,
      isPopular: false,
      bonusCredits: 0,
      methods: [] as string[],
      sortOrder: 1,
      ...over,
    });

    it('$1 package at rate 63.46 qualifies — derived min equals the exact charge', async () => {
      currencyMock().getUsdToPhp.mockResolvedValue(63.46);
      const options = await service.getDepositOptions();
      expect(options.pricing.minDepositPhp).toBeCloseTo(63.46, 2);
      // Charge uses identical rounding — 6346c >= 6346c.
      prismaPlatformConfigMock.findMany.mockResolvedValue([
        ...DEFAULT_CONFIGS,
        { key: 'paymongo_enabled', value: true },
      ]);
      prismaDepositPackageMock.findUnique.mockResolvedValue(pkg());
      prismaDepositMock.findFirst.mockResolvedValue(null);
      prismaDepositMock.create.mockResolvedValue({ id: 'dep-x' });
      const res = await service.initiateDeposit('user-1', { method: 'PAYMONGO', packageId: 'pkg-1' } as never);
      expect(prismaDepositMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amountFiat: 63.46, currency: 'PHP' }) }),
      );
      expect(res).toBeTruthy();
    });

    it('explicitly configured ₱64 minimum is still enforced', async () => {
      currencyMock().getUsdToPhp.mockResolvedValue(63.46);
      prismaPlatformConfigMock.findMany.mockResolvedValue([
        ...DEFAULT_CONFIGS,
        { key: 'paymongo_enabled', value: true },
        { key: 'min_deposit_php', value: 64 },
        { key: 'min_deposit_usd', value: 1 },
      ]);
      const options = await service.getDepositOptions();
      expect(options.pricing.minDepositPhp).toBe(64);
      prismaDepositPackageMock.findUnique.mockResolvedValue(pkg());
      prismaDepositMock.findFirst.mockResolvedValue(null);
      await expect(
        service.initiateDeposit('user-1', { method: 'PAYMONGO', packageId: 'pkg-1' } as never),
      ).rejects.toThrow('Minimum deposit is ₱64 PHP');
    });

    it('₱1 PayMongo-only package bypasses the derived minimum', async () => {
      currencyMock().getUsdToPhp.mockResolvedValue(63.46);
      prismaPlatformConfigMock.findMany.mockResolvedValue([
        ...DEFAULT_CONFIGS,
        { key: 'paymongo_enabled', value: true },
      ]);
      prismaDepositPackageMock.findUnique.mockResolvedValue(
        pkg({ usdAmount: 0.01, methods: ['PAYMONGO'] }),
      );
      prismaDepositMock.findFirst.mockResolvedValue(null);
      prismaDepositMock.create.mockResolvedValue({ id: 'dep-y' });
      await service.initiateDeposit('user-1', { method: 'PAYMONGO', packageId: 'pkg-1' } as never);
      expect(prismaDepositMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amountFiat: 1, currency: 'PHP' }) }),
      );
    });

    it('half-centavo boundary: $1 at rate 60.025 — displayed charge, checkout charge, and floor agree', async () => {
      currencyMock().getUsdToPhp.mockResolvedValue(60.025);
      const options = await service.getDepositOptions();
      // 6002.5 centavos → one integer-centavo rounding for floor AND charge.
      expect(options.pricing.minDepositPhp).toBeCloseTo(60.03, 2);
      prismaPlatformConfigMock.findMany.mockResolvedValue([
        ...DEFAULT_CONFIGS,
        { key: 'paymongo_enabled', value: true },
      ]);
      prismaDepositPackageMock.findUnique.mockResolvedValue(pkg());
      prismaDepositMock.findFirst.mockResolvedValue(null);
      prismaDepositMock.create.mockResolvedValue({ id: 'dep-z' });
      await service.initiateDeposit('user-1', { method: 'PAYMONGO', packageId: 'pkg-1' } as never);
      expect(prismaDepositMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amountFiat: 60.03, currency: 'PHP' }) }),
      );
    });

    it('rate change before checkout re-derives the quoted charge and minimum', async () => {
      currencyMock().getUsdToPhp.mockResolvedValueOnce(63.46).mockResolvedValueOnce(60.0);
      const first = await service.getDepositOptions();
      const second = await service.getDepositOptions();
      expect(first.pricing.minDepositPhp).toBeCloseTo(63.46, 2);
      expect(second.pricing.minDepositPhp).toBeCloseTo(60.0, 2);
    });
  });

describe('crypto deposit binding', () => {
  const VALID_HASH = '0x' + 'ab'.repeat(32);
  const WALLET_A = '0x' + '11'.repeat(20);
  const WALLET_B = '0x' + '22'.repeat(20);

  const baseDeposit = {
    id: 'dep-1',
    userId: 'user-1',
    method: DepositMethod.USDT_BEP20,
    status: DepositStatus.PENDING,
    amountFiat: 5,
    paymentRef: null,
    userWalletAddress: WALLET_A,
    createdAt: new Date(),
    package: { usdAmount: 5 },
  };

  beforeEach(() => {
    prismaDepositPackageMock.findUnique.mockResolvedValue({ id: 'pkg-1', isActive: true, usdAmount: 5, bonusCredits: 0 });
    prismaDepositMock.findFirst = jest.fn().mockResolvedValue(null); // no pending deposit
    prismaDepositMock.findMany = jest.fn().mockResolvedValue([]);
  });

  describe('initiate', () => {
    it('rejects crypto deposits without a declared wallet address', async () => {
      await expect(
        service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalizes a mixed-case txHash to lowercase before storing', async () => {
      const mixed = '0x' + 'AB'.repeat(32);
      prismaDepositMock.create = jest.fn().mockResolvedValue(baseDeposit);
      await service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20', txHash: mixed, userWalletAddress: WALLET_A } as never);
      expect(prismaDepositMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentRef: VALID_HASH }) }),
      );
    });

    it('maps a paymentRef unique collision (casing variant of a claimed hash) to a 400', async () => {
      prismaDepositMock.create = jest.fn().mockRejectedValue({ code: 'P2002' });
      await expect(
        service.initiateDeposit('user-2', { packageId: 'pkg-1', method: 'USDT_BEP20', txHash: '0x' + 'AB'.repeat(32), userWalletAddress: WALLET_B } as never),
      ).rejects.toThrow('already been submitted');
    });
  });

  describe('submitTxHash', () => {
    it('rejects a hash claim on another account\'s deposit', async () => {
      prismaDepositMock.findUnique.mockResolvedValue(baseDeposit);
      await expect(service.submitTxHash('attacker', 'dep-1', VALID_HASH)).rejects.toThrow('Not your deposit');
      expect(prismaDepositMock.updateMany).not.toHaveBeenCalled();
    });

    it('stores the hash lowercased so casing variants cannot double-claim', async () => {
      prismaDepositMock.findUnique.mockResolvedValue(baseDeposit);
      prismaDepositMock.updateMany.mockResolvedValue({ count: 1 });
      await service.submitTxHash('user-1', 'dep-1', '0x' + 'AB'.repeat(32));
      expect(prismaDepositMock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentRef: VALID_HASH }) }),
      );
    });

    it('rejects submissions when the paying wallet is unknown and not supplied', async () => {
      prismaDepositMock.findUnique.mockResolvedValue({ ...baseDeposit, userWalletAddress: null });
      await expect(service.submitTxHash('user-1', 'dep-1', VALID_HASH)).rejects.toThrow('wallet address');
    });

    it('accepts a wallet address at submission for legacy deposits', async () => {
      prismaDepositMock.findUnique.mockResolvedValue({ ...baseDeposit, userWalletAddress: null });
      prismaDepositMock.updateMany.mockResolvedValue({ count: 1 });
      await service.submitTxHash('user-1', 'dep-1', VALID_HASH, WALLET_A);
      expect(prismaDepositMock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userWalletAddress: WALLET_A }) }),
      );
    });

    it('maps a concurrent duplicate-hash claim (P2002) to a 400', async () => {
      prismaDepositMock.findUnique.mockResolvedValue(baseDeposit);
      prismaDepositMock.updateMany.mockRejectedValue({ code: 'P2002' });
      await expect(service.submitTxHash('user-1', 'dep-1', VALID_HASH)).rejects.toThrow('already been submitted');
    });
  });

  describe('verifyCryptoDeposit', () => {
    const processing = { ...baseDeposit, status: DepositStatus.PROCESSING, paymentRef: VALID_HASH };

    it('refuses to verify a deposit with no declared wallet', async () => {
      prismaDepositMock.findUnique.mockResolvedValue({ ...processing, userWalletAddress: null });
      await expect(service.verifyCryptoDeposit('user-1', 'dep-1')).rejects.toThrow('wallet');
    });

    it('binds the declared wallet and deposit creation time to on-chain verification', async () => {
      const cryptoMock = (service as never as { cryptoVerification: { verifyDeposit: jest.Mock } }).cryptoVerification;
      cryptoMock.verifyDeposit.mockResolvedValueOnce({ valid: false, error: 'forced for binding assertion' });
      prismaDepositMock.findUnique.mockResolvedValue(processing);
      await service.verifyCryptoDeposit('user-1', 'dep-1');
      expect(cryptoMock.verifyDeposit).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFromAddress: WALLET_A,
          notBeforeTimestamp: Math.floor(processing.createdAt.getTime() / 1000),
        }),
      );
    });
  });

  describe('wallet-ownership challenges', () => {
    const { Wallet: EthersWallet } = jest.requireActual<typeof import('ethers')>('ethers');
    const payer = EthersWallet.createRandom();
    const attacker = EthersWallet.createRandom();
    const PAYER_ADDR = payer.address;

    beforeEach(() => {
      prismaWalletChallengeMock.create.mockReset();
      prismaWalletChallengeMock.findUnique.mockReset();
      prismaWalletChallengeMock.updateMany.mockReset();
      prismaDepositMock.updateMany.mockReset().mockResolvedValue({ count: 1 });
      prismaDepositMock.update.mockReset().mockResolvedValue({});
      prismaDepositMock.findUnique.mockReset();
      prismaDepositMock.create = jest.fn();
    });

    const issueChallenge = async (wallet: string, depositId?: string) => {
      if (depositId) prismaDepositMock.findUnique.mockResolvedValue({ id: depositId, userId: 'user-1' });
      prismaWalletChallengeMock.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ch-1', ...data }));
      const out = await service.createWalletChallenge('user-1', 'USDT_BEP20', wallet, depositId);
      prismaWalletChallengeMock.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(where.nonce === out.nonce
          ? { id: 'ch-1', userId: 'user-1', wallet: wallet.toLowerCase(), chain: 'BSC', depositId: depositId ?? null, nonce: out.nonce, message: out.message, expiresAt: out.expiresAt, consumedAt: null }
          : null));
      return out;
    };

    it('issues a challenge bound to account, wallet, chain and deposit', async () => {
      const ch = await issueChallenge(PAYER_ADDR, 'dep-1');
      expect(ch.message).toContain(`Wallet: ${PAYER_ADDR.toLowerCase()}`);
      expect(ch.message).toContain('Chain: BSC');
      expect(ch.message).toContain('Deposit: dep-1');
      expect(ch.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('a valid signature marks the deposit walletVerified at initiation', async () => {
      const ch = await issueChallenge(PAYER_ADDR);
      const signature = await payer.signMessage(ch.message);
      prismaWalletChallengeMock.updateMany.mockResolvedValue({ count: 1 });
      prismaDepositMock.create = jest.fn().mockResolvedValue(baseDeposit);
      await service.initiateDeposit('user-1', {
        packageId: 'pkg-1', method: 'USDT_BEP20', userWalletAddress: PAYER_ADDR,
        challengeNonce: ch.nonce, signature,
      } as never);
      expect(prismaDepositMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ walletVerified: true }) }),
      );
    });

    it('signature is single-use — a second consume is rejected', async () => {
      const ch = await issueChallenge(PAYER_ADDR);
      const signature = await payer.signMessage(ch.message);
      prismaWalletChallengeMock.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prismaDepositMock.create = jest.fn().mockResolvedValue(baseDeposit);
      await service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20', userWalletAddress: PAYER_ADDR, challengeNonce: ch.nonce, signature } as never);
      await expect(
        service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20', userWalletAddress: PAYER_ADDR, challengeNonce: ch.nonce, signature } as never),
      ).rejects.toThrow('already used');
    });

    it('rejects a signature from a different wallet than declared', async () => {
      const ch = await issueChallenge(PAYER_ADDR);
      const sig = await attacker.signMessage(ch.message);
      await expect(
        service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20', userWalletAddress: PAYER_ADDR, challengeNonce: ch.nonce, signature: sig } as never),
      ).rejects.toThrow('does not match');
      expect(prismaDepositMock.create).not.toHaveBeenCalled();
    });

    it('rejects a challenge issued for a different deposit', async () => {
      const ch = await issueChallenge(PAYER_ADDR, 'dep-A');
      const signature = await payer.signMessage(ch.message);
      prismaDepositMock.findUnique.mockResolvedValue({ ...baseDeposit, id: 'dep-B', userWalletAddress: PAYER_ADDR });
      await expect(
        service.submitTxHash('user-1', 'dep-B', VALID_HASH, PAYER_ADDR, ch.nonce, signature),
      ).rejects.toThrow('different deposit');
    });

    it('rejects expired challenges', async () => {
      const ch = await issueChallenge(PAYER_ADDR);
      const signature = await payer.signMessage(ch.message);
      prismaWalletChallengeMock.findUnique.mockResolvedValue({
        id: 'ch-1', userId: 'user-1', wallet: PAYER_ADDR.toLowerCase(), chain: 'BSC', depositId: null,
        nonce: ch.nonce, message: ch.message, expiresAt: new Date(Date.now() - 1000), consumedAt: null,
      });
      await expect(
        service.initiateDeposit('user-1', { packageId: 'pkg-1', method: 'USDT_BEP20', userWalletAddress: PAYER_ADDR, challengeNonce: ch.nonce, signature } as never),
      ).rejects.toThrow('expired');
    });
  });

  describe('ownership gate on settlement', () => {
    const processing = { ...baseDeposit, status: DepositStatus.PROCESSING, paymentRef: VALID_HASH };

    beforeEach(() => {
      prismaDepositMock.findUnique.mockReset();
      prismaDepositMock.update.mockReset().mockResolvedValue({});
      prismaDepositMock.updateMany.mockReset().mockResolvedValue({ count: 1 });
    });

    it('second-account attack: unverified claim does not credit even when the transfer is valid', async () => {
      prismaDepositMock.findUnique.mockResolvedValue({ ...processing, userId: 'attacker', userWalletAddress: WALLET_A, walletVerified: false });
      const cryptoMock = (service as never as { cryptoVerification: { verifyDeposit: jest.Mock } }).cryptoVerification;
      cryptoMock.verifyDeposit.mockResolvedValueOnce({ valid: true, txHash: VALID_HASH, fromAddress: WALLET_A, confirmations: 20 });
      const completeSpy = jest.spyOn(service, 'completeDeposit').mockResolvedValue({} as never);
      const out = await service.verifyCryptoDeposit('attacker', 'dep-1');
      expect(out.needsReview).toBe(true);
      expect(completeSpy).not.toHaveBeenCalled();
      expect(prismaDepositMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gatewayData: expect.objectContaining({ needsReview: true, claimedFrom: WALLET_A }) }) }),
      );
    });

    it('signature-verified deposit auto-completes on a valid transfer', async () => {
      prismaDepositMock.findUnique.mockResolvedValue({ ...processing, walletVerified: true });
      const cryptoMock = (service as never as { cryptoVerification: { verifyDeposit: jest.Mock } }).cryptoVerification;
      cryptoMock.verifyDeposit.mockResolvedValueOnce({ valid: true, txHash: VALID_HASH, fromAddress: WALLET_A, confirmations: 20 });
      const completeSpy = jest.spyOn(service, 'completeDeposit').mockResolvedValue({} as never);
      const out = await service.verifyCryptoDeposit('user-1', 'dep-1');
      expect(out.status).toBe('COMPLETED');
      expect(completeSpy).toHaveBeenCalledWith('dep-1', { paymentRef: VALID_HASH });
    });

    it('sender mismatch releases the reserved hash so the rightful owner can claim it', async () => {
      prismaDepositMock.findUnique.mockResolvedValue(processing);
      const cryptoMock = (service as never as { cryptoVerification: { verifyDeposit: jest.Mock } }).cryptoVerification;
      cryptoMock.verifyDeposit.mockResolvedValueOnce({ valid: false, error: 'Transaction was not sent from the wallet declared on this deposit' });
      const out = await service.verifyCryptoDeposit('user-1', 'dep-1');
      expect(out.status).toBe('PENDING');
      expect(prismaDepositMock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dep-1', status: DepositStatus.PROCESSING, paymentRef: VALID_HASH },
          data: { status: DepositStatus.PENDING, paymentRef: null },
        }),
      );
    });
  });
});
});