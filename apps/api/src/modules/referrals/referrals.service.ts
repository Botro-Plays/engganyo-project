import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionType, TransactionStatus, NotificationType } from '@prisma/client';
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
   * Award a referral milestone. Uses the milestones JSON field to avoid double-awards.
   */
  private async awardMilestone(
    referralId: string,
    milestone: string,
    referrerBonus: number,
    refereeBonus: number,
    description: string,
  ) {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      include: {
        referrer: { select: { id: true, username: true } },
        referee: { select: { id: true, username: true } },
      },
    });
    if (!referral) return;

    const ms = (referral.milestones as Record<string, boolean> | null) ?? {};
    if (ms[milestone]) return; // already awarded

    await this.prisma.withTransaction(async (tx) => {
      await tx.referral.update({
        where: { id: referralId },
        data: {
          milestones: { ...ms, [milestone]: true } as Prisma.InputJsonValue,
          creditsAwarded: { increment: referrerBonus },
        },
      });

      if (referrerBonus > 0) {
        const w = await tx.wallet.findUnique({ where: { userId: referral.referrerId }, select: { id: true, balance: true, lifetimeEarned: true } });
        if (w) {
          await tx.wallet.update({ where: { id: w.id }, data: { balance: { increment: referrerBonus }, lifetimeEarned: { increment: referrerBonus } } });
          await tx.transaction.create({
            data: {
              walletId: w.id, type: TransactionType.EARN_REFERRAL_BONUS, status: TransactionStatus.COMPLETED,
              amount: referrerBonus, balanceBefore: w.balance, balanceAfter: w.balance + referrerBonus,
              description: `Referral ${milestone}: ${description}`,
            },
          });
        }
      }
      if (refereeBonus > 0) {
        const w = await tx.wallet.findUnique({ where: { userId: referral.refereeId }, select: { id: true, balance: true, lifetimeEarned: true } });
        if (w) {
          await tx.wallet.update({ where: { id: w.id }, data: { balance: { increment: refereeBonus }, lifetimeEarned: { increment: refereeBonus } } });
          await tx.transaction.create({
            data: {
              walletId: w.id, type: TransactionType.EARN_REFERRAL_BONUS, status: TransactionStatus.COMPLETED,
              amount: refereeBonus, balanceBefore: w.balance, balanceAfter: w.balance + refereeBonus,
              description: `Referral ${milestone} bonus`,
            },
          });
        }
      }
    });

    this.notifications
      .createNotification(referral.referrerId, NotificationType.REFERRAL_QUALIFIED, 'Referral Milestone!', `${referral.referee.username} hit ${milestone}. You earned ${referrerBonus} credits!`)
      .catch(() => {});
    this.notifications
      .createNotification(referral.refereeId, NotificationType.REFERRAL_QUALIFIED, 'Referral Bonus!', `You hit ${milestone} and earned ${refereeBonus} credits!`)
      .catch(() => {});

    this.logger.log(`Referral milestone ${milestone}: ${referral.referrer.username} → ${referral.referee.username} (+${referrerBonus}/${refereeBonus})`);
  }

  /**
   * Called on registration. Awards sign-up milestone if applicable.
   */
  async awardSignUpBonus(refereeId: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { refereeId },
      select: { id: true },
    });
    if (!referral) return;
    await this.awardMilestone(referral.id, 'sign_up', 10, 25, 'Signed up');
  }

  /**
   * Called whenever a user completes their first verified task.
   * Qualifies any pending referral and awards first_task milestone.
   */
  async qualifyReferral(refereeId: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { refereeId, isQualified: false },
      include: {
        referrer: { select: { id: true, username: true } },
        referee: { select: { id: true, username: true } },
      },
    });
    if (!referral) return;

    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { isQualified: true, qualifiedAt: new Date() },
    });

    await this.awardMilestone(referral.id, 'first_task', 25, 0, 'First task completed');
  }

  /**
   * Check and award all pending referral milestones for a referee.
   * Called periodically or after major actions (task completion, deposit, tier-up).
   */
  async checkMilestones(refereeId: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { refereeId },
      include: {
        referrer: { select: { id: true } },
        referee: { select: { id: true, vipTier: { select: { level: true } } } },
      },
    });
    if (!referral) return;

    const ms = (referral.milestones as Record<string, boolean> | null) ?? {};

    // ten_tasks milestone
    if (!ms['ten_tasks']) {
      const taskCount = await this.prisma.taskCompletion.count({
        where: { userId: refereeId, status: 'VERIFIED' },
      });
      if (taskCount >= 10) {
        await this.awardMilestone(referral.id, 'ten_tasks', 50, 25, '10 tasks completed');
      }
    }

    // deposit milestone
    if (!ms['deposit']) {
      const hasDeposit = await this.prisma.deposit.count({
        where: { userId: refereeId, status: 'COMPLETED' },
      });
      if (hasDeposit > 0) {
        await this.awardMilestone(referral.id, 'deposit', 100, 0, 'First deposit');
      }
    }

    // silver_tier milestone
    if (!ms['silver_tier']) {
      const refereeTier = await this.prisma.user.findUnique({
        where: { id: refereeId },
        select: { vipTier: { select: { level: true } } },
      });
      if (refereeTier?.vipTier && refereeTier.vipTier.level >= 2) {
        await this.awardMilestone(referral.id, 'silver_tier', 200, 100, 'Reached Silver tier');
      }
    }
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
          milestones: true,
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
