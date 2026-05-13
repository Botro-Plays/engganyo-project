import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { TransactionType, TransactionStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { GetTransactionsDto } from './dto/get-transactions.dto';

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

  constructor(private readonly prisma: PrismaService) {}

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
}
