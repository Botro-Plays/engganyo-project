import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from './email.service';
import { CompletionStatus } from '@prisma/client';

@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_WEEKDAY)
  async sendWeeklyDigests(): Promise<void> {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek !== 1) return; // Only run on Monday (skip other weekdays — CronExpression.EVERY_WEEKDAY fires daily)

    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);

    const dateFmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    this.logger.log('Starting weekly digest send…');

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
      },
      take: 500, // batch to avoid memory spike
    });

    let sent = 0;
    for (const user of users) {
      try {
        const [completions, newCampaigns, wallet] = await Promise.all([
          this.prisma.taskCompletion.findMany({
            where: {
              userId: user.id,
              status: CompletionStatus.VERIFIED,
              verifiedAt: { gte: weekStart, lt: weekEnd },
            },
            select: { creditsEarned: true },
          }),
          this.prisma.campaign.count({
            where: {
              status: 'ACTIVE',
              createdAt: { gte: weekStart, lt: weekEnd },
            },
          }),
          this.prisma.wallet.findUnique({
            where: { userId: user.id },
            select: { balance: true },
          }),
        ]);

        const tasksCompleted = completions.length;
        const creditsEarned = completions.reduce((sum, c) => sum + (c.creditsEarned ?? 0), 0);

        // Skip users with zero activity to reduce noise
        if (tasksCompleted === 0 && newCampaigns === 0) continue;

        await this.emailService.queueWeeklyDigestEmail(user.email, {
          username: user.displayName ?? user.username,
          tasksCompleted,
          creditsEarned,
          currentBalance: wallet?.balance ?? 0,
          newCampaigns,
          weekStart: dateFmt(weekStart),
          weekEnd: dateFmt(weekEnd),
        });
        sent++;
      } catch (err) {
        this.logger.error(`Failed to queue digest for ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`Weekly digests queued: ${sent}/${users.length}`);
  }
}
