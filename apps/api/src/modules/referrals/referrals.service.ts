import { Injectable, Logger } from '@nestjs/common';
import { TransactionType, TransactionStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  /**
   * Called whenever a user completes their first verified task.
   * Qualifies any pending referral and awards credits if configured.
   */
  async qualifyReferral(refereeId: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { refereeId, isQualified: false },
      include: {
        referrer: { select: { id: true, username: true } },
        referee: { select: { id: true, username: true } },
      },
    });

    if (!referral) return; // no pending referral

    const config = await this.prisma.platformConfig.findMany({
      where: { key: { in: ['referral_bonus_referrer', 'referral_bonus_referee'] } },
    });
    const configMap = Object.fromEntries(config.map((c) => [c.key, Number(c.value) ?? 0]));
    const referrerBonus = configMap['referral_bonus_referrer'] ?? 50;
    const refereeBonus = configMap['referral_bonus_referee'] ?? 50;

    await this.prisma.withTransaction(async (tx) => {
      await tx.referral.update({
        where: { id: referral.id },
        data: { isQualified: true, qualifiedAt: new Date(), creditsAwarded: referrerBonus },
      });

      // Award referrer
      if (referrerBonus > 0) {
        const referrerWallet = await tx.wallet.findUnique({
          where: { userId: referral.referrerId },
          select: { id: true, balance: true, lifetimeEarned: true },
        });
        if (referrerWallet) {
          await tx.wallet.update({
            where: { id: referrerWallet.id },
            data: {
              balance: { increment: referrerBonus },
              lifetimeEarned: { increment: referrerBonus },
            },
          });
          await tx.transaction.create({
            data: {
              walletId: referrerWallet.id,
              type: TransactionType.EARN_REFERRAL_BONUS,
              status: TransactionStatus.COMPLETED,
              amount: referrerBonus,
              balanceBefore: referrerWallet.balance,
              balanceAfter: referrerWallet.balance + referrerBonus,
              description: `Referral bonus — ${referral.referee.username} completed their first task`,
            },
          });
        }
      }

      // Award referee
      if (refereeBonus > 0) {
        const refereeWallet = await tx.wallet.findUnique({
          where: { userId: refereeId },
          select: { id: true, balance: true, lifetimeEarned: true },
        });
        if (refereeWallet) {
          await tx.wallet.update({
            where: { id: refereeWallet.id },
            data: {
              balance: { increment: refereeBonus },
              lifetimeEarned: { increment: refereeBonus },
            },
          });
          await tx.transaction.create({
            data: {
              walletId: refereeWallet.id,
              type: TransactionType.EARN_REFERRAL_BONUS,
              status: TransactionStatus.COMPLETED,
              amount: refereeBonus,
              balanceBefore: refereeWallet.balance,
              balanceAfter: refereeWallet.balance + refereeBonus,
              description: 'Referral completion bonus',
            },
          });
        }
      }
    });

    // Fire-and-forget notifications
    this.notifications
      .createNotification(
        referral.referrerId,
        NotificationType.REFERRAL_QUALIFIED,
        'Referral Qualified!',
        `${referral.referee.username} completed their first task. You earned ${referrerBonus} credits!`,
      )
      .catch(() => {});
    this.notifications
      .createNotification(
        refereeId,
        NotificationType.REFERRAL_QUALIFIED,
        'Welcome Bonus!',
        `You completed your first task and earned ${refereeBonus} referral bonus credits!`,
      )
      .catch(() => {});

    this.events.emitBroadcast('referral:qualified', {
      referrerId: referral.referrerId,
      refereeId,
      referrerBonus,
      refereeBonus,
    });

    this.logger.log(`Referral qualified: ${referral.referrer.username} → ${referral.referee.username} (+${referrerBonus}/${refereeBonus})`);
  }

  async getMyReferrals(userId: string) {
    const [referrals, totalQualified] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        select: {
          id: true,
          isQualified: true,
          qualifiedAt: true,
          creditsAwarded: true,
          createdAt: true,
          referee: { select: { id: true, username: true, displayName: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referral.count({ where: { referrerId: userId, isQualified: true } }),
    ]);

    return {
      total: referrals.length,
      qualified: totalQualified,
      pending: referrals.length - totalQualified,
      totalCreditsEarned: referrals.reduce((sum, r) => sum + r.creditsAwarded, 0),
      referrals,
    };
  }

  async getLeaderboard(period: 'alltime' | 'monthly' | 'weekly' | 'daily', limit = 50) {
    const now = new Date();
    let startDate: Date | undefined;

    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'weekly') {
      const day = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const where = startDate
      ? { createdAt: { gte: startDate }, isQualified: true }
      : { isQualified: true };

    const rows = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      where,
      _count: { id: true },
      _sum: { creditsAwarded: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    const userIds = rows.map((r) => r.referrerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.referrerId,
      username: userMap.get(r.referrerId)?.username ?? '—',
      displayName: userMap.get(r.referrerId)?.displayName ?? null,
      avatarUrl: userMap.get(r.referrerId)?.avatarUrl ?? null,
      referralCount: r._count.id,
      creditsEarned: r._sum.creditsAwarded ?? 0,
    }));
  }
}
