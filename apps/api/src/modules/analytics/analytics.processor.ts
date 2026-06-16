import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CompletionStatus, CampaignStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ANALYTICS_QUEUE, ANALYTICS_JOBS } from './analytics.service';

@Processor(ANALYTICS_QUEUE)
export class AnalyticsProcessor {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process(ANALYTICS_JOBS.DAILY_SNAPSHOT)
  async handleDailySnapshot(job: Job) {
    this.logger.log(`Processing daily snapshot (job ${job.id})`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const last30 = new Date(today);
    last30.setDate(today.getDate() - 30);

    try {
      const [
        totalUsers,
        newUsers,
        dau,
        mau,
        tasksAssigned,
        tasksSubmitted,
        tasksVerified,
        tasksRejected,
        campaignsCreated,
        campaignsCompleted,
        creditsIssued,
        creditsSpent,
        storePurchases,
        storeCreditsSpent,
        storeTopItem,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
        this.prisma.userSession.groupBy({ by: ['userId'], where: { createdAt: { gte: yesterday, lt: today } } }).then((r) => r.length),
        this.prisma.userSession.groupBy({ by: ['userId'], where: { createdAt: { gte: last30, lt: today } } }).then((r) => r.length),
        this.prisma.taskCompletion.count({ where: { assignedAt: { gte: yesterday, lt: today } } }),
        this.prisma.taskCompletion.count({ where: { submittedAt: { gte: yesterday, lt: today } } }),
        this.prisma.taskCompletion.count({ where: { status: CompletionStatus.VERIFIED, verifiedAt: { gte: yesterday, lt: today } } }),
        this.prisma.taskCompletion.count({ where: { status: CompletionStatus.REJECTED, updatedAt: { gte: yesterday, lt: today } } }),
        this.prisma.campaign.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
        this.prisma.campaign.count({ where: { completedAt: { gte: yesterday, lt: today } } }),
        this.prisma.transaction.aggregate({ where: { type: 'EARN_TASK_COMPLETION', createdAt: { gte: yesterday, lt: today } }, _sum: { amount: true } }).then((r) => r._sum.amount ?? 0),
        this.prisma.transaction.aggregate({ where: { type: 'SPEND_CAMPAIGN_CREATE', createdAt: { gte: yesterday, lt: today } }, _sum: { amount: true } }).then((r) => Math.abs(r._sum.amount ?? 0)),
        // Store metrics
        this.prisma.storePurchase.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
        this.prisma.storePurchase.aggregate({ where: { createdAt: { gte: yesterday, lt: today } }, _sum: { creditCostAtPurchase: true } }).then((r) => r._sum.creditCostAtPurchase ?? 0),
        this.prisma.storePurchase.groupBy({ by: ['itemId'], where: { createdAt: { gte: yesterday, lt: today } }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 1 }).then(async (rows) => {
          if (rows.length === 0) return null;
          const item = await this.prisma.storeItem.findUnique({ where: { id: rows[0].itemId }, select: { name: true } });
          return { itemId: rows[0].itemId, itemName: item?.name ?? 'Unknown', count: rows[0]._count.id };
        }),
      ]);

      await this.prisma.analyticsSnapshot.upsert({
        where: { date: yesterday },
        update: {
          totalUsers, newUsers, dailyActive: dau, monthlyActive: mau,
          tasksAssigned, tasksSubmitted, tasksVerified, tasksRejected,
          campaignsCreated, campaignsCompleted,
          creditsIssued: Number(creditsIssued), creditsSpent: Number(creditsSpent),
          storePurchases: Number(storePurchases),
          storeCreditsSpent: Number(storeCreditsSpent),
          storeTopItemId: storeTopItem?.itemId ?? null,
          storeTopItemName: storeTopItem?.itemName ?? null,
          storeTopItemCount: storeTopItem?.count ?? 0,
        },
        create: {
          date: yesterday,
          totalUsers, newUsers, dailyActive: dau, monthlyActive: mau,
          tasksAssigned, tasksSubmitted, tasksVerified, tasksRejected,
          campaignsCreated, campaignsCompleted,
          creditsIssued: Number(creditsIssued), creditsSpent: Number(creditsSpent),
          storePurchases: Number(storePurchases),
          storeCreditsSpent: Number(storeCreditsSpent),
          storeTopItemId: storeTopItem?.itemId ?? null,
          storeTopItemName: storeTopItem?.itemName ?? null,
          storeTopItemCount: storeTopItem?.count ?? 0,
        },
      });

      this.logger.log(`Daily snapshot saved for ${yesterday.toISOString().slice(0, 10)}`);
    } catch (err) {
      this.logger.error('Failed to take daily snapshot', err);
      throw err; // Let BullMQ retry based on job options
    }
  }
}
