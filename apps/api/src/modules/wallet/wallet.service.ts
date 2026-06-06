import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Prisma, DepositMethod, DepositStatus, TransactionType, TransactionStatus, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CurrencyService } from './currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { PayMongoService } from '../paymongo/paymongo.service';
import type { GetTransactionsDto } from './dto/get-transactions.dto';
import type { InitiateDepositDto } from './dto/initiate-deposit.dto';
import type { ListDepositsDto } from './dto/list-deposits.dto';

// ─── Internal operation types ──────────────────────────────────
export interface CreditOptions {
  type: TransactionType;
  description?: string;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
}

export interface DebitOptions {
  type: TransactionType;
  description?: string;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
}

// ─── Constants ─────────────────────────────────────────────────
const MAX_RETRY = 5;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => PayMongoService))
    private readonly payMongoService: PayMongoService,
  ) {}

  // ─── Public read operations ────────────────────────────────

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
        lifetimeEarned: true,
        lifetimeSpent: true,
        updatedAt: true,
      },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getTransactions(userId: string, dto: GetTransactionsDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      walletId: wallet.id,
      ...(dto.type && { type: dto.type }),
      ...(dto.status && { status: dto.status }),
      ...(dto.referenceId && { referenceId: dto.referenceId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          description: true,
          referenceId: true,
          referenceType: true,
          createdAt: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async getTransaction(userId: string, transactionId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, walletId: wallet.id },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  // ─── Credit (internal — used by other services) ────────────

  async credit(userId: string, amount: number, opts: CreditOptions) {
    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');
    return this.executeWithOptimisticLock(userId, amount, 'credit', opts);
  }

  // ─── Debit (internal — used by other services) ─────────────

  async debit(userId: string, amount: number, opts: DebitOptions) {
    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');
    return this.executeWithOptimisticLock(userId, amount, 'debit', opts);
  }

  // ─── Optimistic-locking engine ─────────────────────────────

  private async executeWithOptimisticLock(
    userId: string,
    amount: number,
    direction: 'credit' | 'debit',
    opts: CreditOptions | DebitOptions,
  ) {
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { id: true, balance: true, version: true },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      if (direction === 'debit' && wallet.balance < amount) {
        throw new BadRequestException('Insufficient credit balance');
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = direction === 'credit'
        ? balanceBefore + amount
        : balanceBefore - amount;

      try {
        const result = await this.prisma.withTransaction(async (tx) => {
          const updated = await tx.wallet.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: {
              balance: balanceAfter,
              version: { increment: 1 },
              ...(direction === 'credit' && { lifetimeEarned: { increment: amount } }),
              ...(direction === 'debit' && { lifetimeSpent: { increment: amount } }),
            },
          });

          if (updated.count === 0) {
            throw new Error('OPTIMISTIC_LOCK_CONFLICT');
          }

          const transaction = await tx.transaction.create({
            data: {
              walletId: wallet.id,
              type: opts.type,
              status: TransactionStatus.COMPLETED,
              amount: direction === 'credit' ? amount : -amount,
              balanceBefore,
              balanceAfter,
              description: opts.description,
              referenceId: opts.referenceId,
              referenceType: opts.referenceType,
              metadata: opts.metadata ? (opts.metadata as object) : undefined,
            },
          });

          // Keep denormalized creditBalance on user in sync
          await tx.user.update({
            where: { id: userId },
            data: { creditBalance: balanceAfter },
          });

          return transaction;
        });

        return result;
      } catch (err) {
        if (err instanceof Error && err.message === 'OPTIMISTIC_LOCK_CONFLICT') {
          this.logger.warn(`Optimistic lock conflict for userId=${userId}, attempt=${attempt}`);
          if (attempt === MAX_RETRY) {
            throw new BadRequestException('Transaction failed after retries. Please try again.');
          }
          await new Promise((r) => setTimeout(r, 50 * attempt));
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('Transaction failed.');
  }

  // ─── Deposit system ────────────────────────────────────────

  async getDepositOptions() {
    const keys = [
      'paymongo_enabled', 'paymongo_public_key',
      'paypal_enabled', 'paypal_client_id', 'paypal_mode',
      'usdt_bep20_enabled', 'usdt_bep20_wallet_address', 'usdt_bep20_contract',
      'usdt_base_enabled',  'usdt_base_wallet_address',  'usdt_base_contract',
      'credits_per_usd', 'min_deposit_usd',
    ];
    const [configs, usdToPhp] = await Promise.all([
      this.prisma.platformConfig.findMany({ where: { key: { in: keys } } }),
      this.currency.getUsdToPhp(),
    ]);
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    const creditsPerUsd = (map['credits_per_usd'] as number) ?? 5000;
    const minDepositUsd = (map['min_deposit_usd'] as number) ?? 1;

    return {
      paymongo:  { enabled: Boolean(map['paymongo_enabled'] ?? false),  publicKey: (map['paymongo_public_key'] as string) ?? null },
      paypal:    { enabled: Boolean(map['paypal_enabled'] ?? false),    clientId: (map['paypal_client_id'] as string) ?? null, mode: (map['paypal_mode'] as string) ?? 'sandbox' },
      usdtBep20: {
        enabled: Boolean(map['usdt_bep20_enabled'] ?? false),
        walletAddress: (map['usdt_bep20_wallet_address'] as string) ?? null,
        contractAddress: (map['usdt_bep20_contract'] as string) ?? '0x55d398326f99059fF775485246999027B3197955',
        chainId: 56,
        network: 'BNB Smart Chain (BEP20)',
      },
      usdtBase: {
        enabled: Boolean(map['usdt_base_enabled'] ?? false),
        walletAddress: (map['usdt_base_wallet_address'] as string) ?? null,
        contractAddress: (map['usdt_base_contract'] as string) ?? '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
        chainId: 8453,
        network: 'Base Network',
      },
      pricing: {
        creditsPerUsd,
        minDepositUsd,
        usdToPhp,
        minDepositPhp: Math.ceil(minDepositUsd * usdToPhp),
        creditsPerPhp: creditsPerUsd / usdToPhp,
      },
      liveRates: { usdToPhp, rateSource: 'frankfurter.app', baseCurrency: 'USD' },
    };
  }

  async getPackages() {
    const [packages, creditsPerUsdConfig] = await Promise.all([
      this.prisma.depositPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'credits_per_usd' } }),
    ]);
    const [creditsPerUsd, usdToPhp] = await Promise.all([
      Promise.resolve((creditsPerUsdConfig?.value as number) ?? 5000),
      this.currency.getUsdToPhp(),
    ]);
    return packages.map((pkg) => {
      const creditsBase = Math.floor(pkg.usdAmount * creditsPerUsd);
      return {
        id: pkg.id,
        usdAmount: pkg.usdAmount,
        bonusCredits: pkg.bonusCredits,
        creditsBase,
        creditsTotal: creditsBase + pkg.bonusCredits,
        label: pkg.label,
        isPopular: pkg.isPopular,
        phpEquivalent: Math.ceil(pkg.usdAmount * usdToPhp),
        usdToPhp,
      };
    });
  }

  async initiateDeposit(userId: string, dto: InitiateDepositDto) {
    const [options, pkg] = await Promise.all([
      this.getDepositOptions(),
      this.prisma.depositPackage.findUnique({ where: { id: dto.packageId } }),
    ]);

    if (!pkg || !pkg.isActive) throw new BadRequestException('Deposit package not found or unavailable');

    const { method, txHash, userWalletAddress } = dto;
    const methodConfigs: Record<string, { enabled: boolean; walletAddress?: string | null }> = {
      PAYMONGO:   options.paymongo,
      PAYPAL:     options.paypal,
      USDT_BEP20: options.usdtBep20,
      USDT_BASE:  options.usdtBase,
    };
    const cfg = methodConfigs[method as string];
    if (!cfg?.enabled) throw new BadRequestException(`${method} deposits are not currently available`);

    const { creditsPerUsd, usdToPhp } = options.pricing;
    const isPhp = method === 'PAYMONGO';
    const rawAmountPhp = parseFloat((pkg.usdAmount * usdToPhp).toFixed(2));
    const amountFiat = isPhp ? Math.max(1, rawAmountPhp) : pkg.usdAmount;
    const currency   = isPhp ? 'PHP' : 'USD';
    const creditsBase   = Math.floor(pkg.usdAmount * creditsPerUsd);
    const creditsToAward = creditsBase + pkg.bonusCredits;

    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        packageId: pkg.id,
        method: method as DepositMethod,
        status: txHash ? DepositStatus.PROCESSING : DepositStatus.PENDING,
        amountFiat,
        currency,
        creditsToAward,
        bonusCredits: pkg.bonusCredits,
        creditsAwarded: 0,
        exchangeRate: isPhp ? usdToPhp : null,
        paymentRef: txHash ?? null,
        userWalletAddress: userWalletAddress ?? null,
      },
    });

    let instructions: Record<string, unknown> = {};
    const isCrypto = method === 'USDT_BEP20' || method === 'USDT_BASE';
    const cryptoCfg = method === 'USDT_BEP20' ? options.usdtBep20 : options.usdtBase;

    if (method === 'PAYMONGO') {
      instructions = { type: 'PAYMENT_LINK', depositId: deposit.id, message: 'Complete your payment in the PayMongo checkout page. The link is available below.' };
    } else if (method === 'PAYPAL') {
      instructions = { type: 'REDIRECT', depositId: deposit.id, message: 'Complete your payment in the PayPal checkout page. The link is available below.' };
    } else if (isCrypto) {
      instructions = {
        type: txHash ? 'CRYPTO_SUBMITTED' : 'CRYPTO_ADDRESS',
        depositId: deposit.id,
        walletAddress: cryptoCfg.walletAddress ?? null,
        network: cryptoCfg.network,
        token: 'USDT',
        amount: pkg.usdAmount,
        txHash: txHash ?? null,
        message: txHash
          ? `Your transaction has been submitted (${txHash}). Admin will verify and credit your account shortly.`
          : `Send exactly ${pkg.usdAmount} USDT on ${cryptoCfg.network} to the address above. Submit your TX hash after sending.`,
      };
    }

    return {
      deposit: {
        id: deposit.id, method: deposit.method, status: deposit.status,
        amountFiat: deposit.amountFiat, currency: deposit.currency,
        creditsToAward: deposit.creditsToAward, bonusCredits: deposit.bonusCredits,
        createdAt: deposit.createdAt,
      },
      instructions,
    };
  }

  async getUserDeposits(userId: string, dto: ListDepositsDto) {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.deposit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, method: true, status: true,
          amountFiat: true, currency: true,
          creditsToAward: true, creditsAwarded: true, bonusCredits: true,
          exchangeRate: true, paymentRef: true, adminNotes: true,
          gatewayData: true,
          completedAt: true, createdAt: true,
          package: { select: { usdAmount: true, label: true } },
        },
      }),
      this.prisma.deposit.count({ where: { userId } }),
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
  }

  async getDepositForUser(userId: string, depositId: string) {
    return this.prisma.deposit.findFirst({
      where: { id: depositId, userId },
      select: {
        id: true,
        userId: true,
        method: true,
        status: true,
        amountFiat: true,
        currency: true,
        creditsToAward: true,
        bonusCredits: true,
      },
    });
  }

  // ─── Cancel a deposit (user-initiated or QR expired) ────────

  async cancelDeposit(userId: string, depositId: string) {
    const { deposit } = await this.prisma.withTransaction(async (tx) => {
      const existing = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!existing) throw new NotFoundException('Deposit not found');
      if (existing.userId !== userId) throw new BadRequestException('Not your deposit');
      if (existing.status !== DepositStatus.PENDING && existing.status !== DepositStatus.PROCESSING) {
        throw new BadRequestException(`Cannot cancel a deposit with status ${existing.status}`);
      }

      const baseGatewayData =
        existing.gatewayData && typeof existing.gatewayData === 'object' && !Array.isArray(existing.gatewayData)
          ? (existing.gatewayData as Prisma.JsonObject)
          : ({} as Prisma.JsonObject);
      const updatedGatewayData: Prisma.JsonObject = {
        ...baseGatewayData,
        cancelledAt: new Date().toISOString(),
        cancelledBy: userId,
      };

      const updatedDeposit = await tx.deposit.update({
        where: { id: depositId },
        data: {
          status: DepositStatus.CANCELLED,
          adminNotes: 'Cancelled by user',
          gatewayData: updatedGatewayData,
        },
      });

      return { deposit: updatedDeposit };
    });

    // Archive PayMongo link so it can't be paid anymore (best-effort, after status flip)
    if (deposit.method === DepositMethod.PAYMONGO && deposit.paymentRef) {
      try {
        await this.payMongoService.archiveLink(deposit.paymentRef);
      } catch (err) {
        this.logger.warn(`Failed to archive PayMongo link ${deposit.paymentRef} during cancel: ${String(err)}`);
      }
    }

    this.eventsService.emitToUser(userId, 'deposit:updated', { depositId, status: DepositStatus.CANCELLED });
    return deposit;
  }

  // ─── Complete a deposit (used by webhooks & admin review) ──

  async completeDeposit(
    depositId: string,
    opts: { paymentRef?: string; reviewedBy?: string; adminNotes?: string } = {},
  ) {
    const { deposit, wallet, notification } = await this.prisma.withTransaction(async (tx) => {
      const existing = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!existing) throw new NotFoundException('Deposit not found');
      if (existing.status === DepositStatus.COMPLETED) throw new BadRequestException('Deposit already completed');
      if (existing.status === DepositStatus.CANCELLED) throw new BadRequestException('Deposit was cancelled');
      if (existing.status === DepositStatus.FAILED) throw new BadRequestException('Deposit was failed');

      const txType =
        existing.method === DepositMethod.PAYMONGO ? TransactionType.DEPOSIT_PAYMONGO
        : existing.method === DepositMethod.PAYPAL ? TransactionType.DEPOSIT_PAYPAL
        : TransactionType.DEPOSIT_CRYPTO;

      const walletRecord = await tx.wallet.findUnique({ where: { userId: existing.userId } });
      if (!walletRecord) throw new NotFoundException('Wallet not found');

      const amount = existing.creditsToAward;
      const balanceBefore = walletRecord.balance;
      const balanceAfter = balanceBefore + amount;

      const updatedCount = await tx.deposit.updateMany({
        where: {
          id: depositId,
          status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
        },
        data: {
          status: DepositStatus.COMPLETED,
          creditsAwarded: existing.creditsToAward,
          completedAt: new Date(),
          ...(opts.reviewedBy && { reviewedBy: opts.reviewedBy }),
          ...(opts.adminNotes && { adminNotes: opts.adminNotes }),
          ...(opts.paymentRef && { paymentRef: opts.paymentRef }),
        },
      });

      if (updatedCount.count === 0) {
        throw new BadRequestException('Deposit is no longer pending');
      }

      const updatedDeposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!updatedDeposit) throw new NotFoundException('Deposit disappeared');

      const updatedWallet = await tx.wallet.update({
        where: { id: walletRecord.id },
        data: {
          balance: balanceAfter,
          lifetimeEarned: { increment: amount },
          version: { increment: 1 },
        },
      });

      await tx.transaction.create({
        data: {
          walletId: walletRecord.id,
          type: txType,
          status: TransactionStatus.COMPLETED,
          amount,
          balanceBefore,
          balanceAfter,
          description: `Deposit via ${existing.method} — ${existing.amountFiat} ${existing.currency}`,
          referenceId: depositId,
          referenceType: 'Deposit',
        },
      });

      await tx.user.update({
        where: { id: existing.userId },
        data: { creditBalance: balanceAfter },
      });

      const newNotification = await tx.notification.create({
        data: {
          userId: existing.userId,
          type: NotificationType.CREDIT_EARNED,
          title: 'Deposit Approved',
          body: `Your ${existing.method} deposit of ${existing.currency} ${existing.amountFiat} has been approved. ${existing.creditsToAward.toLocaleString()} credits added to your wallet.`,
          data: { depositId, credits: existing.creditsToAward },
        },
      });

      return { deposit: updatedDeposit, wallet: updatedWallet, notification: newNotification };
    });

    this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId, status: DepositStatus.COMPLETED });
    if (wallet) {
      this.eventsService.emitToUser(deposit.userId, 'wallet:updated', {
        balance: wallet.balance,
        lifetimeEarned: wallet.lifetimeEarned,
        lifetimeSpent: wallet.lifetimeSpent,
      });
    }

    if (notification) {
      this.eventsService.emitToUser(deposit.userId, 'notification:new', notification);
    }

    return deposit;
  }
}
