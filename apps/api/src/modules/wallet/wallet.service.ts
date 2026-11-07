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
import { verifyMessage as ethersVerifyMessage, randomBytes } from 'ethers';
import { GamificationService, VP_REWARDS } from '../gamification/gamification.service';
import { ReferralsService } from '../referrals/referrals.service';
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

/**
 * Thrown when the optimistic-lock retry budget is exhausted inside a
 * caller-provided transaction. Still a BadRequestException for HTTP
 * callers, but distinguishable via `instanceof` so transaction-owning
 * callers (e.g. referral milestone awards) can retry their WHOLE unit of
 * work instead of only the wallet apply step.
 */
export class WalletContentionException extends BadRequestException {
  constructor() {
    super('Transaction failed after retries. Please try again.');
    this.name = 'WalletContentionException';
  }
}

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
    @Inject(forwardRef(() => ReferralsService))
    private readonly referralsService: ReferralsService,
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

  async credit(userId: string, amount: number, opts: CreditOptions, tx?: Prisma.TransactionClient) {
    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');
    return this.executeWithOptimisticLock(userId, amount, 'credit', opts, tx);
  }

  // ─── Debit (internal — used by other services) ─────────────

  async debit(userId: string, amount: number, opts: DebitOptions, tx?: Prisma.TransactionClient) {
    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');
    return this.executeWithOptimisticLock(userId, amount, 'debit', opts, tx);
  }

  // ─── Optimistic-locking engine ─────────────────────────────

  // When `tx` is provided, the operation joins the caller's transaction —
  // all wallet writes commit or roll back atomically with the caller's other
  // writes. The optimistic-lock retry still applies inside the outer tx
  // (PostgreSQL READ COMMITTED gives each statement a fresh snapshot).
  private async executeWithOptimisticLock(
    userId: string,
    amount: number,
    direction: 'credit' | 'debit',
    opts: CreditOptions | DebitOptions,
    outerTx?: Prisma.TransactionClient,
  ) {
    const db = outerTx ?? this.prisma;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      const wallet = await db.wallet.findUnique({
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

      const apply = async (tx: Prisma.TransactionClient) => {
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
      };

      try {
        // Join the caller's transaction when one is provided; otherwise open
        // our own so the wallet update + ledger row + balance mirror stay atomic.
        return outerTx ? await apply(outerTx) : await this.prisma.withTransaction(apply);
      } catch (err) {
        if (err instanceof Error && err.message === 'OPTIMISTIC_LOCK_CONFLICT') {
          this.logger.warn(`Optimistic lock conflict for userId=${userId}, attempt=${attempt}`);
          if (attempt === MAX_RETRY) {
            throw new WalletContentionException();
          }
          await new Promise((r) => setTimeout(r, 50 * attempt));
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('Transaction failed.');
  }

  // ─── Mirror reconciliation ─────────────────────────────────

  /**
   * Reconcile the denormalized `user.creditBalance` mirror to the
   * ledger-backed `wallets.balance`. Locks the wallet row FOR UPDATE
   * first — the same lock order as executeWithOptimisticLock (wallet row,
   * then user row) — so a concurrent settlement either commits before our
   * read (we copy the newest balance) or waits for this tx and rewrites
   * the mirror itself. Idempotent; safe to call per user under live
   * traffic. Returns { changed, from?, to }.
   */
  async reconcileCreditBalanceMirror(userId: string) {
    return this.prisma.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<{ balance: number }[]>`
        SELECT balance FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
      const wallet = rows[0];
      if (!wallet) throw new NotFoundException('Wallet not found');

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { creditBalance: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (user.creditBalance === wallet.balance) {
        return { changed: false as const, to: wallet.balance };
      }
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: wallet.balance },
      });
      return { changed: true as const, from: user.creditBalance, to: wallet.balance };
    });
  }

  // ─── Deposit system ────────────────────────────────────────

  // Single source of truth for USD→PHP charges: integer centavos so the
  // package charge, derived PHP minimum, and checkout amount can never
  // diverge at a half-centavo boundary.
  private usdToPhpCentavos(usd: number, rate: number): number {
    return Math.round(usd * rate * 100);
  }

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
    // Derived PHP minimum uses the SAME centavo rounding as the package
    // charge (phpAmount = (usd*rate).toFixed(2)) so a package priced at the
    // USD floor always qualifies. An explicitly configured min_deposit_php
    // still overrides. Computed in integer centavos to avoid float drift.
    const minDepositPhp = (map['min_deposit_php'] as number)
      ?? this.usdToPhpCentavos(minDepositUsd, usdToPhp) / 100;

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
        methods: pkg.methods,
        phpEquivalent: Math.ceil(pkg.usdAmount * usdToPhp),
        // Exact amount the PayMongo checkout will charge — mirrors
        // initiateDeposit's Math.max(1, …) clamp so UI and provider agree.
        phpAmount: Math.max(1, this.usdToPhpCentavos(pkg.usdAmount, usdToPhp) / 100),
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

    const { method } = dto;
    const methodConfigs: Record<string, { enabled: boolean; walletAddress?: string | null }> = {
      PAYMONGO:   options.paymongo,
      PAYPAL:     options.paypal,
      USDT_BEP20: options.usdtBep20,
      USDT_BASE:  options.usdtBase,
    };
    const cfg = methodConfigs[method as string];
    if (!cfg?.enabled) throw new BadRequestException(`${method} deposits are not currently available`);

    const isCryptoMethod = method === 'USDT_BEP20' || method === 'USDT_BASE';
    // Crypto deposits must declare the paying wallet up front — it is bound
    // against the on-chain Transfer `from` during verification so other
    // accounts cannot claim public tx hashes.
    let userWalletAddress: string | null = null;
    let walletVerified = false;
    if (isCryptoMethod) {
      if (!dto.userWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(dto.userWalletAddress.trim())) {
        throw new BadRequestException('A valid EVM wallet address is required for crypto deposits');
      }
      userWalletAddress = dto.userWalletAddress.trim();
      // Connected-wallet path: a valid signature on a fresh challenge proves
      // the account controls the declared wallet — marks the deposit verified.
      // Without one, the deposit stays unverified: it may still submit a hash
      // (manual transfers), but on-chain match routes to review, not credit.
      if (dto.signature && dto.challengeNonce) {
        await this.consumeWalletChallenge({
          userId, nonce: dto.challengeNonce, signature: dto.signature,
          wallet: userWalletAddress, chain: this.cryptoChainOf(method), depositId: null,
        });
        walletVerified = true;
      }
    } else {
      userWalletAddress = dto.userWalletAddress?.trim() ?? null;
    }
    // Normalize tx hashes: chain identifiers are case-insensitive but the
    // paymentRef unique column is case-sensitive — casing variants must not
    // allow the same transaction to be claimed twice.
    let txHash: string | null = null;
    if (dto.txHash) {
      const normalized = dto.txHash.trim().toLowerCase();
      if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
        throw new BadRequestException('Invalid transaction hash format. Expected 0x followed by 64 hexadecimal characters.');
      }
      txHash = normalized;
    }

    const { creditsPerUsd, usdToPhp, minDepositUsd, minDepositPhp } = options.pricing;
    // Package method allowlist — empty means all methods (e.g. a PAYMONGO-only
    // ₱1 test package cannot be used via PayPal or crypto).
    if (pkg.methods?.length && !pkg.methods.includes(method)) {
      throw new BadRequestException('This package is not available for the selected payment method');
    }

    const isPhp = method === 'PAYMONGO';
    const amountFiat = isPhp
      ? Math.max(1, this.usdToPhpCentavos(pkg.usdAmount, usdToPhp) / 100)
      : pkg.usdAmount;

    // ── Guard: minimum deposit amounts ──
    if (!isPhp && pkg.usdAmount < minDepositUsd) {
      throw new BadRequestException(`Minimum deposit is $${minDepositUsd} USD`);
    }
    // PayMongo-only packages use the provider floor (₱1) instead of the
    // configured PHP minimum — internal test packages rely on this.
    const effectiveMinPhp =
      pkg.methods?.length && pkg.methods.every((m) => m === 'PAYMONGO') ? 1 : minDepositPhp;
    if (isPhp && amountFiat < effectiveMinPhp) {
      throw new BadRequestException(`Minimum deposit is ₱${effectiveMinPhp} PHP`);
    }
    const currency   = isPhp ? 'PHP' : 'USD';
    const creditsBase   = Math.floor(pkg.usdAmount * creditsPerUsd);
    const creditsToAward = creditsBase + pkg.bonusCredits;

    let deposit;
    try {
      deposit = await this.prisma.deposit.create({
        data: {
          userId,
          packageId: pkg.id,
          method: method as DepositMethod,
          status: txHash ? DepositStatus.PROCESSING : DepositStatus.PENDING,
          walletVerified,
          // Exclusive claim only for ownership-verified payers — an unverified
          // manual submission must not squat the globally-unique paymentRef and
          // block the rightful payer. Evidence stays in gatewayData for review.
          ...(txHash && walletVerified ? { paymentRef: txHash } : {}),
          ...(txHash && !walletVerified ? { gatewayData: { submittedHash: txHash, manualClaim: true } } : {}),
          amountFiat,
          currency,
          creditsToAward,
          bonusCredits: pkg.bonusCredits,
          creditsAwarded: 0,
          exchangeRate: isPhp ? usdToPhp : null,
          userWalletAddress,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestException('This transaction hash has already been submitted');
      }
      throw err;
    }

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

    // Enrich completed deposits with VP awarded
    const depositIds = items.filter((d) => d.status === 'COMPLETED').map((d) => d.id);
    const vpEvents = depositIds.length > 0
      ? await this.prisma.vpEvent.findMany({
          where: { userId, source: 'deposit_completed', referenceId: { in: depositIds } },
          select: { referenceId: true, amount: true },
        })
      : [];
    const vpMap = new Map(vpEvents.map((v) => [v.referenceId, v.amount]));

    const enrichedItems = items.map((d) => ({
      ...d,
      vpAwarded: d.status === 'COMPLETED' ? (vpMap.get(d.id) ?? 0) : 0,
    }));

    return { items: enrichedItems, meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
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
        creditsAwarded: true,
        bonusCredits: true,
        paymentRef: true,
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
    opts: { paymentRef?: string; reviewedBy?: string; adminNotes?: string;
            settlement?: { fee?: number; feeCurrency?: string; net?: number; netCurrency?: string;
                           converted?: number; convertedCurrency?: string };
            // CAS guard: the claim this settle was verified against must be
            // unchanged — protects against stale RPC results settling a
            // replaced claim. Covers paymentRef and gatewayData.submittedHash.
            guard?: { claimHash: string; userWalletAddress: string; walletVerified: boolean } } = {},
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

      const updatedCount = await tx.deposit.updateMany({
        where: {
          id: depositId,
          status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
          ...(opts.guard && {
            userWalletAddress: opts.guard.userWalletAddress,
            walletVerified: opts.guard.walletVerified,
            OR: [
              { paymentRef: opts.guard.claimHash },
              { AND: [{ paymentRef: null }, { gatewayData: { path: ['submittedHash'], equals: opts.guard.claimHash } }] },
            ],
          }),
        },
        data: {
          status: DepositStatus.COMPLETED,
          creditsAwarded: existing.creditsToAward,
          completedAt: new Date(),
          ...(opts.reviewedBy && { reviewedBy: opts.reviewedBy }),
          ...(opts.adminNotes && { adminNotes: opts.adminNotes }),
          ...(opts.paymentRef && { paymentRef: opts.paymentRef }),
          ...(opts.settlement?.fee != null && { providerFee: opts.settlement.fee }),
          ...(opts.settlement?.feeCurrency && { providerFeeCurrency: opts.settlement.feeCurrency }),
          ...(opts.settlement?.net != null && { providerNet: opts.settlement.net }),
          ...(opts.settlement?.netCurrency && { providerNetCurrency: opts.settlement.netCurrency }),
          ...(opts.settlement?.converted != null && { providerConverted: opts.settlement.converted }),
          ...(opts.settlement?.convertedCurrency && { providerConvertedCur: opts.settlement.convertedCurrency }),
        },
      });

      if (updatedCount.count === 0) {
        throw new BadRequestException('Deposit is no longer pending');
      }

      const updatedDeposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!updatedDeposit) throw new NotFoundException('Deposit disappeared');

      // Route through the versioned engine — the deposit claim above stops
      // double completion, but the wallet write still has to be safe against
      // OTHER concurrent balance changes on the same wallet.
      await this.credit(existing.userId, amount, {
        type: txType,
        description: `Deposit via ${existing.method} — ${existing.amountFiat} ${existing.currency}`,
        referenceId: depositId,
        referenceType: 'Deposit',
      }, tx);

      const updatedWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: walletRecord.id },
      });

      const vpAmount = Math.round((existing.amountFiat ?? 0) * VP_REWARDS.DEPOSIT_PER_DOLLAR);
      const vpText = vpAmount > 0 ? ` (+${vpAmount} VIP Points)` : '';
      const newNotification = await tx.notification.create({
        data: {
          userId: existing.userId,
          type: NotificationType.CREDIT_EARNED,
          title: 'Deposit Approved',
          body: `Your ${existing.method} deposit of ${existing.currency} ${existing.amountFiat} has been approved. ${existing.creditsToAward.toLocaleString()} credits added to your wallet.${vpText}`,
          data: { depositId, credits: existing.creditsToAward, vpAwarded: vpAmount },
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

    // Sprint 7: Check referral milestones after deposit
    void this.referralsService.checkMilestones(deposit.userId).catch(() => null);

    return deposit;
  }

  // ─── Submit txHash for an existing PENDING crypto deposit ──

  // ─── Wallet-ownership signature challenges ─────────────────
  // A connected wallet proves ownership by signing a server-issued,
  // expiring, single-use challenge bound to the account, wallet, chain,
  // and (when supplied) the deposit. Reuse across deposits/accounts/
  // chains is impossible — each field is checked before consume.

  private cryptoChainOf(method: string): 'BSC' | 'BASE' {
    return method === 'USDT_BEP20' ? 'BSC' : 'BASE';
  }

  async createWalletChallenge(userId: string, method: 'USDT_BEP20' | 'USDT_BASE', wallet: string, depositId?: string) {
    const addr = wallet.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      throw new BadRequestException('Provide the EVM wallet address you will sign from');
    }
    if (depositId) {
      const dep = await this.prisma.deposit.findUnique({ where: { id: depositId } });
      if (!dep || dep.userId !== userId) throw new BadRequestException('Deposit not found');
    }
    const chain = this.cryptoChainOf(method);
    const nonce = randomBytes(16).reduce((h, b) => h + b.toString(16).padStart(2, '0'), '');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const message = [
      'Engganyo wallet ownership verification',
      `Account: ${userId}`,
      `Wallet: ${addr.toLowerCase()}`,
      `Chain: ${chain}`,
      `Deposit: ${depositId ?? '(new deposit)'}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt.toISOString()}`,
    ].join('\n');
    const ch = await this.prisma.walletChallenge.create({
      data: { userId, wallet: addr.toLowerCase(), chain, depositId: depositId ?? null, nonce, message, expiresAt },
    });
    return { nonce: ch.nonce, message: ch.message, expiresAt: ch.expiresAt };
  }

  // Verify signature + atomically consume. Throws on any mismatch.
  private async consumeWalletChallenge(params: {
    userId: string; nonce: string; signature: string; wallet: string; chain: 'BSC' | 'BASE'; depositId?: string | null;
  }): Promise<void> {
    const { userId, nonce, signature, wallet, chain, depositId } = params;
    const ch = await this.prisma.walletChallenge.findUnique({ where: { nonce } });
    if (!ch || ch.userId !== userId || ch.wallet !== wallet.toLowerCase() || ch.chain !== chain) {
      throw new BadRequestException('Invalid wallet verification challenge');
    }
    if (depositId !== undefined && (ch.depositId ?? null) !== (depositId ?? null)) {
      throw new BadRequestException('Challenge was issued for a different deposit');
    }
    if (ch.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Wallet verification challenge expired — request a new one');
    }
    let recovered: string;
    try {
      recovered = ethersVerifyMessage(ch.message, signature);
    } catch {
      throw new BadRequestException('Could not verify wallet signature');
    }
    if (recovered.toLowerCase() !== ch.wallet) {
      throw new BadRequestException('Signature does not match the declared wallet');
    }
    // Single-use: consume atomically — a concurrent second consume wins 0 rows.
    const consumed = await this.prisma.walletChallenge.updateMany({
      where: { nonce, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Wallet verification challenge already used');
    }
  }

  // Post-submission ownership proof: a fresh challenge bound to THIS
  // deposit + the declared sending wallet upgrades an unverified manual
  // claim to verified — the only way a manual transfer earns auto-credit.
  async proveWalletOwnership(userId: string, depositId: string, challengeNonce: string, signature: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit || deposit.userId !== userId) throw new BadRequestException('Deposit not found');
    const isCrypto = deposit.method === DepositMethod.USDT_BEP20 || deposit.method === DepositMethod.USDT_BASE;
    if (!isCrypto) throw new BadRequestException('Ownership proof applies to crypto deposits');
    if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.PROCESSING) {
      throw new BadRequestException(`Cannot verify ownership for a ${deposit.status} deposit`);
    }
    if (deposit.walletVerified) return { verified: true, depositId };
    if (!deposit.userWalletAddress) {
      throw new BadRequestException('No sending wallet is declared on this deposit');
    }
    await this.consumeWalletChallenge({
      userId, nonce: challengeNonce, signature,
      wallet: deposit.userWalletAddress, chain: this.cryptoChainOf(deposit.method), depositId: deposit.id,
    });
    const upgraded = await this.prisma.deposit.updateMany({
      where: { id: depositId, walletVerified: false, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
      data: { walletVerified: true },
    });
    if (upgraded.count === 0) throw new BadRequestException('Deposit state changed — try again');
    this.eventsService.emitToUser(userId, 'deposit:updated', { depositId, status: deposit.status, walletVerified: true });
    return { verified: true, depositId };
  }

  async submitTxHash(userId: string, depositId: string, txHash: string, userWalletAddress?: string, challengeNonce?: string, signature?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.userId !== userId) throw new BadRequestException('Not your deposit');

    const isCrypto = deposit.method === DepositMethod.USDT_BEP20 || deposit.method === DepositMethod.USDT_BASE;
    if (!isCrypto) throw new BadRequestException('Transaction hash can only be submitted for crypto deposits');
    if (deposit.status !== DepositStatus.PENDING) {
      throw new BadRequestException(`Cannot submit txHash for a deposit with status ${deposit.status}`);
    }

    // Validate txHash format: must be 0x + 64 hex characters
    const normalized = txHash.trim().toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
      throw new BadRequestException('Invalid transaction hash format. Expected 0x followed by 64 hexadecimal characters.');
    }

    // Every crypto deposit must carry the paying wallet so verification can
    // bind the Transfer `from` to this account. Older PENDING deposits may
    // lack it — accept it on submission.
    let walletAddress = deposit.userWalletAddress;
    if (!walletAddress) {
      if (!userWalletAddress || !/^0x[a-fA-F0-9]{40}$/.test(userWalletAddress.trim())) {
        throw new BadRequestException('Provide the EVM wallet address you will pay from so the transaction can be verified');
      }
      walletAddress = userWalletAddress.trim();
    }

    // A fresh signature on a deposit-bound challenge upgrades this deposit to
    // wallet-verified — required before any on-chain match can auto-credit.
    let walletVerified = deposit.walletVerified;
    if (!walletVerified && signature && challengeNonce) {
      await this.consumeWalletChallenge({
        userId, nonce: challengeNonce, signature,
        wallet: walletAddress, chain: this.cryptoChainOf(deposit.method), depositId: deposit.id,
      });
      walletVerified = true;
    }

    // Verified payers take the exclusive paymentRef; unverified submissions
    // keep the hash as review evidence in gatewayData without reserving it —
    // a manual claim must never block the ownership-verified payer.
    const claimData: Prisma.DepositUpdateManyMutationInput = walletVerified
      ? { paymentRef: normalized }
      : { gatewayData: { submittedHash: normalized, manualClaim: true } };

    // Atomic update: ensure deposit is still PENDING before flipping to PROCESSING
    let claimed;
    try {
      claimed = await this.prisma.deposit.updateMany({
        where: { id: depositId, status: DepositStatus.PENDING },
        data: {
          status: DepositStatus.PROCESSING,
          userWalletAddress: walletAddress,
          walletVerified,
          ...claimData,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestException('This transaction hash has already been submitted');
      }
      throw err;
    }

    if (claimed.count === 0) {
      throw new BadRequestException('Deposit status changed. Please refresh and try again.');
    }

    const updated = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    this.eventsService.emitToUser(userId, 'deposit:updated', { depositId, status: DepositStatus.PROCESSING });
    return updated;
  }

  // ─── Frontend-triggered crypto deposit verification ────────

  // A claim that can never verify (wrong sender, or the tx predates this
  // deposit) must release the reserved hash — otherwise an invalid claim
  // permanently blocks the rightful owner from submitting it on their own
  // deposit. The release is conditioned on the deposit still holding the
  // same claim so a concurrent resubmission is untouched.
  private isTerminalClaimFailure(error?: string): boolean {
    return !!error && (
      error.includes('not sent from the wallet declared') ||
      error.includes('mined before this deposit was initiated')
    );
  }

  private async releaseCryptoClaim(depositId: string, claimHash: string) {
    // Verified-claim release: null the exclusive ref (conditional on it being
    // unchanged). Unverified-claim release: clear the gatewayData evidence and
    // revert — the rightful payer's claim is untouched either way.
    const released = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: DepositStatus.PROCESSING, paymentRef: claimHash },
      data: { status: DepositStatus.PENDING, paymentRef: null },
    });
    if (released.count === 0) {
      const dep = await this.prisma.deposit.findUnique({ where: { id: depositId } });
      if (dep?.status === DepositStatus.PROCESSING) {
        const gw = dep.gatewayData && typeof dep.gatewayData === 'object' && !Array.isArray(dep.gatewayData)
          ? { ...(dep.gatewayData as Prisma.JsonObject) } : {};
        delete gw.submittedHash;
        delete gw.manualClaim;
        await this.prisma.deposit.updateMany({
          where: { id: depositId, status: DepositStatus.PROCESSING, gatewayData: { path: ['submittedHash'], equals: claimHash } },
          data: { status: DepositStatus.PENDING, gatewayData: gw as Prisma.InputJsonValue },
        });
      }
    }
  }

  // Persist needsReview + the on-chain sender so admin can adjudicate an
  // otherwise-valid transfer that lacks a wallet-ownership proof.
  private claimCondition(claimHash: string): Prisma.DepositWhereInput {
    return {
      OR: [
        { paymentRef: claimHash },
        { AND: [{ paymentRef: null }, { gatewayData: { path: ['submittedHash'], equals: claimHash } }] },
      ],
    };
  }

  private async flagNeedsReview(deposit: { id: string; userId: string; gatewayData: unknown }, claimHash: string, fromAddress?: string) {
    await this.prisma.deposit.updateMany({
      where: { id: deposit.id, status: DepositStatus.PROCESSING, ...this.claimCondition(claimHash) },
      data: {
        gatewayData: {
          ...(deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
            ? (deposit.gatewayData as Prisma.JsonObject)
            : {}),
          needsReview: true,
          ...(fromAddress && { claimedFrom: fromAddress }),
        } as Prisma.InputJsonValue,
      },
    });
    this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.PROCESSING, needsReview: true });
  }

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
    const gw = deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
      ? (deposit.gatewayData as Prisma.JsonObject)
      : {};
    const claimHash = deposit.paymentRef ?? (typeof gw.submittedHash === 'string' ? gw.submittedHash : null);
    if (deposit.status !== DepositStatus.PROCESSING || !claimHash) {
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
    if (!deposit.userWalletAddress) {
      throw new BadRequestException('No paying wallet is declared on this deposit — it cannot be verified. Submit the wallet address you paid from.');
    }

    const expectedAmount = deposit.package?.usdAmount ?? deposit.amountFiat;

    const result = await this.cryptoVerification.verifyDeposit({
      method: deposit.method as 'USDT_BEP20' | 'USDT_BASE',
      txHash: claimHash,
      expectedAmountUsd: expectedAmount,
      platformWalletAddress: platformWallet,
      expectedFromAddress: deposit.userWalletAddress,
      notBeforeTimestamp: Math.floor(deposit.createdAt.getTime() / 1000),
    });

    if (result.valid) {
      if (deposit.walletVerified) {
        this.logger.log(`Frontend-triggered verification: auto-completing crypto deposit ${deposit.id}`);
        await this.completeDeposit(deposit.id, {
          paymentRef: claimHash,
          guard: { claimHash, userWalletAddress: deposit.userWalletAddress!, walletVerified: true },
        });
        return { status: 'COMPLETED', depositId, txHash: claimHash, message: 'Deposit verified and completed' };
      }
      // Valid transfer but ownership never proven — route to review, not credit.
      await this.flagNeedsReview(deposit, claimHash, result.fromAddress);
      return {
        status: 'PROCESSING', depositId, txHash: claimHash, needsReview: true,
        message: 'On-chain payment found but wallet ownership was not proven — routed to review',
      };
    }
    if (this.isTerminalClaimFailure(result.error)) {
      await this.releaseCryptoClaim(deposit.id, claimHash);
      return { status: 'PENDING', depositId, message: result.error + ' — the hash was released; resubmit the correct wallet' };
    }

    // If still waiting for confirmations, persist them to gatewayData and tell the user to wait
    if (result.error?.includes('Waiting for confirmations')) {
      const minConfirmations = 12;
      if (result.confirmations !== undefined) {
        await this.prisma.deposit.updateMany({
          where: { id: depositId, status: DepositStatus.PROCESSING, ...this.claimCondition(claimHash) },
          data: {
            gatewayData: {
              ...(deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
                ? (deposit.gatewayData as Prisma.JsonObject)
                : {}),
              confirmations: result.confirmations,
              minConfirmations,
            } as Prisma.InputJsonValue,
          },
        });
        this.eventsService.emitToUser(deposit.userId, 'deposit:updated', {
          depositId,
          status: DepositStatus.PROCESSING,
          confirmations: result.confirmations,
          minConfirmations,
        });
      }
      return {
        status: 'PROCESSING',
        depositId,
        txHash: claimHash,
        message: result.error,
        confirmations: result.confirmations,
        minConfirmations: result.confirmations !== undefined ? minConfirmations : undefined,
      };
    }

    // For any other failure, persist error details and return without marking FAILED
    // (only the cron job should mark deposits as FAILED to avoid race conditions)
    if (result.confirmations !== undefined || result.error) {
      await this.prisma.deposit.updateMany({
        where: { id: depositId, status: DepositStatus.PROCESSING, ...this.claimCondition(claimHash) },
        data: {
          gatewayData: {
            ...(deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
              ? (deposit.gatewayData as Prisma.JsonObject)
              : {}),
            ...(result.confirmations !== undefined && { confirmations: result.confirmations }),
            ...(result.error && { lastError: result.error }),
          } as Prisma.InputJsonValue,
        },
      });
      if (result.confirmations !== undefined) {
        this.eventsService.emitToUser(deposit.userId, 'deposit:updated', {
          depositId,
          status: DepositStatus.PROCESSING,
          confirmations: result.confirmations,
          minConfirmations: 12,
        });
      }
    }
    return {
      status: 'PROCESSING',
      depositId,
      txHash: claimHash,
      message: result.error ?? 'Verification failed',
      confirmations: result.confirmations,
      minConfirmations: result.confirmations !== undefined ? 12 : undefined,
    };
  }

  // ─── Cron: auto-verify PROCESSING crypto deposits ──────────

  @Cron(CronExpression.EVERY_MINUTE)
  async verifyCryptoDeposits() {
    const pendingDeposits = await this.prisma.deposit.findMany({
      where: {
        method: { in: [DepositMethod.USDT_BEP20, DepositMethod.USDT_BASE] },
        status: DepositStatus.PROCESSING,
        OR: [
          { paymentRef: { not: null } },
          { gatewayData: { path: ['submittedHash'], not: Prisma.JsonNull } },
        ],
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

        if (!deposit.userWalletAddress) {
          this.logger.warn(`Crypto deposit ${deposit.id} has no declared wallet address; skipping verification`);
          continue;
        }

        const expectedAmount = deposit.package?.usdAmount ?? deposit.amountFiat;

        const cronGw = deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
          ? (deposit.gatewayData as Prisma.JsonObject) : {};
        const claimHash = deposit.paymentRef ?? (typeof cronGw.submittedHash === 'string' ? cronGw.submittedHash : null);
        if (!claimHash) continue;

        const result = await this.cryptoVerification.verifyDeposit({
          method: deposit.method as 'USDT_BEP20' | 'USDT_BASE',
          txHash: claimHash,
          expectedAmountUsd: expectedAmount,
          platformWalletAddress: platformWallet,
          expectedFromAddress: deposit.userWalletAddress,
          notBeforeTimestamp: Math.floor(deposit.createdAt.getTime() / 1000),
        });

        if (result.valid) {
          if (deposit.walletVerified) {
            this.logger.log(`Auto-completing crypto deposit ${deposit.id} (tx: ${claimHash})`);
            await this.completeDeposit(deposit.id, {
              paymentRef: claimHash,
              guard: { claimHash, userWalletAddress: deposit.userWalletAddress!, walletVerified: true },
            });
          } else {
            await this.flagNeedsReview(deposit, claimHash, result.fromAddress);
            this.logger.warn(`Crypto deposit ${deposit.id} verified on-chain but wallet ownership unproven — needs review`);
          }
        } else {
          if (this.isTerminalClaimFailure(result.error)) {
            await this.releaseCryptoClaim(deposit.id, claimHash);
            this.logger.warn(`Crypto deposit ${deposit.id} claim released (terminal mismatch) — hash freed`);
            continue;
          }
          this.logger.warn(`Crypto deposit ${deposit.id} verification failed: ${result.error}`);
          // Persist confirmation count so UI can show X/12 progress
          if (result.confirmations !== undefined) {
            await this.prisma.deposit.updateMany({
              where: { id: deposit.id, status: DepositStatus.PROCESSING, ...this.claimCondition(claimHash) },
              data: {
                gatewayData: {
                  ...(deposit.gatewayData && typeof deposit.gatewayData === 'object' && !Array.isArray(deposit.gatewayData)
                    ? (deposit.gatewayData as Prisma.JsonObject)
                    : {}),
                  confirmations: result.confirmations,
                  minConfirmations: 12,
                } as Prisma.InputJsonValue,
              },
            });
            this.eventsService.emitToUser(deposit.userId, 'deposit:updated', {
              depositId: deposit.id,
              status: DepositStatus.PROCESSING,
              confirmations: result.confirmations,
              minConfirmations: 12,
            });
          }
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
