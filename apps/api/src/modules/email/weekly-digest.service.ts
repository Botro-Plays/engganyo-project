import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from './email.service';
import { CompletionStatus } from '@prisma/client';

export interface UserDigestData {
  username: string;
  tasksCompleted: number;
  creditsEarned: number;
  currentBalance: number;
  newCampaigns: number;
  weekStart: string;
  weekEnd: string;
  xpEarned: number;
  tasksInProgress: number;
  tasksPending: number;
  totalTasksCompleted: number;
  weeklyRank: number;
  allTimeRank: number;
  streak: number;
}

@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private getWeekBounds(now = new Date()) {
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);
    const dateFmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { weekStart, weekEnd, dateFmt };
  }

  /** Compute digest data for a single user (reused by cron and admin preview) */
  async getUserDigestData(userId: string, userEmail: string, weekStart: Date, weekEnd: Date): Promise<UserDigestData | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        currentStreak: true,
        xp: true,
      },
    });
    if (!user) return null;

    const dateFmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const [
      completions,
      newCampaigns,
      wallet,
      xpEvents,
      inProgress,
      pending,
      totalCompleted,
    ] = await Promise.all([
      this.prisma.taskCompletion.findMany({
        where: { userId, status: CompletionStatus.VERIFIED, verifiedAt: { gte: weekStart, lt: weekEnd } },
        select: { creditsEarned: true },
      }),
      this.prisma.campaign.count({ where: { status: 'ACTIVE', createdAt: { gte: weekStart, lt: weekEnd } } }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
      this.prisma.xpEvent.aggregate({
        where: { userId, createdAt: { gte: weekStart, lt: weekEnd }, source: { not: 'daily_login' } },
        _sum: { amount: true },
      }),
      this.prisma.taskCompletion.count({
        where: { userId, status: { in: [CompletionStatus.ASSIGNED, CompletionStatus.IN_PROGRESS] } },
      }),
      this.prisma.taskCompletion.count({
        where: { userId, status: CompletionStatus.SUBMITTED },
      }),
      this.prisma.taskCompletion.count({
        where: { userId, status: CompletionStatus.VERIFIED },
      }),
    ]);

    const tasksCompleted = completions.length;
    const creditsEarned = completions.reduce((sum, c) => sum + (c.creditsEarned ?? 0), 0);

    // Compute weekly rank (by XP earned this week) and all-time rank (by total XP)
    const weeklyRankPromise = this.getWeeklyRank(userId, weekStart, weekEnd);
    const allTimeRankPromise = this.getAllTimeRank(userId);
    const [weeklyRank, allTimeRank] = await Promise.all([weeklyRankPromise, allTimeRankPromise]);

    return {
      username: user.displayName ?? user.username,
      tasksCompleted,
      creditsEarned,
      currentBalance: wallet?.balance ?? 0,
      newCampaigns,
      weekStart: dateFmt(weekStart),
      weekEnd: dateFmt(weekEnd),
      xpEarned: xpEvents._sum.amount ?? 0,
      tasksInProgress: inProgress,
      tasksPending: pending,
      totalTasksCompleted: totalCompleted,
      weeklyRank,
      allTimeRank,
      streak: user.currentStreak,
    };
  }

  private async getWeeklyRank(userId: string, weekStart: Date, weekEnd: Date): Promise<number> {
    const weekly = await this.prisma.xpEvent.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: weekStart, lt: weekEnd },
        source: { not: 'daily_login' },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });
    const idx = weekly.findIndex((w) => w.userId === userId);
    return idx >= 0 ? idx + 1 : 0;
  }

  private async getAllTimeRank(userId: string): Promise<number> {
    const allUsers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: { xp: 'desc' },
      select: { id: true },
    });
    const idx = allUsers.findIndex((u) => u.id === userId);
    return idx >= 0 ? idx + 1 : 0;
  }

  @Cron(CronExpression.EVERY_WEEKDAY)
  async sendWeeklyDigests(): Promise<void> {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek !== 1) return; // Only run on Monday

    const { weekStart, weekEnd } = this.getWeekBounds(now);

    this.logger.log('Starting weekly digest send…');

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        weeklyDigestEnabled: true,
      },
      select: { id: true, email: true },
      take: 500,
    });

    let sent = 0;
    for (const user of users) {
      try {
        const data = await this.getUserDigestData(user.id, user.email, weekStart, weekEnd);
        if (!data) continue;

        // Skip users with zero activity to reduce noise
        if (data.tasksCompleted === 0 && data.newCampaigns === 0 && data.xpEarned === 0) continue;

        await this.emailService.queueWeeklyDigestEmail(user.email, data);
        sent++;
      } catch (err) {
        this.logger.error(`Failed to queue digest for ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`Weekly digests queued: ${sent}/${users.length}`);
  }

  /** Manually trigger the digest (admin override) */
  async triggerWeeklyDigests(): Promise<{ queued: number; total: number }> {
    const { weekStart, weekEnd } = this.getWeekBounds();

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        weeklyDigestEnabled: true,
      },
      select: { id: true, email: true },
      take: 500,
    });

    let queued = 0;
    for (const user of users) {
      try {
        const data = await this.getUserDigestData(user.id, user.email, weekStart, weekEnd);
        if (!data) continue;
        if (data.tasksCompleted === 0 && data.newCampaigns === 0 && data.xpEarned === 0) continue;
        await this.emailService.queueWeeklyDigestEmail(user.email, data);
        queued++;
      } catch {
        // swallow per-user errors
      }
    }

    return { queued, total: users.length };
  }
}
