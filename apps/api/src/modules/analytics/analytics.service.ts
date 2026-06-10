import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompletionStatus, CampaignStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ANALYTICS_QUEUE, ANALYTICS_JOBS } from './analytics.processor';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYTICS_QUEUE) private readonly queue: Queue,
  ) {}

  // ─── Platform overview (admin) ──────────────────────────────────────────────

  async getOverview(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      totalUsers,
      newUsers,
      dau,
      mau,
      totalCampaigns,
      activeCampaigns,
      tasksVerified,
      tasksSubmitted,
      openReports,
      snapshots,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      // DAU = distinct users with a session created today
      this.prisma.userSession.groupBy({
        by: ['userId'],
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }).then((r) => r.length),
      // MAU = distinct users with a session in last 30d
      this.prisma.userSession.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: since } },
      }).then((r) => r.length),
      this.prisma.campaign.count(),
      this.prisma.campaign.count({ where: { status: CampaignStatus.ACTIVE } }),
      this.prisma.taskCompletion.count({ where: { status: CompletionStatus.VERIFIED } }),
      this.prisma.taskCompletion.count({ where: { status: CompletionStatus.SUBMITTED } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      // Last `days` days of snapshots for trend charts
      this.prisma.analyticsSnapshot.findMany({
        where: { date: { gte: since } },
        orderBy: { date: 'asc' },
      }),
    ]);

    return {
      totals: {
        users: totalUsers,
        newUsers,
        dau,
        mau,
        campaigns: totalCampaigns,
        activeCampaigns,
        tasksVerified,
        tasksSubmitted,
        openReports,
      },
      snapshots,
    };
  }

  // ─── Per-campaign funnel ─────────────────────────────────────────────────────

  async getCampaignFunnel(campaignId: string, requesterId: string, requesterRole: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true, title: true, userId: true,
        totalSlots: true, completedSlots: true, pendingSlots: true,
        creditPerTask: true, totalCost: true, status: true,
        taskType: true, createdAt: true,
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');

    const isAdmin = ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'].includes(requesterRole);
    if (!isAdmin && campaign.userId !== requesterId) {
      throw new NotFoundException('Campaign not found');
    }

    const [assigned, submitted, verified, rejected, dailyCompletions] = await Promise.all([
      this.prisma.taskCompletion.count({ where: { campaignId, status: CompletionStatus.ASSIGNED } }),
      this.prisma.taskCompletion.count({ where: { campaignId, status: CompletionStatus.SUBMITTED } }),
      this.prisma.taskCompletion.count({ where: { campaignId, status: CompletionStatus.VERIFIED } }),
      this.prisma.taskCompletion.count({ where: { campaignId, status: CompletionStatus.REJECTED } }),
      // Verified completions grouped by day for a trend line
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT DATE_TRUNC('day', verified_at) AS day, COUNT(*) AS count
        FROM task_completions
        WHERE campaign_id = ${campaignId}
          AND status = 'VERIFIED'
          AND verified_at IS NOT NULL
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    const total = assigned + submitted + verified + rejected;
    const completionRate = total > 0 ? Math.round((verified / total) * 100) : 0;
    const creditsSpent = verified * campaign.creditPerTask;
    const costPerAction = verified > 0 ? creditsSpent / verified : 0;

    return {
      campaign,
      funnel: {
        assigned,
        submitted,
        verified,
        rejected,
        total,
        completionRate,
        creditsSpent,
        costPerAction: Math.round(costPerAction),
      },
      dailyCompletions: dailyCompletions.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
    };
  }

  // ─── Personal stats (current user) ──────────────────────────────────────────

  async getMyStats(userId: string) {
    const now = new Date();
    const last7 = new Date(now); last7.setDate(now.getDate() - 7);
    const last30 = new Date(now); last30.setDate(now.getDate() - 30);

    const [
      totalVerified,
      verifiedLast7,
      verifiedLast30,
      wallet,
      campaigns,
      activeCampaigns,
      streak,
      rank,
      recentCompletions,
    ] = await Promise.all([
      this.prisma.taskCompletion.count({ where: { userId, status: CompletionStatus.VERIFIED } }),
      this.prisma.taskCompletion.count({ where: { userId, status: CompletionStatus.VERIFIED, verifiedAt: { gte: last7 } } }),
      this.prisma.taskCompletion.count({ where: { userId, status: CompletionStatus.VERIFIED, verifiedAt: { gte: last30 } } }),
      this.prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true, lifetimeEarned: true, lifetimeSpent: true },
      }),
      this.prisma.campaign.count({ where: { userId } }),
      this.prisma.campaign.count({ where: { userId, status: CampaignStatus.ACTIVE } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, longestStreak: true, xp: true, level: true, reputationScore: true },
      }),
      // Leaderboard rank by XP
      this.prisma.user.count({
        where: { xp: { gt: (await this.prisma.user.findUnique({ where: { id: userId }, select: { xp: true } }))?.xp ?? 0 } },
      }).then((ahead) => ahead + 1),
      // Last 30 daily completions for a sparkline
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT DATE_TRUNC('day', verified_at) AS day, COUNT(*) AS count
        FROM task_completions
        WHERE user_id = ${userId}
          AND status = 'VERIFIED'
          AND verified_at >= ${last30}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    return {
      tasks: {
        totalVerified,
        last7Days: verifiedLast7,
        last30Days: verifiedLast30,
      },
      credits: {
        balance: wallet?.balance ?? 0,
        lifetimeEarned: wallet?.lifetimeEarned ?? 0,
        lifetimeSpent: wallet?.lifetimeSpent ?? 0,
      },
      campaigns: {
        total: campaigns,
        active: activeCampaigns,
      },
      gamification: {
        xp: streak?.xp ?? 0,
        level: streak?.level ?? 1,
        currentStreak: streak?.currentStreak ?? 0,
        longestStreak: streak?.longestStreak ?? 0,
        reputationScore: streak?.reputationScore ?? 0,
        leaderboardRank: rank,
      },
      dailyActivity: recentCompletions.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
    };
  }

  // ─── Daily snapshot cron (runs at midnight UTC) ──────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async takeDailySnapshot() {
    this.logger.log('Enqueuing daily analytics snapshot job');
    await this.queue.add(ANALYTICS_JOBS.DAILY_SNAPSHOT, {}, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 10,
      removeOnFail: 5,
    });
  }
}
