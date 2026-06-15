import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, DepositMethod, DepositStatus, TransactionType, TransactionStatus, NotificationType, UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CurrencyService } from './currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { PayMongoService } from '../paymongo/paymongo.service';
import { PayPalService } from '../paypal/paypal.service';
import { CryptoVerificationService } from './crypto-verification.service';
import { GamificationService, VP_REWARDS } from '../gamification/gamification.service';
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
    @Inject(forwardRef(() => PayPalService))
    private readonly payPalService: PayPalService,
    private readonly cryptoVerification: CryptoVerificationService,
    @Inject(forwardRef(() => GamificationService))
    private readonly gamificationService: GamificationService,
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
      'credits_per_usd', 'min_deposit_usd', 'min_deposit_php',
    ];
    const [configs, usdToPhp] = await Promise.all([
      this.prisma.platformConfig.findMany({ where: { key: { in: keys } } }),
      this.currency.getUsdToPhp(),
    ]);
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    const creditsPerUsd = (map['credits_per_usd'] as number) ?? 5000;
    const minDepositUsd = (map['min_deposit_usd'] as number) ?? 1;
    const minDepositPhp = (map['min_deposit_php'] as number) ?? Math.ceil(minDepositUsd * usdToPhp);

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
        minDepositPhp,
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
    // ── Guard: one pending/processing deposit at a time ──
    const existingPending = await this.prisma.deposit.findFirst({
      where: {
        userId,
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
      },
      select: { id: true, method: true, status: true },
    });
    if (existingPending) {
      throw new BadRequestException(
        `You already have a ${existingPending.status.toLowerCase()} ${existingPending.method} deposit. Please complete or cancel it before creating a new one.`,
      );
    }

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

    const { creditsPerUsd, usdToPhp, minDepositUsd, minDepositPhp } = options.pricing;
    const isPhp = method === 'PAYMONGO';
    const rawAmountPhp = parseFloat((pkg.usdAmount * usdToPhp).toFixed(2));
    const amountFiat = isPhp ? Math.max(1, rawAmountPhp) : pkg.usdAmount;

    // ── Guard: minimum deposit amounts ──
    if (!isPhp && pkg.usdAmount < minDepositUsd) {
      throw new BadRequestException(`Minimum deposit is $${minDepositUsd} USD`);
    }
    if (isPhp && amountFiat < minDepositPhp) {
      throw new BadRequestException(`Minimum deposit is ₱${minDepositPhp} PHP`);
    }
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

    const isCrypto = method === 'USDT_BEP20' || method === 'USDT_BASE';
    const cryptoCfg = method === 'USDT_BEP20' ? options.usdtBep20 : options.usdtBase;

    let instructions: Record<string, unknown> = {};
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
      // Persist crypto instructions so they survive page refresh
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { gatewayData: instructions as Prisma.InputJsonValue },
      });
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
    const existing = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!existing) throw new NotFoundException('Deposit not found');
    if (existing.userId !== userId) throw new BadRequestException('Not your deposit');
    if (existing.status !== DepositStatus.PENDING && existing.status !== DepositStatus.PROCESSING) {
      throw new BadRequestException(`Cannot cancel a deposit with status ${existing.status}`);
    }

    // Atomic status guard: only cancel if still PENDING/PROCESSING at this exact moment.
    // Prevents race condition where webhook completes deposit while user clicks Cancel.
    const claimed = await this.prisma.deposit.updateMany({
      where: {
        id: depositId,
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
      },
      data: { status: DepositStatus.CANCELLED },
    });

    if (claimed.count === 0) {
      this.logger.warn(`cancelDeposit race: deposit ${depositId} was already processed, skipping cancel`);
      const fresh = await this.prisma.deposit.findUnique({ where: { id: depositId } });
      throw new BadRequestException(
        `Deposit was already ${fresh?.status?.toLowerCase() ?? 'processed'}. Cancel aborted.`,
      );
    }

    const deposit = await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        adminNotes: 'Cancelled by user',
        gatewayData: {
          ...(existing.gatewayData && typeof existing.gatewayData === 'object' && !Array.isArray(existing.gatewayData)
            ? (existing.gatewayData as Prisma.JsonObject)
            : {}),
          cancelledAt: new Date().toISOString(),
          cancelledBy: userId,
        } as Prisma.InputJsonValue,
      },
    });

    // Archive PayMongo link so it can't be paid anymore (best-effort, after status flip)
    if (deposit.method === DepositMethod.PAYMONGO && deposit.paymentRef) {
      try {
        await this.payMongoService.archiveLink(deposit.paymentRef);
      } catch (err) {
        this.logger.warn(`Failed to archive PayMongo link ${deposit.paymentRef} during cancel: ${String(err)}`);
      }
    }

    // Best-effort: notify PayPal to void/cancel the order (prevents buyer from paying a cancelled deposit)
    if (deposit.method === DepositMethod.PAYPAL && deposit.paymentRef) {
      try {
        await this.payPalService.cancelOrder(deposit.paymentRef);
      } catch (err) {
        this.logger.warn(`Failed to cancel PayPal order ${deposit.paymentRef}: ${String(err)}`);
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

    // Award VP for deposit completion (outside transaction for resilience)
    try {
      const vpAmount = Math.round((deposit.amountFiat ?? 0) * VP_REWARDS.DEPOSIT_PER_DOLLAR);
      if (vpAmount > 0) {
        await this.gamificationService.awardVp(deposit.userId, vpAmount, 'deposit_completed', deposit.id, `Deposit ${deposit.method}`);
      }
    } catch (vpErr) {
      this.logger.warn(`Failed to award VP for deposit ${depositId}: ${(vpErr as Error).message}`);
    }

    return deposit;
  }

  // ─── Submit txHash for an existing PENDING crypto deposit ──

  async submitTxHash(userId: string, depositId: string, txHash: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.userId !== userId) throw new BadRequestException('Not your deposit');

    const isCrypto = deposit.method === DepositMethod.USDT_BEP20 || deposit.method === DepositMethod.USDT_BASE;
    if (!isCrypto) throw new BadRequestException('Transaction hash can only be submitted for crypto deposits');
    if (deposit.status !== DepositStatus.PENDING) {
      throw new BadRequestException(`Cannot submit txHash for a deposit with status ${deposit.status}`);
    }

    // Validate txHash format: must be 0x + 64 hex characters
    const normalized = txHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
      throw new BadRequestException('Invalid transaction hash format. Expected 0x followed by 64 hexadecimal characters.');
    }

    // Atomic update: ensure deposit is still PENDING before flipping to PROCESSING
    const claimed = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: DepositStatus.PENDING },
      data: {
        status: DepositStatus.PROCESSING,
        paymentRef: normalized,
      },
    });

    if (claimed.count === 0) {
      throw new BadRequestException('Deposit status changed. Please refresh and try again.');
    }

    const updated = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    this.eventsService.emitToUser(userId, 'deposit:updated', { depositId, status: DepositStatus.PROCESSING });
    return updated;
  }

  // ─── Frontend-triggered crypto deposit verification ────────

  async verifyCryptoDeposit(userId: string, depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: { package: { select: { usdAmount: true } } },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.userId !== userId) throw new BadRequestException('Not your deposit');

    const isCrypto = deposit.method === DepositMethod.USDT_BEP20 || deposit.method === DepositMethod.USDT_BASE;
    if (!isCrypto) throw new BadRequestException('Verification is only available for crypto deposits');

    // Idempotency: already completed
    if (deposit.status === DepositStatus.COMPLETED) {
      return { status: 'COMPLETED', depositId, message: 'Deposit already completed' };
    }
    if (deposit.status === DepositStatus.CANCELLED) {
      throw new BadRequestException('Deposit was cancelled');
    }
    if (deposit.status === DepositStatus.FAILED) {
      throw new BadRequestException('Deposit has failed');
    }
    if (deposit.status !== DepositStatus.PROCESSING || !deposit.paymentRef) {
      throw new BadRequestException('Deposit must be in PROCESSING status with a transaction hash to verify');
    }

    const options = await this.getDepositOptions();
    const platformWallet =
      deposit.method === DepositMethod.USDT_BEP20
        ? options.usdtBep20.walletAddress
        : options.usdtBase.walletAddress;

    if (!platformWallet) {
      throw new BadRequestException('Platform wallet address not configured for this network');
    }

    const expectedAmount = deposit.package?.usdAmount ?? deposit.amountFiat;

    const result = await this.cryptoVerification.verifyDeposit({
      method: deposit.method as 'USDT_BEP20' | 'USDT_BASE',
      txHash: deposit.paymentRef,
      expectedAmountUsd: expectedAmount,
      platformWalletAddress: platformWallet,
    });

    if (result.valid) {
      this.logger.log(`Frontend-triggered verification: auto-completing crypto deposit ${deposit.id}`);
      await this.completeDeposit(deposit.id, { paymentRef: deposit.paymentRef });
      return { status: 'COMPLETED', depositId, txHash: deposit.paymentRef, message: 'Deposit verified and completed' };
    }

    // If still waiting for confirmations, tell the user to wait
    if (result.error?.includes('Waiting for confirmations')) {
      return {
        status: 'PROCESSING',
        depositId,
        txHash: deposit.paymentRef,
        message: result.error,
        confirmations: result.confirmations,
        minConfirmations: result.confirmations !== undefined ? 12 : undefined,
      };
    }

    // For any other failure, return the error without marking FAILED
    // (only the cron job should mark deposits as FAILED to avoid race conditions)
    return {
      status: 'PROCESSING',
      depositId,
      txHash: deposit.paymentRef,
      message: result.error ?? 'Verification failed',
    };
  }

  // ─── Cron: auto-verify PROCESSING crypto deposits ──────────

  @Cron(CronExpression.EVERY_MINUTE)
  async verifyCryptoDeposits() {
    const pendingDeposits = await this.prisma.deposit.findMany({
      where: {
        method: { in: [DepositMethod.USDT_BEP20, DepositMethod.USDT_BASE] },
        status: DepositStatus.PROCESSING,
        paymentRef: { not: null },
      },
      include: { package: { select: { usdAmount: true } } },
    });

    if (pendingDeposits.length === 0) return;

    // Load platform wallet addresses from config
    const options = await this.getDepositOptions();

    for (const deposit of pendingDeposits) {
      try {
        const platformWallet =
          deposit.method === DepositMethod.USDT_BEP20
            ? options.usdtBep20.walletAddress
            : options.usdtBase.walletAddress;

        if (!platformWallet) {
          this.logger.warn(`No platform wallet configured for ${deposit.method}; skipping verification for ${deposit.id}`);
          continue;
        }

        const expectedAmount = deposit.package?.usdAmount ?? deposit.amountFiat;

        const result = await this.cryptoVerification.verifyDeposit({
          method: deposit.method as 'USDT_BEP20' | 'USDT_BASE',
          txHash: deposit.paymentRef!,
          expectedAmountUsd: expectedAmount,
          platformWalletAddress: platformWallet,
        });

        if (result.valid) {
          this.logger.log(`Auto-completing crypto deposit ${deposit.id} (tx: ${deposit.paymentRef})`);
          await this.completeDeposit(deposit.id, { paymentRef: deposit.paymentRef! });
        } else {
          this.logger.warn(`Crypto deposit ${deposit.id} verification failed: ${result.error}`);
          // If the error indicates the tx is permanently invalid (not just waiting),
          // we could mark it as FAILED. For now, leave as PROCESSING for admin review.
          if (result.error?.includes('Transaction failed on-chain') ||
              result.error?.includes('No USDT transfer to platform wallet') ||
              result.error?.includes('Amount mismatch')) {
            const updateResult = await this.prisma.deposit.updateMany({
              where: { id: deposit.id, status: DepositStatus.PROCESSING },
              data: {
                status: DepositStatus.FAILED,
                adminNotes: `Auto-verification failed: ${result.error}`,
              },
            });
            if (updateResult.count > 0) {
              this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.FAILED });

              // Real-time admin alert + notifications
              const adminAlertPayload = {
                depositId: deposit.id,
                userId: deposit.userId,
                method: deposit.method,
                amount: deposit.amountFiat,
                currency: deposit.currency,
                txHash: deposit.paymentRef,
                reason: result.error,
                adminNotes: `Auto-verification failed: ${result.error}`,
                failedAt: new Date().toISOString(),
              };
              this.eventsService.emitToAdmins('admin:deposit-failed', adminAlertPayload);

              // Create in-app notifications for all admins
              const admins = await this.prisma.user.findMany({
                where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MODERATOR] } },
                select: { id: true },
              });
              for (const admin of admins) {
                void this.notificationsService.createNotification(
                  admin.id,
                  NotificationType.SYSTEM_ANNOUNCEMENT,
                  'Crypto Deposit Failed — Review Needed',
                  `Deposit ${deposit.id} (${deposit.method}) for ${deposit.currency} ${deposit.amountFiat} failed verification: ${result.error}. Check /admin/finances.`,
                  adminAlertPayload,
                ).catch(() => null);
              }
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Unexpected error verifying crypto deposit ${deposit.id}: ${message}`);
      }
    }
  }
}
