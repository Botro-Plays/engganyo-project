import { Injectable, NotFoundException, BadRequestException, ForbiddenException, forwardRef, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CampaignStatus, CompletionStatus, DepositMethod, DepositStatus, NotificationType, Prisma, ReportStatus, SocialPlatform, TransactionType, UserRole, UserStatus } from '@prisma/client';
import type { CreatePlatformTaskDto } from './dto/create-platform-task.dto';
import type { UpdatePlatformTaskDto } from './dto/update-platform-task.dto';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthService } from '../auth/auth.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PayMongoService } from '../paymongo/paymongo.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { EmailService } from '../email/email.service';
import { WeeklyDigestService } from '../email/weekly-digest.service';
import type { ListUsersDto } from './dto/list-users.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { ReviewCampaignDto } from './dto/review-campaign.dto';
import type { ResolveReportDto } from './dto/resolve-report.dto';
import type { GrantCreditsDto } from './dto/grant-credits.dto';
import type { AdjustTrustDto } from './dto/adjust-trust.dto';
import type { ChangeUserRoleDto } from './dto/change-user-role.dto';
import type { UpdateUserDetailsDto } from './dto/update-user-details.dto';
import type { SendAnnouncementDto } from './dto/send-announcement.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly authService: AuthService,
    private readonly eventsService: EventsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly weeklyDigestService: WeeklyDigestService,
    @Inject(forwardRef(() => PayMongoService))
    private readonly payMongoService: PayMongoService,
  ) {}

  // ─── Users ────────────────────────────────────────────────

  async listUsers(dto: ListUsersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;
    const skip = (page - 1) * limit;

    const where = {
      ...(dto.status && { status: dto.status }),
      ...(dto.role && { role: dto.role }),
      ...(dto.search && {
        OR: [
          { username: { contains: dto.search, mode: 'insensitive' as const } },
          { email: { contains: dto.search, mode: 'insensitive' as const } },
          { displayName: { contains: dto.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          xp: true,
          level: true,
          creditBalance: true,
          currentStreak: true,
          createdAt: true,
          twoFactorTotpSecret: true,
          twoFactorEmailEnabled: true,
          _count: { select: { completions: true, campaigns: true, abuseFlags: true } },
          ipRecords: { orderBy: { createdAt: 'desc' }, take: 1, select: { country: true, region: true, ipAddress: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const mapped = items.map(({ twoFactorTotpSecret, twoFactorEmailEnabled, ...rest }) => ({
      ...rest,
      hasTwoFactor: !!twoFactorTotpSecret || twoFactorEmailEnabled,
    }));

    return { items: mapped, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, email: true, displayName: true,
        role: true, status: true, xp: true, level: true,
        creditBalance: true, currentStreak: true, longestStreak: true, createdAt: true,
        _count: { select: { completions: true, campaigns: true, abuseFlags: true, reportsReceived: true } },
        trustScore: { select: { score: true, level: true } },
        abuseFlags: { where: { isResolved: false }, select: { flagType: true, severity: true, createdAt: true }, take: 10 },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUserStatus(adminId: string, adminRole: string, userId: string, dto: UpdateUserStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, username: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    const privileged = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as string[];
    if (privileged.includes(user.role) && adminRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can modify other admin accounts');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
      select: { id: true, username: true, status: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `user.status.${dto.status.toLowerCase()}`,
        entityType: 'User',
        entityId: userId,
        oldValue: { status: user.status },
        newValue: { status: dto.status, reason: dto.reason },
      },
    });

    return updated;
  }

  async createPlatformTask(adminId: string, dto: CreatePlatformTaskDto) {
    const campaign = await this.prisma.campaign.create({
      data: {
        userId: adminId,
        title: dto.title,
        description: dto.description,
        taskType: dto.taskType,
        targetUrl: dto.targetUrl,
        totalSlots: dto.totalSlots,
        creditPerTask: dto.creditPerTask,
        totalCost: dto.totalSlots * dto.creditPerTask,
        status: CampaignStatus.ACTIVE,
        requiresProof: dto.requiresProof ?? true,
        autoVerify: dto.autoVerify ?? true,
        proofInstructions: dto.proofInstructions,
        targetCountries: [],
        targetLanguages: [],
        isPlatformTask: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'platform_task.created',
        entityType: 'Campaign',
        entityId: campaign.id,
        newValue: { title: dto.title, taskType: dto.taskType, totalSlots: dto.totalSlots },
      },
    });

    return campaign;
  }

  async listPlatformTasks(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const adminRoles = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MODERATOR];
    const where = {
      status: CampaignStatus.ACTIVE,
      isPlatformTask: true,
      user: { role: { in: adminRoles } },
    };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        select: {
          id: true, title: true, taskType: true, targetUrl: true, description: true,
          totalSlots: true, completedSlots: true, pendingSlots: true,
          creditPerTask: true, totalCost: true, requiresProof: true,
          proofInstructions: true, status: true, createdAt: true,
          user: { select: { username: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async listUserCampaigns(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = {
      isPlatformTask: false,
      status: { in: [CampaignStatus.ACTIVE, CampaignStatus.PAUSED] },
    };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        select: {
          id: true, title: true, taskType: true, targetUrl: true,
          totalSlots: true, completedSlots: true, pendingSlots: true,
          creditPerTask: true, totalCost: true, status: true, createdAt: true,
          user: { select: { username: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async updatePlatformTask(adminId: string, taskId: string, dto: UpdatePlatformTaskDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, totalSlots: true, creditPerTask: true, user: { select: { role: true } } },
    });
    if (!campaign) throw new NotFoundException('Task not found');
    const adminRoles = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MODERATOR];
    if (!(adminRoles as UserRole[]).includes(campaign.user.role)) {
      throw new ForbiddenException('Can only edit platform-created tasks');
    }

    const updatedSlots = dto.totalSlots ?? campaign.totalSlots;
    const updatedCredits = dto.creditPerTask ?? campaign.creditPerTask;

    const updated = await this.prisma.campaign.update({
      where: { id: taskId },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.targetUrl && { targetUrl: dto.targetUrl }),
        ...(dto.totalSlots && { totalSlots: dto.totalSlots }),
        ...(dto.creditPerTask && { creditPerTask: dto.creditPerTask }),
        totalCost: updatedSlots * updatedCredits,
        ...(dto.proofInstructions !== undefined && { proofInstructions: dto.proofInstructions }),
        ...(dto.requiresProof !== undefined && { requiresProof: dto.requiresProof }),
        ...(dto.autoVerify !== undefined && { autoVerify: dto.autoVerify }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'platform_task.updated',
        entityType: 'Campaign',
        entityId: taskId,
        oldValue: { title: campaign.title },
        newValue: { ...dto },
      },
    });

    return updated;
  }

  async cancelPlatformTask(adminId: string, taskId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        totalSlots: true,
        completedSlots: true,
        pendingSlots: true,
        creditPerTask: true,
        status: true,
        user: { select: { role: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Task not found');

    const adminRoles = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MODERATOR];
    if (!(adminRoles as UserRole[]).includes(campaign.user.role)) {
      throw new ForbiddenException('Can only cancel platform-created tasks');
    }

    const cancellableStatuses: CampaignStatus[] = [
      CampaignStatus.ACTIVE,
      CampaignStatus.PAUSED,
    ];
    if (!cancellableStatuses.includes(campaign.status)) {
      throw new BadRequestException(`Cannot cancel a task with status ${campaign.status}`);
    }

    // No refund for platform tasks (they're created by admin, no credits deducted)
    await this.prisma.campaign.update({
      where: { id: taskId },
      data: { status: CampaignStatus.CANCELLED, cancelledAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'platform_task.cancelled',
        entityType: 'Campaign',
        entityId: taskId,
        oldValue: { title: campaign.title, status: campaign.status },
        newValue: { status: CampaignStatus.CANCELLED },
      },
    });

    return { message: 'Platform task cancelled successfully' };
  }

  async cancelUserCampaign(adminId: string, campaignId: string, reason?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        totalSlots: true,
        completedSlots: true,
        pendingSlots: true,
        creditPerTask: true,
        feeAmount: true,
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const cancellableStatuses: CampaignStatus[] = [
      CampaignStatus.ACTIVE,
      CampaignStatus.PAUSED,
      CampaignStatus.DRAFT,
      CampaignStatus.PENDING_REVIEW,
    ];
    if (!cancellableStatuses.includes(campaign.status)) {
      throw new BadRequestException(`Cannot cancel a campaign with status ${campaign.status}`);
    }

    // Calculate refund: only for unused pool slots (fee is retained by platform)
    const refundableSlots = campaign.totalSlots - campaign.completedSlots - campaign.pendingSlots;
    const refundAmount = refundableSlots * campaign.creditPerTask;

    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          status: CampaignStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      if (refundAmount > 0) {
        await tx.user.update({
          where: { id: campaign.userId },
          data: { creditBalance: { increment: refundAmount } },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: 'user_campaign.cancelled',
          entityType: 'Campaign',
          entityId: campaignId,
          oldValue: {
            title: campaign.title,
            status: campaign.status,
            refundableSlots,
            refundAmount,
            feeRetained: campaign.feeAmount,
            reason: reason || 'No reason provided',
          },
          newValue: {
            status: CampaignStatus.CANCELLED,
            refunded: refundAmount,
            feeRetained: campaign.feeAmount,
          },
        },
      });
    });

    return {
      message: 'Campaign cancelled successfully',
      refunded: refundAmount,
      refundableSlots,
      feeRetained: campaign.feeAmount,
      reason: reason || null,
    };
  }

  // ─── Revenue ─────────────────────────────────────────────

  async getRevenueSummary(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    end.setHours(23, 59, 59, 999);

    // ── Credit-based revenue (campaign fees) ───────────────────────────────────
    const rows = await this.prisma.platformRevenue.findMany({
      where: {
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'desc' },
      select: {
        date: true,
        source: true,
        amount: true,
        campaignId: true,
      },
    });

    const daily = new Map<string, { date: string; total: number; campaignFees: number; other: number }>();
    let grandTotal = 0;

    for (const row of rows) {
      const dateKey = row.date.toISOString().split('T')[0];
      if (!daily.has(dateKey)) {
        daily.set(dateKey, { date: dateKey, total: 0, campaignFees: 0, other: 0 });
      }
      const day = daily.get(dateKey)!;
      day.total += row.amount;
      grandTotal += row.amount;
      if (row.source === 'CAMPAIGN_FEE') {
        day.campaignFees += row.amount;
      } else {
        day.other += row.amount;
      }
    }

    // ── Cash flow (completed deposits) ───────────────────────────────────────
    const deposits = await this.prisma.deposit.findMany({
      where: {
        status: DepositStatus.COMPLETED,
        completedAt: { gte: start, lte: end },
      },
      select: {
        completedAt: true,
        createdAt: true,
        amountFiat: true,
        currency: true,
        method: true,
      },
    });

    const cashFlow = new Map<string, { date: string; total: number; php: number; usd: number; byMethod: Record<string, number> }>();
    let cashTotal = 0;

    for (const dep of deposits) {
      const dateKey = (dep.completedAt ?? dep.createdAt ?? new Date()).toISOString().split('T')[0];
      if (!cashFlow.has(dateKey)) {
        cashFlow.set(dateKey, { date: dateKey, total: 0, php: 0, usd: 0, byMethod: {} });
      }
      const day = cashFlow.get(dateKey)!;
      const amount = dep.amountFiat ?? 0;
      day.total += amount;
      cashTotal += amount;
      if (dep.currency === 'PHP') {
        day.php += amount;
      } else {
        day.usd += amount;
      }
      const method = dep.method;
      day.byMethod[method] = (day.byMethod[method] ?? 0) + amount;
    }

    return {
      summary: {
        from: start.toISOString().split('T')[0],
        to: end.toISOString().split('T')[0],
        grandTotal,
        recordCount: rows.length,
        cashTotal: Math.round(cashTotal * 100) / 100,
        cashRecordCount: deposits.length,
      },
      daily: Array.from(daily.values()).sort((a, b) => b.date.localeCompare(a.date)),
      cashFlow: Array.from(cashFlow.values()).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  async changeUserRole(adminId: string, userId: string, dto: ChangeUserRoleDto) {
    if (adminId === userId) throw new BadRequestException('Cannot change your own role');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, username: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.SUPER_ADMIN) throw new ForbiddenException('Cannot modify a SUPER_ADMIN account');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: { id: true, username: true, role: true },
    });

    this.eventsService.emitToUser(userId, 'user:role-changed', { role: dto.role });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'user.role.changed',
        entityType: 'User',
        entityId: userId,
        oldValue: { role: user.role },
        newValue: { role: dto.role },
      },
    });

    return updated;
  }

  // ─── Proof Submissions (manual review) ───────────────────

  async listPendingSubmissions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const now = new Date();
    // Admin queue: SUBMITTED completions where creator's 48h review window has passed (escalated)
    const where = {
      status: CompletionStatus.SUBMITTED,
      campaign: { autoVerify: false },
      reviewDeadline: { lt: now },
    };
    const [items, total] = await Promise.all([
      this.prisma.taskCompletion.findMany({
        where,
        select: {
          id: true,
          proofUrl: true,
          submittedAt: true,
          reviewDeadline: true,
          creditsEarned: true,
          campaign: {
            select: {
              id: true,
              title: true,
              taskType: true,
              creditPerTask: true,
              user: { select: { username: true } },
            },
          },
          user: { select: { id: true, username: true } },
        },
        orderBy: { reviewDeadline: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.taskCompletion.count({ where }),
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async reviewSubmission(
    adminId: string,
    completionId: string,
    dto: { action: 'approve' | 'reject'; reason?: string },
  ) {
    const completion = await this.prisma.taskCompletion.findUnique({
      where: { id: completionId },
      select: {
        id: true,
        status: true,
        userId: true,
        campaign: {
          select: {
            id: true,
            creditPerTask: true,
            completedSlots: true,
            totalSlots: true,
          },
        },
      },
    });
    if (!completion) throw new NotFoundException('Submission not found');
    if (completion.status !== CompletionStatus.SUBMITTED) {
      throw new BadRequestException(`Submission is already ${completion.status.toLowerCase()}`);
    }

    const now = new Date();

    if (dto.action === 'approve') {
      await this.prisma.withTransaction(async (tx) => {
        await tx.taskCompletion.update({
          where: { id: completionId },
          data: {
            status: CompletionStatus.VERIFIED,
            verifiedAt: now,
            verifiedBy: adminId,
            creditsEarned: completion.campaign.creditPerTask,
          },
        });

        const newCompleted = completion.campaign.completedSlots + 1;
        const isFull = newCompleted >= completion.campaign.totalSlots;

        await tx.campaign.update({
          where: { id: completion.campaign.id },
          data: {
            completedSlots: { increment: 1 },
            pendingSlots: { decrement: 1 },
            ...(isFull && { status: CampaignStatus.COMPLETED, completedAt: now }),
          },
        });

        await tx.userProfile.updateMany({
          where: { userId: completion.userId },
          data: { totalTasksDone: { increment: 1 } },
        });
      });

      await this.walletService.credit(completion.userId, completion.campaign.creditPerTask, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: 'Task proof approved',
        referenceId: completion.campaign.id,
        referenceType: 'campaign',
      });

      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'submission.approved',
          entityType: 'TaskCompletion',
          entityId: completionId,
          newValue: { creditsPaid: completion.campaign.creditPerTask },
        },
      });

      return { status: 'VERIFIED', creditsPaid: completion.campaign.creditPerTask };
    } else {
      await this.prisma.taskCompletion.update({
        where: { id: completionId },
        data: {
          status: CompletionStatus.REJECTED,
          verifiedAt: now,
          verifiedBy: adminId,
          rejectionReason: dto.reason ?? 'Proof did not meet requirements',
        },
      });

      await this.prisma.campaign.update({
        where: { id: completion.campaign.id },
        data: { pendingSlots: { decrement: 1 } },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'submission.rejected',
          entityType: 'TaskCompletion',
          entityId: completionId,
          newValue: { reason: dto.reason },
        },
      });

      return { status: 'REJECTED' };
    }
  }

  // ─── Campaigns ────────────────────────────────────────────

  async listPendingCampaigns(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { status: CampaignStatus.PENDING_REVIEW };

    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        select: {
          id: true, title: true, taskType: true, targetUrl: true,
          totalSlots: true, creditPerTask: true, status: true, createdAt: true,
          user: { select: { id: true, username: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async reviewCampaign(adminId: string, campaignId: string, dto: ReviewCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true, title: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new BadRequestException('Campaign is not pending review');
    }

    const newStatus = dto.action === 'approve' ? CampaignStatus.ACTIVE : CampaignStatus.REJECTED;

    const updated = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: newStatus },
      select: { id: true, title: true, status: true, userId: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `campaign.${dto.action}`,
        entityType: 'Campaign',
        entityId: campaignId,
        newValue: { status: newStatus, notes: dto.notes },
      },
    });

    void this.notificationsService.createNotification(
      updated.userId,
      dto.action === 'approve' ? 'CAMPAIGN_ACTIVE' : 'CAMPAIGN_REJECTED',
      dto.action === 'approve' ? 'Campaign Approved' : 'Campaign Rejected',
      dto.action === 'approve'
        ? `Your campaign "${updated.title}" has been approved and is now live.`
        : `Your campaign "${updated.title}" was rejected. Reason: ${dto.notes ?? 'Contact support for details.'}`,
      { campaignId, status: newStatus, notes: dto.notes },
    ).catch(() => null);

    return updated;
  }

  // ─── Reports ──────────────────────────────────────────────

  async listReports(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.ReportWhereInput = status && status !== 'ALL'
      ? { status: status as ReportStatus }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        select: {
          id: true, reason: true, description: true, status: true, createdAt: true,
          submittedBy: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          targetUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          campaign: { select: { id: true, title: true } },
          topic: { select: { id: true, title: true } },
          reply: { select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async resolveReport(adminId: string, reportId: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        status: true,
        targetUserId: true,
        targetUser: { select: { username: true } },
        submittedById: true,
        reason: true,
        topicId: true,
        replyId: true,
        campaignId: true,
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN && report.status !== ReportStatus.UNDER_REVIEW) {
      throw new BadRequestException('Report is already resolved');
    }

    // Derive topicId from reply if needed for notification routing
    let replyTopicId: string | undefined;
    if (report.replyId && !report.topicId) {
      const reply = await this.prisma.forumReply.findUnique({
        where: { id: report.replyId },
        select: { topicId: true },
      });
      replyTopicId = reply?.topicId ?? undefined;
    }

    // Execute admin action on reported user if provided
    const action = dto.action ?? 'NONE';
    if (action !== 'NONE' && report.targetUserId) {
      const targetUserId = report.targetUserId;
      const adminNote = dto.notes ?? `Report resolved with action: ${action}`;

      if (action === 'DEDUCT_TRUST') {
        const amount = Math.max(1, Math.min(50, dto.deductionAmount ?? 15));
        await this.prisma.trustScore.updateMany({
          where: { userId: targetUserId },
          data: { score: { decrement: amount } },
        });
      } else if (action === 'SUSPEND') {
        await this.prisma.user.update({
          where: { id: targetUserId },
          data: { status: 'SUSPENDED' },
        });
      } else if (action === 'BAN') {
        await this.prisma.user.update({
          where: { id: targetUserId },
          data: { status: 'BANNED' },
        });
      }

      // Send notification to reported user
      await this.notificationsService.createNotification(
        targetUserId,
        action === 'WARN' ? 'ACCOUNT_WARNING' : 'SECURITY_ALERT',
        action === 'WARN' ? 'Account Warning' : 'Account Action Taken',
        action === 'DEDUCT_TRUST'
          ? `Your trust score was deducted due to a report: ${report.reason}. ${adminNote}`
          : action === 'SUSPEND'
            ? `Your account has been suspended. Reason: ${report.reason}. ${adminNote}`
            : action === 'BAN'
              ? `Your account has been banned. Reason: ${report.reason}. ${adminNote}`
              : `Warning: ${adminNote}`,
        {
          reportId,
          action,
          topicId: report.topicId ?? undefined,
          replyId: report.replyId ?? undefined,
          replyTopicId: replyTopicId ?? undefined,
          targetUserId: report.targetUserId ?? undefined,
          targetUsername: report.targetUser?.username ?? undefined,
        },
      );
    } else if (report.targetUserId) {
      // No action taken (e.g. dismissed) — notify reported user that no action was taken
      await this.notificationsService.createNotification(
        report.targetUserId,
        'REPORT_RESOLVED',
        'Report Dismissed',
        `A report against you was reviewed and dismissed. No action was taken.`,
        {
          reportId,
          topicId: report.topicId ?? undefined,
          replyId: report.replyId ?? undefined,
          replyTopicId: replyTopicId ?? undefined,
          targetUserId: report.targetUserId ?? undefined,
          targetUsername: report.targetUser?.username ?? undefined,
        },
      );
    }

    // Notify reporter that their report was resolved
    if (report.submittedById) {
      await this.notificationsService.createNotification(
        report.submittedById,
        'REPORT_RESOLVED',
        'Report Resolved',
        `Your report (${report.reason}) was ${dto.status.toLowerCase()} by the moderation team.`,
        {
          reportId,
          status: dto.status,
          action,
          topicId: report.topicId ?? undefined,
          replyId: report.replyId ?? undefined,
          replyTopicId: replyTopicId ?? undefined,
          targetUserId: report.targetUserId ?? undefined,
          targetUsername: report.targetUser?.username ?? undefined,
        },
      );
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.status as ReportStatus,
        adminNotes: dto.notes,
        resolvedBy: adminId,
        resolvedAt: new Date(),
      },
      select: { id: true, status: true, reason: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `report.${dto.status.toLowerCase()}`,
        entityType: 'Report',
        entityId: reportId,
        newValue: { status: dto.status, notes: dto.notes, action },
      },
    });

    return updated;
  }

  // ─── Notifications ──────────────────────────────────────

  async listAllNotifications(page = 1, limit = 50, type?: string, userId?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.NotificationWhereInput = {};
    if (type) where.type = type as Prisma.EnumNotificationTypeFilter;
    if (userId) where.userId = userId;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          isRead: true,
          createdAt: true,
          user: { select: { id: true, username: true, displayName: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async deleteNotification(adminId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true, type: true },
    });
    if (notification) {
      this.eventsService.emitToUser(notification.userId, 'notification:deleted', { id });
    }
    await this.prisma.notification.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'notification.deleted',
        entityType: 'Notification',
        entityId: id,
        metadata: notification ? { type: notification.type, affectedUserId: notification.userId } : {}
      },
    });
    return { success: true };
  }

  async clearNotifications(userId?: string) {
    const where: Prisma.NotificationWhereInput = userId ? { userId } : {};
    const { count } = await this.prisma.notification.deleteMany({ where });
    if (userId) {
      this.eventsService.emitToUser(userId, 'notification:all-deleted', {});
    }
    return { success: true, deletedCount: count };
  }

  // ─── Credits ──────────────────────────────────────────────

  async grantCredits(adminId: string, userId: string, dto: GrantCreditsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.action === 'grant') {
      await this.walletService.credit(userId, dto.amount, {
        type: TransactionType.EARN_ADMIN_GRANT,
        description: `Admin grant: ${dto.reason}`,
        referenceId: adminId,
        referenceType: 'admin',
      });
    } else {
      await this.walletService.debit(userId, dto.amount, {
        type: TransactionType.SPEND_ADMIN_DEDUCT,
        description: `Admin deduction: ${dto.reason}`,
        referenceId: adminId,
        referenceType: 'admin',
      });
    }

    const wallet = await this.walletService.getWallet(userId);
    this.eventsService.emitToUser(userId, 'wallet:updated', {
      balance: wallet.balance,
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeSpent: wallet.lifetimeSpent,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `wallet.admin_${dto.action}`,
        entityType: 'User',
        entityId: userId,
        newValue: { amount: dto.amount, action: dto.action, reason: dto.reason },
      },
    });

    return { success: true, userId, action: dto.action, amount: dto.amount };
  }

  // ─── Trust Score ──────────────────────────────────────────

  async adjustTrustScore(adminId: string, userId: string, dto: AdjustTrustDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user) throw new NotFoundException('User not found');

    const delta = dto.action === 'add' ? dto.amount : -dto.amount;
    const trust = await this.prisma.trustScore.upsert({
      where: { userId },
      create: {
        userId,
        score: Math.max(0, Math.min(100, 50 + delta)),
        level: 'NEW',
        completionRate: 0,
        accountAgeDays: 0,
        verifiedSocials: 0,
        reportCount: 0,
        abuseFlagCount: 0,
      },
      update: {
        score: { increment: delta },
      },
    });

    // Clamp after increment
    const clamped = Math.max(0, Math.min(100, trust.score));
    if (clamped !== trust.score) {
      await this.prisma.trustScore.update({ where: { userId }, data: { score: clamped } });
    }

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `trust.admin_${dto.action}`,
        entityType: 'User',
        entityId: userId,
        newValue: { amount: dto.amount, action: dto.action, reason: dto.reason, newScore: clamped },
      },
    });

    return { success: true, userId, action: dto.action, amount: dto.amount, newScore: clamped };
  }

  async updateUserDetails(userId: string, dto: UpdateUserDetailsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updateData: Record<string, string> = {};

    if (dto.email && dto.email !== user.email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existingEmail) throw new BadRequestException('Email already in use');
      updateData.email = dto.email;
    }

    if (dto.username && dto.username !== user.username) {
      const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (existingUsername) throw new BadRequestException('Username already taken');
      updateData.username = dto.username;
    }

    if (dto.displayName !== undefined) {
      updateData.displayName = dto.displayName;
    }

    if (dto.password) {
      const { default: argon2 } = await import('argon2');
      updateData.passwordHash = await argon2.hash(dto.password);
    }

    if (Object.keys(updateData).length === 0) {
      return { success: true, message: 'No changes made' };
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
      },
    });

    return { success: true, user: updated };
  }

  async disableUserTwoFactor(adminId: string, adminRole: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, twoFactorTotpSecret: true, twoFactorEmailEnabled: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.SUPER_ADMIN && adminRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can modify another SUPER_ADMIN account');
    }
    if (!user.twoFactorTotpSecret && !user.twoFactorEmailEnabled) {
      throw new BadRequestException('User does not have 2FA enabled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorTotpSecret: null, twoFactorEmailEnabled: false },
      });
      await tx.twoFactorCode.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'user.2fa.disabled',
        entityType: 'User',
        entityId: userId,
        oldValue: {
          totpEnabled: !!user.twoFactorTotpSecret,
          emailEnabled: user.twoFactorEmailEnabled,
        },
        newValue: { totpEnabled: false, emailEnabled: false },
      },
    });

    return { message: `2FA disabled for @${user.username}.` };
  }

  async deleteUser(adminId: string, userId: string) {
    if (adminId === userId) throw new BadRequestException('Cannot delete your own account');
    
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.SUPER_ADMIN) throw new ForbiddenException('Cannot delete a SUPER_ADMIN account');

    await this.prisma.$transaction(async (tx) => {
      // Step 1: Null out self-referential referred_by_id on OTHER users who were referred by this user
      await tx.$executeRawUnsafe(`UPDATE "users" SET "referred_by_id" = NULL WHERE "referred_by_id" = $1`, userId);

      // Step 2: Delete task_completions for ALL completions in this user's campaigns (by any user)
      // Must happen before campaigns can be deleted
      await tx.$executeRawUnsafe(`DELETE FROM "task_completions" WHERE "campaign_id" IN (SELECT "id" FROM "campaigns" WHERE "user_id" = $1)`, userId);

      // Step 3: Delete this user's own task_completions in other people's campaigns
      await tx.$executeRawUnsafe(`DELETE FROM "task_completions" WHERE "user_id" = $1`, userId);

      // Step 4: Delete reports that reference this user's campaigns (campaign_id FK)
      await tx.$executeRawUnsafe(`DELETE FROM "reports" WHERE "campaign_id" IN (SELECT "id" FROM "campaigns" WHERE "user_id" = $1)`, userId);

      // Step 5: Delete reports where user is the submitter or target
      await tx.$executeRawUnsafe(`DELETE FROM "reports" WHERE "target_user_id" = $1 OR "submitted_by_id" = $1`, userId, userId);

      // Step 6: Delete this user's campaigns (now safe — completions and reports removed)
      await tx.$executeRawUnsafe(`DELETE FROM "campaigns" WHERE "user_id" = $1`, userId);

      // Step 7: Delete referrals (referrer or referee)
      await tx.$executeRawUnsafe(`DELETE FROM "referrals" WHERE "referrer_id" = $1 OR "referee_id" = $1`, userId, userId);

      // Step 8: Delete transactions BEFORE wallet is cascade-deleted with the user
      // Transaction → Wallet FK has no cascade, so wallet deletion would fail otherwise
      await tx.$executeRawUnsafe(`DELETE FROM "transactions" WHERE "wallet_id" IN (SELECT "id" FROM "wallets" WHERE "user_id" = $1)`, userId);

      // Step 9: Delete other non-cascade tables
      await tx.$executeRawUnsafe(`DELETE FROM "xp_events" WHERE "user_id" = $1`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM "abuse_flags" WHERE "user_id" = $1`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM "ip_records" WHERE "user_id" = $1`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM "device_fingerprints" WHERE "user_id" = $1`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "user_id" = $1`, userId);

      // Step 10: Delete the user — DB cascade handles:
      // user_profiles, user_sessions, email_verifications, password_resets,
      // social_accounts, wallets (+ transactions already gone), user_achievements,
      // user_mission_progress, trust_scores, notifications
      await tx.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1`, userId);
    });

    // Create audit log entry AFTER transaction using admin's ID (admin still exists)
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'user.deleted',
        entityType: 'User',
        entityId: userId,
        oldValue: { username: user.username, role: user.role },
      },
    });

    return { success: true };
  }

  // ─── Audit log ────────────────────────────────────────────

  async getAuditLog(page = 1, limit = 50, action?: string, entityType?: string) {
    const skip = (page - 1) * limit;
    const where = {
      ...(action && { action: { contains: action, mode: 'insensitive' as const } }),
      ...(entityType && { entityType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true, action: true, entityType: true, entityId: true,
          oldValue: true, newValue: true, ipAddress: true, createdAt: true,
          user: { select: { username: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── OAuth Config (SUPER_ADMIN only) ─────────────────────

  private readonly ALL_SOCIAL_PLATFORMS = [
    'YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'TWITTER',
    'TWITCH', 'SPOTIFY', 'TELEGRAM', 'DISCORD', 'TRUSTPILOT', 'GOOGLE',
  ] as const;

  private readonly OAUTH_PLATFORMS = ['YOUTUBE', 'TWITCH', 'SPOTIFY'] as const;

  async getOAuthConfigs() {
    const configs = await this.prisma.oAuthConfig.findMany({
      select: {
        platform: true,
        clientId: true,
        clientSecret: true,
        enabled: true,
        updatedAt: true,
        updatedById: true,
      },
    });

    // Build a map for O(1) lookup
    const configMap = new Map(configs.map((c) => [c.platform, c]));

    return this.ALL_SOCIAL_PLATFORMS.map((platform) => {
      const cfg = configMap.get(platform as never);
      const isOAuth = (this.OAUTH_PLATFORMS as readonly string[]).includes(platform);
      return {
        platform,
        clientId: cfg?.clientId ?? null,
        clientSecretSet: !!cfg?.clientSecret,
        enabled: cfg?.enabled ?? true,
        isOAuth,
        updatedAt: cfg?.updatedAt ?? null,
      };
    });
  }

  async updateOAuthConfig(
    adminId: string,
    platform: string,
    dto: { clientId?: string; clientSecret?: string; enabled?: boolean },
  ) {
    const p = platform.toUpperCase() as never;
    if (!this.ALL_SOCIAL_PLATFORMS.includes(p)) {
      throw new BadRequestException(`Unknown platform: ${platform}`);
    }

    const isOAuth = (this.OAUTH_PLATFORMS as readonly string[]).includes(p);
    const data: {
      clientId?: string | null;
      clientSecret?: string | null;
      enabled?: boolean;
      updatedById: string;
    } = { updatedById: adminId };

    if (dto.clientId !== undefined)     data.clientId     = dto.clientId || null;
    if (dto.clientSecret !== undefined) data.clientSecret = dto.clientSecret || null;
    if (dto.enabled !== undefined)      data.enabled      = dto.enabled;

    await this.prisma.oAuthConfig.upsert({
      where: { platform: p },
      create: { platform: p, ...data },
      update: data,
    });

    // If platform was disabled, pause all active campaigns that use it
    if (dto.enabled === false) {
      await this.pauseCampaignsForPlatform(p, adminId);
    }

    this.eventsService.emitBroadcast('platform:updated', { platform: p, enabled: dto.enabled });

    return { updated: true, platform };
  }

  private async pauseCampaignsForPlatform(platform: string, adminId: string) {
    const taskTypes = SocialAuthService.getTaskTypesForPlatform(platform as SocialPlatform);
    if (!taskTypes.length) return { paused: 0 };

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.ACTIVE,
        taskType: { in: taskTypes as never },
      },
      select: { id: true, userId: true, title: true },
    });

    if (!campaigns.length) return { paused: 0 };

    await this.prisma.campaign.updateMany({
      where: {
        id: { in: campaigns.map((c) => c.id) },
        status: CampaignStatus.ACTIVE,
      },
      data: { status: CampaignStatus.PAUSED },
    });

    // Notify campaign creators
    for (const campaign of campaigns) {
      await this.notificationsService.createNotification(
        campaign.userId,
        'SYSTEM_ANNOUNCEMENT',
        'Campaign Paused — Platform Disabled',
        `Your campaign "${campaign.title}" was paused because the ${platform} platform has been disabled by an administrator. You may resume it once the platform is re-enabled or change the task type.`,
        { campaignId: campaign.id, platform, reason: 'PLATFORM_DISABLED' },
      );
    }

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'campaign.bulk_pause',
        entityType: 'Campaign',
        entityId: campaigns.map((c) => c.id).join(','),
        newValue: { reason: 'PLATFORM_DISABLED', platform, count: campaigns.length },
      },
    });

    return { paused: campaigns.length };
  }

  // ─── Platform Config (SUPER_ADMIN only) ──────────────────────

  private readonly CONFIG_DEFAULTS: Record<string, { value: unknown; description: string; isPublic: boolean }> = {
    initial_credits:         { value: 200,   description: 'Welcome credits given to each new user on registration', isPublic: false },
    referral_bonus_referrer: { value: 50,    description: 'Credits given to referrer when their invite qualifies', isPublic: false },
    referral_bonus_referee:  { value: 50,    description: 'Bonus credits for new users who sign up via referral link', isPublic: false },
    registration_enabled:    { value: true,  description: 'Allow new user registrations', isPublic: true },
    maintenance_mode:        { value: false, description: 'Put the platform in read-only maintenance mode', isPublic: true },
    recaptcha_enabled:       { value: false, description: 'Enable reCAPTCHA protection on auth endpoints', isPublic: true },
    recaptcha_version:       { value: 'v3',  description: 'reCAPTCHA version to use (v2 checkbox or v3 invisible)', isPublic: true },
    recaptcha_v3_site_key:   { value: '',    description: 'reCAPTCHA v3 public site key (invisible)', isPublic: true },
    recaptcha_v3_secret_key: { value: '',    description: 'reCAPTCHA v3 secret key (server-side verification)', isPublic: false },
    recaptcha_v2_site_key:   { value: '',    description: 'reCAPTCHA v2 Checkbox public site key', isPublic: true },
    recaptcha_v2_secret_key: { value: '',    description: 'reCAPTCHA v2 Checkbox secret key (server-side verification)', isPublic: false },
    groq_api_key:            { value: '',    description: 'Groq API key for AI chat support', isPublic: false },
    groq_model:              { value: 'llama-3.3-70b-versatile', description: 'Groq model to use for AI chat (e.g., llama-3.3-70b-versatile, llama-3.1-8b-instant)', isPublic: false },
    trust_score_completion_weight: { value: 40, description: 'Weight multiplier for task completion rate in trust score (0-100)', isPublic: false },
    trust_score_age_max:         { value: 20, description: 'Maximum points awarded for account age in trust score', isPublic: false },
    trust_score_social_per:      { value: 5,  description: 'Points per verified social account in trust score', isPublic: false },
    trust_score_social_max:      { value: 25, description: 'Maximum points cap for verified social accounts', isPublic: false },
    trust_score_flag_max:        { value: 15, description: 'Maximum points from abuse flag cleanliness in trust score', isPublic: false },
    trust_score_flag_threshold:  { value: 5,  description: 'Number of bad flags before flag points reach zero', isPublic: false },
    trust_score_report_max:      { value: 10, description: 'Maximum trust score penalty from received reports', isPublic: false },
    trust_score_report_threshold:{ value: 10, description: 'Number of reports before full report penalty applies', isPublic: false },
    trust_score_task_bonus:      { value: 2,  description: 'Flat trust score bonus awarded per verified completed task', isPublic: false },
    leaderboard_include_admins:  { value: true, description: 'Include admin/moderator/super_admin users in public leaderboards', isPublic: false },
    // ── Platform Fees (C3) ────────────────────────────────
    fee_base_rate:               { value: 0.10, description: 'Base platform fee rate on campaign creation (0.10 = 10%)', isPublic: true },
    fee_promo_enabled:           { value: false, description: 'Enable promotional fee discount event', isPublic: true },
    fee_promo_rate:              { value: 0.05, description: 'Promotional fee rate when enabled (0.05 = 5%)', isPublic: true },
    fee_promo_until:             { value: '', description: 'ISO 8601 end date for promotional fee (empty = no promo)', isPublic: true },
    campaign_min_budget:         { value: 100, description: 'Minimum campaign budget (totalSlots * creditPerTask) in credits', isPublic: true },
    // ── PayMongo ──────────────────────────────────────────
    paymongo_enabled:            { value: false, description: 'Enable PayMongo payment gateway', isPublic: true },
    paymongo_public_key:         { value: '',    description: 'PayMongo public key (pk_test_ or pk_live_)', isPublic: false },
    paymongo_secret_key:         { value: '',    description: 'PayMongo secret key (sk_test_ or sk_live_)', isPublic: false },
    paymongo_webhook_secret:     { value: '',    description: 'PayMongo webhook secret (whsk_test_ or whsk_live_)', isPublic: false },
    // ── PayPal ───────────────────────────────────────────
    paypal_enabled:              { value: false, description: 'Enable PayPal payment gateway', isPublic: true },
    paypal_client_id:            { value: '',    description: 'PayPal client ID', isPublic: false },
    paypal_client_secret:        { value: '',    description: 'PayPal client secret', isPublic: false },
    paypal_mode:                 { value: 'sandbox', description: 'PayPal mode (sandbox or live)', isPublic: false },
    // ── Crypto ───────────────────────────────────────────
    usdt_bep20_enabled:          { value: false, description: 'Enable USDT BEP20 (BSC) deposits', isPublic: true },
    usdt_bep20_wallet_address:   { value: '',    description: 'BSC wallet address for USDT BEP20 deposits', isPublic: true },
    usdt_bep20_contract:         { value: '0x55d398326f99059fF775485246999027B3197955', description: 'USDT BEP20 contract address (BSC)', isPublic: true },
    usdt_base_enabled:           { value: false, description: 'Enable USDT Base deposits', isPublic: true },
    usdt_base_wallet_address:    { value: '',    description: 'Base wallet address for USDT deposits', isPublic: true },
    usdt_base_contract:          { value: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', description: 'USDT contract address (Base)', isPublic: true },
    // ── Pricing ───────────────────────────────────────────
    credits_per_usd:             { value: 5000,  description: 'Credits per $1 USD (canonical rate)', isPublic: true },
    min_deposit_usd:             { value: 1,     description: 'Minimum deposit amount in USD', isPublic: true },
  };

  async getServerConfig() {
    const rows = await this.prisma.platformConfig.findMany();
    const map = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(this.CONFIG_DEFAULTS).map(([key, def]) => {
      const row = map.get(key);
      return {
        key,
        value: row ? row.value : def.value,
        description: def.description,
        isPublic: def.isPublic,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }

  async updateServerConfig(adminId: string, key: string, value: Prisma.InputJsonValue) {
    if (!this.CONFIG_DEFAULTS[key]) {
      throw new BadRequestException(`Unknown config key: ${key}`);
    }
    await this.prisma.platformConfig.upsert({
      where: { key },
      create: {
        key,
        value: value,
        description: this.CONFIG_DEFAULTS[key].description,
        isPublic: this.CONFIG_DEFAULTS[key].isPublic,
        updatedBy: adminId,
      },
      update: { value, updatedBy: adminId },
    });
    // Invalidate reCAPTCHA cache if any reCAPTCHA-related config was updated
    if (key.startsWith('recaptcha_')) {
      this.authService.invalidateRecaptchaCache();
    }
    return { updated: true, key };
  }

  // ─── CSV Export ───────────────────────────────────────────────

  private csvEscape(val: unknown): string {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }

  private toCsv(headers: string[], rows: Record<string, unknown>[]): string {
    return [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => this.csvEscape(r[h])).join(',')),
    ].join('\n');
  }

  async exportCsv(table: string): Promise<{ csv: string; filename: string }> {
    const date = new Date().toISOString().slice(0, 10);
    switch (table) {
      case 'users': {
        const rows = await this.prisma.user.findMany({
          select: { id: true, username: true, email: true, role: true, status: true, level: true, xp: true, creditBalance: true, currentStreak: true, referralCode: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        });
        return {
          filename: `users_${date}.csv`,
          csv: this.toCsv(
            ['id','username','email','role','status','level','xp','creditBalance','currentStreak','referralCode','createdAt'],
            rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          ),
        };
      }
      case 'campaigns': {
        const rows = await this.prisma.campaign.findMany({
          select: { id: true, title: true, taskType: true, status: true, totalSlots: true, completedSlots: true, creditPerTask: true, totalCost: true, createdAt: true, user: { select: { username: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return {
          filename: `campaigns_${date}.csv`,
          csv: this.toCsv(
            ['id','username','title','taskType','status','totalSlots','completedSlots','creditPerTask','totalCost','createdAt'],
            rows.map((r) => ({ ...r, username: r.user.username, createdAt: r.createdAt.toISOString() })),
          ),
        };
      }
      case 'completions': {
        const rows = await this.prisma.taskCompletion.findMany({
          select: { id: true, status: true, creditsEarned: true, assignedAt: true, submittedAt: true, verifiedAt: true, user: { select: { username: true } }, campaign: { select: { id: true, taskType: true } } },
          orderBy: { assignedAt: 'desc' },
        });
        return {
          filename: `completions_${date}.csv`,
          csv: this.toCsv(
            ['id','username','status','creditsEarned','campaignId','taskType','assignedAt','submittedAt','verifiedAt'],
            rows.map((r) => ({
              ...r,
              username: r.user.username,
              campaignId: r.campaign.id,
              taskType: r.campaign.taskType,
              assignedAt: r.assignedAt.toISOString(),
              submittedAt: r.submittedAt?.toISOString() ?? '',
              verifiedAt: r.verifiedAt?.toISOString() ?? '',
            })),
          ),
        };
      }
      case 'transactions': {
        const rows = await this.prisma.transaction.findMany({
          select: { id: true, type: true, status: true, amount: true, balanceBefore: true, balanceAfter: true, description: true, referenceType: true, createdAt: true, wallet: { select: { user: { select: { username: true } } } } },
          orderBy: { createdAt: 'desc' },
        });
        return {
          filename: `transactions_${date}.csv`,
          csv: this.toCsv(
            ['id','username','type','status','amount','balanceBefore','balanceAfter','description','referenceType','createdAt'],
            rows.map((r) => ({
              ...r,
              username: r.wallet.user.username,
              description: r.description ?? '',
              referenceType: r.referenceType ?? '',
              createdAt: r.createdAt.toISOString(),
            })),
          ),
        };
      }
      case 'audit_logs': {
        const rows = await this.prisma.auditLog.findMany({
          select: { id: true, action: true, entityType: true, entityId: true, ipAddress: true, createdAt: true, user: { select: { username: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50_000,
        });
        return {
          filename: `audit_logs_${date}.csv`,
          csv: this.toCsv(
            ['id','username','action','entityType','entityId','ipAddress','createdAt'],
            rows.map((r) => ({
              ...r,
              username: r.user?.username ?? 'system',
              entityType: r.entityType ?? '',
              entityId: r.entityId ?? '',
              ipAddress: r.ipAddress ?? '',
              createdAt: r.createdAt.toISOString(),
            })),
          ),
        };
      }
      default:
        throw new BadRequestException(`Unknown export table: ${table}`);
    }
  }

  // ─── System Operations (SUPER_ADMIN only) ────────────────────

  async clearAuditLogs(adminId: string) {
    const count = await this.prisma.auditLog.count();
    await this.prisma.auditLog.deleteMany({});
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'system.clear_audit_logs',
        entityType: 'AuditLog',
        metadata: { deletedCount: count },
      },
    });
    return { deleted: count };
  }

  async resetDatabase(adminId: string, confirmToken: string) {
    if (confirmToken !== 'RESET') {
      throw new BadRequestException('Confirmation token must be exactly "RESET"');
    }

    const creditRow = await this.prisma.platformConfig.findUnique({ where: { key: 'initial_credits' } });
    const initialCredits: number = typeof creditRow?.value === 'number' ? creditRow.value : 200;

    // Only the two seeded owner accounts are preserved — everyone else is wiped
    const keptUsers = await this.prisma.user.findMany({
      where: { username: { in: ['admin', 'botro'] } },
      select: { id: true, username: true },
    });
    const keptIds = keptUsers.map((u) => u.id);

    if (!keptIds.includes(adminId)) {
      throw new ForbiddenException('Only the seeded admin accounts may reset the database');
    }

    await this.prisma.$transaction(
      async (tx) => {
        // ── Reports first (reference users, campaigns, forum topics, forum replies) ──
        await tx.report.deleteMany({});

        // ── Forum (reactions → replies → topics) ──────────────────────────────────
        await tx.forumReaction.deleteMany({});
        await tx.forumReply.deleteMany({});
        await tx.forumTopic.deleteMany({});

        // ── Chat ──────────────────────────────────────────────────────────────────
        await tx.chatMessage.deleteMany({});
        await tx.chatConversation.deleteMany({});

        // ── Core activity data ────────────────────────────────────────────────────
        await tx.platformRevenue.deleteMany({}); // before campaigns (FK to campaign)
        await tx.deposit.deleteMany({});
        await tx.taskCompletion.deleteMany({});
        await tx.transaction.deleteMany({});   // before user delete (wallet cascade would restrict)
        await tx.campaign.deleteMany({});
        await tx.referral.deleteMany({});
        await tx.abuseFlag.deleteMany({});
        await tx.ipRecord.deleteMany({});
        await tx.xpEvent.deleteMany({});
        await tx.deviceFingerprint.deleteMany({});
        await tx.auditLog.deleteMany({});
        await tx.analyticsSnapshot.deleteMany({});

        // ── Delete all users except kept accounts ──────────────────────────────────
        // DB cascades: wallets, sessions, email_verifications, password_resets,
        // social_accounts, notifications, achievements, mission_progress,
        // trust_scores, profiles, two_factor_codes, two_factor_backup_codes
        await tx.user.deleteMany({ where: { id: { notIn: keptIds } } });

        // ── Reset kept accounts (stats only — credentials and 2FA are preserved) ──
        await tx.notification.deleteMany({ where: { userId: { in: keptIds } } });
        await tx.userAchievement.deleteMany({ where: { userId: { in: keptIds } } });
        await tx.userMissionProgress.deleteMany({ where: { userId: { in: keptIds } } });

        for (const kept of keptUsers) {
          await tx.user.update({
            where: { id: kept.id },
            data: {
              creditBalance: initialCredits,
              xp: 0, level: 1,
              currentStreak: 0, longestStreak: 0,
              lastActiveAt: null, lastDailyRewardAt: null,
            },
          });
          const wallet = await tx.wallet.upsert({
            where: { userId: kept.id },
            create: { userId: kept.id, balance: initialCredits, lifetimeEarned: initialCredits, lifetimeSpent: 0 },
            update: { balance: initialCredits, lifetimeEarned: initialCredits, lifetimeSpent: 0, version: 0 },
          });
          await tx.transaction.create({
            data: {
              walletId: wallet.id,
              type: 'EARN_ADMIN_GRANT',
              status: 'COMPLETED',
              amount: initialCredits,
              balanceBefore: 0,
              balanceAfter: initialCredits,
              description: 'Database reset — initial credits restored',
            },
          });

          // Ensure welcome notification for preserved accounts
          const existingWelcome = await tx.notification.findFirst({
            where: { userId: kept.id, type: NotificationType.WELCOME },
          });
          if (!existingWelcome) {
            await tx.notification.create({
              data: {
                userId: kept.id,
                type: NotificationType.WELCOME,
                title: 'Welcome to Engganyo!',
                body: 'Thanks for joining. Complete tasks, earn credits, and grow your presence. Check out available campaigns to get started!',
                data: { href: '/dashboard' },
              },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'system.database_reset',
            entityType: 'System',
            metadata: {
              keptAccounts: keptUsers.map((u) => u.username),
              initialCredits,
              timestamp: new Date().toISOString(),
            },
          },
        });
      },
      { timeout: 60_000 },
    );

    return { reset: true, keptAccounts: keptUsers.map((u) => u.username), initialCredits };
  }

  // ─── System Stats (SUPER_ADMIN) ─────────────────────────

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  async getSystemStats() {
    // ── Database ──────────────────────────────────────────────
    const [dbSizeRows, tableRows, connRows] = await Promise.all([
      this.prisma.$queryRaw<{ db_size: string; db_size_bytes: bigint }[]>`
        SELECT
          pg_size_pretty(pg_database_size(current_database())) AS db_size,
          pg_database_size(current_database())                 AS db_size_bytes
      `,
      this.prisma.$queryRaw<{ table_name: string; live_rows: bigint; total_size: string; total_size_bytes: bigint }[]>`
        SELECT
          relname                                                                AS table_name,
          n_live_tup                                                             AS live_rows,
          pg_size_pretty(pg_total_relation_size('"public"."' || relname || '"')) AS total_size,
          pg_total_relation_size('"public"."' || relname || '"')                AS total_size_bytes
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY total_size_bytes DESC
        LIMIT 20
      `,
      this.prisma.$queryRaw<{ active: bigint }[]>`
        SELECT count(*) AS active
        FROM pg_stat_activity
        WHERE datname = current_database() AND state IS NOT NULL
      `,
    ]);

    // ── Upload storage ────────────────────────────────────────
    let uploadSizeBytes = 0;
    let uploadFileCount = 0;
    const uploadsRoot = path.join(process.cwd(), 'uploads');
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(full);
        else { uploadSizeBytes += fs.statSync(full).size; uploadFileCount++; }
      }
    };
    walkDir(uploadsRoot);

    // ── Server ────────────────────────────────────────────────
    const mem = process.memoryUsage();

    return {
      database: {
        size: dbSizeRows[0]?.db_size ?? '0 B',
        sizeBytes: Number(dbSizeRows[0]?.db_size_bytes ?? 0),
        activeConnections: Number(connRows[0]?.active ?? 0),
        tables: tableRows.map((t) => ({
          name: t.table_name,
          liveRows: Number(t.live_rows),
          size: t.total_size,
          sizeBytes: Number(t.total_size_bytes),
        })),
      },
      uploads: {
        sizeBytes: uploadSizeBytes,
        size: this.formatBytes(uploadSizeBytes),
        fileCount: uploadFileCount,
      },
      server: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        rssBytes: mem.rss,
        systemMemFreeBytes: os.freemem(),
        systemMemTotalBytes: os.totalmem(),
        loadAvg: os.loadavg(),
        platform: os.platform(),
      },
    };
  }

  // ─── Overview stats ───────────────────────────────────────

  async getOverviewStats() {
    const [
      totalUsers, activeUsers, suspendedUsers,
      totalCampaigns, pendingCampaigns,
      openReports,
      totalTasks,
      pendingDeposits,
      completedDepositsAgg,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.campaign.count(),
      this.prisma.campaign.count({ where: { status: CampaignStatus.PENDING_REVIEW } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
      this.prisma.taskCompletion.count({ where: { status: 'VERIFIED' } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.deposit.aggregate({ where: { status: DepositStatus.COMPLETED }, _sum: { amountFiat: true } }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers },
      campaigns: { total: totalCampaigns, pending: pendingCampaigns },
      reports: { open: openReports },
      tasks: { verified: totalTasks },
      deposits: { pending: pendingDeposits, totalRevenueFiat: completedDepositsAgg._sum.amountFiat ?? 0 },
    };
  }

  // ─── Finances (deposits) ──────────────────────────────────

  async getFinanceStats() {
    const [total, pending, processing, completed, failed, byMethod, totalCredits] = await Promise.all([
      this.prisma.deposit.count(),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PROCESSING } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.COMPLETED } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.FAILED } }),
      this.prisma.deposit.groupBy({
        by: ['method'],
        _count: { id: true },
        _sum: { amountFiat: true, creditsAwarded: true },
        where: { status: DepositStatus.COMPLETED },
      }),
      this.prisma.deposit.aggregate({ where: { status: DepositStatus.COMPLETED }, _sum: { creditsAwarded: true, amountFiat: true } }),
    ]);
    return {
      counts: { total, pending, processing, completed, failed },
      totals: {
        creditsDistributed: totalCredits._sum.creditsAwarded ?? 0,
        revenueFiat: totalCredits._sum.amountFiat ?? 0,
      },
      byMethod: byMethod.map((r) => ({ method: r.method, count: r._count.id, amountFiat: r._sum.amountFiat ?? 0, creditsAwarded: r._sum.creditsAwarded ?? 0 })),
    };
  }

  async listDeposits(page = 1, limit = 25, status?: string, method?: string, userId?: string) {
    const where: Prisma.DepositWhereInput = {
      ...(status && { status: status as DepositStatus }),
      ...(method && { method: method as DepositMethod }),
      ...(userId && { userId }),
    };
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.deposit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, method: true, status: true,
          amountFiat: true, currency: true,
          creditsToAward: true, creditsAwarded: true, bonusCredits: true,
          exchangeRate: true, userWalletAddress: true,
          paymentRef: true, adminNotes: true, reviewedBy: true,
          completedAt: true, createdAt: true, updatedAt: true,
          package: { select: { id: true, usdAmount: true, label: true } },
          user: { select: { id: true, username: true, displayName: true, email: true } },
        },
      }),
      this.prisma.deposit.count({ where }),
    ]);
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } };
  }

  async reviewDeposit(adminId: string, depositId: string, dto: { status: 'COMPLETED' | 'FAILED' | 'REFUNDED'; adminNotes?: string; paymentRef?: string }) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.status === DepositStatus.COMPLETED) throw new BadRequestException('Deposit already completed');
    if (deposit.status === DepositStatus.CANCELLED) throw new BadRequestException('Deposit was cancelled');
    if (deposit.status === DepositStatus.FAILED) throw new BadRequestException('Deposit was failed');

    if (dto.status === 'COMPLETED') {
      if (deposit.method === DepositMethod.PAYMONGO && deposit.paymentRef) {
        try {
          await this.payMongoService.archiveLink(deposit.paymentRef);
        } catch (err) {
          /* ignore archive errors — link may already be expired */
        }
      }
      await this.walletService.completeDeposit(depositId, {
        paymentRef: dto.paymentRef,
        reviewedBy: adminId,
        adminNotes: dto.adminNotes,
      });
    } else {
      // Archive PayMongo link so it can't be paid anymore when admin rejects/refunds
      if (deposit.method === DepositMethod.PAYMONGO && deposit.paymentRef) {
        try {
          await this.payMongoService.archiveLink(deposit.paymentRef);
        } catch (err) {
          /* ignore archive errors — link may already be dead */
        }
      }

      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          status: dto.status as DepositStatus,
          reviewedBy: adminId,
          adminNotes: dto.adminNotes,
          ...(dto.paymentRef && { paymentRef: dto.paymentRef }),
        },
      });
      this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId, status: dto.status });

      if (dto.status === 'FAILED') {
        await this.notificationsService.createNotification(
          deposit.userId,
          NotificationType.ACCOUNT_WARNING,
          'Deposit Failed',
          `Your ${deposit.method} deposit of ${deposit.currency} ${deposit.amountFiat} could not be processed. Please contact support with deposit ID: ${depositId}.`,
          { depositId },
        );
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `admin.deposit.${dto.status.toLowerCase()}`,
        entityType: 'Deposit',
        entityId: depositId,
        metadata: { method: deposit.method, creditsToAward: deposit.creditsToAward, adminNotes: dto.adminNotes ?? null },
      },
    });

    return this.prisma.deposit.findUnique({ where: { id: depositId } });
  }

  // ─── Deposit Packages CRUD ────────────────────────────────

  async listDepositPackages() {
    return this.prisma.depositPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createDepositPackage(dto: { usdAmount: number; bonusCredits?: number; label?: string; isPopular?: boolean; sortOrder?: number }) {
    return this.prisma.depositPackage.create({
      data: {
        usdAmount: dto.usdAmount,
        bonusCredits: dto.bonusCredits ?? 0,
        label: dto.label ?? null,
        isPopular: dto.isPopular ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateDepositPackage(id: string, dto: { usdAmount?: number; bonusCredits?: number; label?: string; isPopular?: boolean; isActive?: boolean; sortOrder?: number }) {
    const pkg = await this.prisma.depositPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');
    return this.prisma.depositPackage.update({ where: { id }, data: dto });
  }

  async deleteDepositPackage(id: string) {
    const pkg = await this.prisma.depositPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');
    return this.prisma.depositPackage.delete({ where: { id } });
  }

  async seedDefaultPackages() {
    const existing = await this.prisma.depositPackage.count();
    if (existing > 0) return { seeded: false, message: 'Packages already exist' };
    const defaults = [
      { usdAmount: 1,   bonusCredits: 0,      label: null,           isPopular: false, sortOrder: 0 },
      { usdAmount: 5,   bonusCredits: 500,    label: null,           isPopular: false, sortOrder: 1 },
      { usdAmount: 10,  bonusCredits: 1500,   label: null,           isPopular: false, sortOrder: 2 },
      { usdAmount: 20,  bonusCredits: 4000,   label: 'Most Popular', isPopular: true,  sortOrder: 3 },
      { usdAmount: 50,  bonusCredits: 12500,  label: 'Best Value',   isPopular: false, sortOrder: 4 },
      { usdAmount: 100, bonusCredits: 30000,  label: null,           isPopular: false, sortOrder: 5 },
    ];
    await this.prisma.depositPackage.createMany({ data: defaults });
    return { seeded: true, count: defaults.length };
  }

  // ─── Email / Communications ───────────────────────────────

  async sendTestDigest(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true, username: true, displayName: true },
    });
    if (!admin?.email) throw new NotFoundException('Admin email not found');

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);

    const data = await this.weeklyDigestService.getUserDigestData(adminId, admin.email, weekStart, weekEnd);
    if (!data) throw new NotFoundException('Could not compute digest data');

    await this.emailService.queueWeeklyDigestEmail(admin.email, data);
    return { sent: true, to: admin.email };
  }

  async getDigestPreview(adminId: string): Promise<Record<string, unknown>> {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true },
    });
    if (!admin?.email) throw new NotFoundException('Admin email not found');

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setUTCHours(0, 0, 0, 0);

    const data = await this.weeklyDigestService.getUserDigestData(adminId, admin.email, weekStart, weekEnd);
    if (!data) throw new NotFoundException('Could not compute digest data');
    return data as unknown as Record<string, unknown>;
  }

  async getDigestStats() {
    const totalActive = await this.prisma.user.count({
      where: { deletedAt: null, status: 'ACTIVE' },
    });

    const enabledResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL AND status = 'ACTIVE' AND weekly_digest_enabled = true
    `;
    const enabled = Number(enabledResult[0]?.count ?? 0);

    return {
      totalUsers: totalActive,
      weeklyDigestEnabled: enabled,
      weeklyDigestDisabled: totalActive - enabled,
    };
  }

  async triggerWeeklyDigest() {
    return this.weeklyDigestService.triggerWeeklyDigests();
  }

  getAnnouncementTemplates() {
    return [
      {
        id: 'maintenance',
        name: 'Scheduled Maintenance',
        subject: 'Scheduled Maintenance on {{date}}',
        title: 'Scheduled Maintenance',
        bodyHtml: '<p>We will be performing scheduled maintenance on <strong>{{date}}</strong> from <strong>{{time}}</strong>.</p><p>During this window, some features may be temporarily unavailable. We expect the maintenance to last approximately <strong>{{duration}}</strong>.</p><p>Thank you for your patience as we improve the platform.</p>',
        theme: 'amber' as const,
      },
      {
        id: 'feature',
        name: 'New Feature Launch',
        subject: 'New Feature: {{featureName}}',
        title: 'New Feature Launch',
        bodyHtml: '<p>We are excited to announce the launch of <strong>{{featureName}}</strong>!</p><p>{{description}}</p><p>Try it out today and let us know what you think.</p>',
        theme: 'blue' as const,
      },
      {
        id: 'update',
        name: 'Important Platform Update',
        subject: 'Important Platform Update',
        title: 'Important Platform Update',
        bodyHtml: '<p>We are making some changes to improve your experience on Engganyo.</p><p>{{details}}</p><p>If you have any questions, please reach out to our support team.</p>',
        theme: 'blue' as const,
      },
      {
        id: 'notice',
        name: 'System Notice',
        subject: 'System Notice from Engganyo',
        title: 'System Notice',
        bodyHtml: '<p>{{message}}</p>',
        theme: 'rose' as const,
      },
    ];
  }

  async sendAnnouncement(dto: SendAnnouncementDto): Promise<{ queued: number }> {
    const where = dto.recipientType === 'DIGEST_ENABLED'
      ? { deletedAt: null, status: 'ACTIVE' as const }
      : { deletedAt: null, status: 'ACTIVE' as const };

    // Since weeklyDigestEnabled may not be typed, use raw query for DIGEST_ENABLED
    let emails: string[] = [];
    if (dto.recipientType === 'DIGEST_ENABLED') {
      const result = await this.prisma.$queryRaw<Array<{ email: string }>>`
        SELECT email FROM users WHERE deleted_at IS NULL AND status = 'ACTIVE' AND weekly_digest_enabled = true
      `;
      emails = result.map((r) => r.email);
    } else {
      const users = await this.prisma.user.findMany({
        where,
        select: { email: true },
      });
      emails = users.map((u) => u.email).filter(Boolean) as string[];
    }

    const theme = dto.theme ?? 'blue';
    for (const email of emails) {
      await this.emailService.queueAnnouncementEmail(email, {
        subject: dto.subject,
        title: dto.title,
        bodyHtml: dto.bodyHtml,
        theme,
        ctaLabel: dto.ctaLabel,
        ctaUrl: dto.ctaUrl,
      });
    }

    return { queued: emails.length };
  }
}
