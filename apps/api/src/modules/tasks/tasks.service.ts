import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CompletionStatus, CampaignStatus, TransactionType, TrustLevel, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { GamificationService, XP_REWARDS, VP_REWARDS } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import type { ListTasksDto, ListMyTasksDto } from './dto/list-tasks.dto';
import type { SubmitProofDto } from './dto/submit-proof.dto';

const COMPLETION_SELECT = {
  id: true,
  status: true,
  creditsEarned: true,
  proofUrl: true,
  assignedAt: true,
  submittedAt: true,
  verifiedAt: true,
  expiresAt: true,
  rejectionReason: true,
  campaign: {
    select: {
      id: true,
      title: true,
      taskType: true,
      targetUrl: true,
      creditPerTask: true,
      requiresProof: true,
      proofInstructions: true,
      autoVerify: true,
      user: { select: { username: true, displayName: true } },
    },
  },
} as const;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly campaignsService: CampaignsService,
    private readonly gamificationService: GamificationService,
    private readonly antiAbuseService: AntiAbuseService,
    private readonly socialAuthService: SocialAuthService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Browse available tasks ────────────────────────────────

  async browseTasks(userId: string, dto: ListTasksDto) {
    return this.campaignsService.browseActive(userId, {
      taskType: dto.taskType as string | undefined,
      platformPrefix: dto.platform,
      country: dto.country,
      page: dto.page,
      limit: dto.limit,
    });
  }

  // ─── Assign task ───────────────────────────────────────────

  async assignTask(userId: string, campaignId: string, userRole?: string, clientIp?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        taskType: true,
        totalSlots: true,
        completedSlots: true,
        pendingSlots: true,
        cooldownHours: true,
        expiresAt: true,
        isPlatformTask: true,
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId === userId && !campaign.isPlatformTask) {
      throw new BadRequestException('Cannot assign your own campaign');
    }

    // ── Require linked social account for the campaign's platform ──────────
    const requiredPlatform = SocialAuthService.getPlatformForTaskType(campaign.taskType as never);
    if (requiredPlatform) {
      const enabled = await this.socialAuthService.isPlatformEnabled(requiredPlatform);
      if (!enabled) {
        const platformLabel = requiredPlatform.charAt(0) + requiredPlatform.slice(1).toLowerCase();
        throw new BadRequestException(
          `${platformLabel} tasks are currently disabled.`,
        );
      }
      const linked = await this.socialAuthService.hasLinkedAccount(userId, requiredPlatform);
      if (!linked) {
        const platformLabel = requiredPlatform.charAt(0) + requiredPlatform.slice(1).toLowerCase();
        throw new BadRequestException(
          `You must link your ${platformLabel} account before accepting this task. Go to Settings → Connected Accounts.`,
        );
      }
    }
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new BadRequestException('Campaign is not active');
    }

    const availableSlots = campaign.totalSlots - campaign.completedSlots - campaign.pendingSlots;
    if (availableSlots <= 0) throw new BadRequestException('No slots available');

    if (campaign.expiresAt && campaign.expiresAt < new Date()) {
      throw new BadRequestException('Campaign has expired');
    }

    // ── Trust gate: enforce per-tier daily task limits ──────────────────────
    const isAdminUser = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'MODERATOR';
    if (!isAdminUser) {
      const trustRecord = await this.prisma.trustScore.findUnique({
        where: { userId },
        select: { level: true },
      });
      const trustLevel = trustRecord?.level ?? TrustLevel.NEW;
      const DAILY_LIMITS: Partial<Record<TrustLevel, number>> = {
        [TrustLevel.NEW]: 5,
        [TrustLevel.LOW]: 20,
        [TrustLevel.MEDIUM]: 50,
        [TrustLevel.HIGH]: 100,
        [TrustLevel.VERIFIED]: 200,
      };
      let dailyLimit = DAILY_LIMITS[trustLevel];
      if (dailyLimit !== undefined) {
        // Apply VIP tier task limit bonus
        const vipStatus = await this.gamificationService.getVipStatus(userId);
        const bonus = vipStatus.perks.taskLimitBonus ?? 0;
        if (bonus > 0) {
          dailyLimit = dailyLimit + bonus;
        }
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayCount = await this.prisma.taskCompletion.count({
          where: {
            userId,
            assignedAt: { gte: todayStart },
            status: { not: CompletionStatus.EXPIRED },
          },
        });
        if (todayCount >= dailyLimit) {
          throw new BadRequestException(
            `Daily task limit reached (${dailyLimit} tasks/day for trust level ${trustLevel}${bonus > 0 ? ` + VIP bonus ${bonus}` : ''}). Complete more tasks and link social accounts to increase your trust score.`,
          );
        }
      }
    }

    // Check if already assigned or completed
    const existing = await this.prisma.taskCompletion.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
      select: { id: true, status: true },
    });
    if (existing) {
      const active: CompletionStatus[] = [
        CompletionStatus.ASSIGNED,
        CompletionStatus.IN_PROGRESS,
        CompletionStatus.SUBMITTED,
        CompletionStatus.VERIFIED,
      ];
      if (active.includes(existing.status)) {
        throw new ConflictException('You already have this task assigned');
      }
    }

    // ── Anti-abuse: alt-account self-farming detection ────────
    // Block if the assignee shares a recent IP with the campaign creator
    if (clientIp) {
      const creatorSharedIp = await this.prisma.userSession.findFirst({
        where: {
          userId: campaign.userId,
          ipAddress: clientIp,
          lastUsedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          isRevoked: false,
        },
        select: { id: true },
      });
      if (creatorSharedIp) {
        this.logger.warn(`Alt-account self-farming blocked: user ${userId} shares IP ${clientIp} with creator ${campaign.userId}`);
        void this.antiAbuseService.flagUser(
          userId,
          'alt_account_self_farm',
          'critical',
          `Shared IP ${clientIp} with campaign creator ${campaign.userId}`,
          { clientIp, creatorId: campaign.userId, campaignId },
        ).catch(() => null);
        throw new BadRequestException(
          'This assignment is restricted due to potential account abuse. Contact support if you believe this is an error.',
        );
      }
    }

    // ── Anti-abuse: bidirectional farming detection ───────────
    // Block if the campaign creator has also completed tasks from the assignee's campaigns
    const bidirectional = await this.prisma.taskCompletion.findFirst({
      where: {
        userId: campaign.userId,
        campaign: { userId },
        status: { in: [CompletionStatus.VERIFIED, CompletionStatus.SUBMITTED] },
      },
      select: { id: true },
    });
    if (bidirectional) {
      this.logger.warn(`Bidirectional farming blocked: user ${userId} and creator ${campaign.userId} are farming each other's campaigns`);
      void this.antiAbuseService.flagUser(
        userId,
        'bidirectional_farm',
        'high',
        `User and creator ${campaign.userId} are completing each other's campaigns`,
        { creatorId: campaign.userId, campaignId },
      ).catch(() => null);
      throw new BadRequestException(
        'This assignment is restricted due to potential collusion. Contact support if you believe this is an error.',
      );
    }

    // ── Anti-abuse: social graph concentration ─────────────────
    // Flag (don't block) users whose verified completions are heavily concentrated on one creator
    if (!isAdminUser) {
      const creatorCompletions = await this.prisma.taskCompletion.count({
        where: {
          userId,
          campaign: { userId: campaign.userId },
          status: CompletionStatus.VERIFIED,
        },
      });
      const totalVerified = await this.prisma.taskCompletion.count({
        where: { userId, status: CompletionStatus.VERIFIED },
      });
      if (totalVerified >= 10) {
        const concentration = creatorCompletions / totalVerified;
        if (concentration > 0.6) {
          void this.antiAbuseService.flagUser(
            userId,
            'creator_concentration',
            'high',
            `${(concentration * 100).toFixed(0)}% of verified tasks from creator ${campaign.userId} (${creatorCompletions}/${totalVerified})`,
            { concentration, creatorId: campaign.userId, totalVerified, creatorCompletions },
          ).catch(() => null);
        }
      }
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h to complete

    const [completion] = await Promise.all([
      this.prisma.taskCompletion.create({
        select: COMPLETION_SELECT,
        data: {
          campaignId,
          userId,
          status: CompletionStatus.ASSIGNED,
          expiresAt,
        },
      }),
      this.prisma.campaign.update({
        where: { id: campaignId },
        data: { pendingSlots: { increment: 1 } },
      }),
    ]);

    // Invalidate browse cache so the task disappears from the user's browse list immediately
    void this.redisService.delByPattern(`campaigns:browse:${userId}:*`).catch(() => null);

    void this.notificationsService.createNotification(
      userId,
      'TASK_ASSIGNED',
      'Task Assigned',
      `You claimed "${campaign.title}". Complete it before ${expiresAt.toLocaleDateString()}.`,
      { campaignId, completionId: completion.id, expiresAt: expiresAt.toISOString() },
    ).catch(() => null);

    this.eventsService.emitToUser(userId, 'task:assigned', { campaignId, completionId: completion.id });

    if (clientIp) {
      void this.antiAbuseService.recordIp(userId, clientIp, 'task_assign').catch(() => null);
    }

    return completion;
  }

  // ─── Submit proof (+ auto-verify for Phase 5) ──────────────

  async submitProof(userId: string, campaignId: string, dto: SubmitProofDto, clientIp?: string, userAgent?: string) {
    const completion = await this.prisma.taskCompletion.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
      select: {
        id: true,
        status: true,
        assignedAt: true,
        expiresAt: true,
        campaign: {
          select: {
            id: true,
            userId: true,
            taskType: true,
            targetUrl: true,
            creditPerTask: true,
            requiresProof: true,
            autoVerify: true,
            completedSlots: true,
            pendingSlots: true,
            totalSlots: true,
          },
        },
      },
    });

    if (!completion) throw new NotFoundException('Task not assigned to you');

    // ── Ownership enforcement: campaign owners cannot complete their own tasks ──
    if (completion.campaign.userId === userId) {
      throw new BadRequestException('Campaign owners cannot complete their own tasks');
    }

    const submittable: CompletionStatus[] = [
      CompletionStatus.ASSIGNED,
      CompletionStatus.IN_PROGRESS,
    ];
    if (!submittable.includes(completion.status)) {
      throw new BadRequestException(`Task is already ${completion.status.toLowerCase()}`);
    }

    if (completion.expiresAt && completion.expiresAt < new Date()) {
      throw new BadRequestException('Task assignment has expired');
    }

    if (completion.campaign.requiresProof && !dto.proofUrl) {
      throw new BadRequestException('Proof URL is required for this task');
    }

    const now = new Date();

    // ── Anti-abuse: task timing analysis ──────────────────────
    const completionTimeMs = now.getTime() - completion.assignedAt.getTime();
    const completionSeconds = Math.round(completionTimeMs / 1000);
    const SUSPICIOUS_THRESHOLD_MS = 5_000; // 5 seconds
    const RAPID_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const RAPID_COUNT_THRESHOLD = 3;

    if (completionTimeMs < SUSPICIOUS_THRESHOLD_MS) {
      this.logger.warn(`Suspicious timing: user ${userId} completed task ${completion.id} in ${completionTimeMs}ms`);
      void this.antiAbuseService.flagUser(
        userId,
        'suspicious_timing',
        'medium',
        `Task completed in ${completionTimeMs}ms (threshold: ${SUSPICIOUS_THRESHOLD_MS}ms)`,
        { completionTimeMs, campaignId, thresholdMs: SUSPICIOUS_THRESHOLD_MS, completionId: completion.id },
      ).catch(() => null);
    }

    // Check for rapid-fire completions in the last hour (consistent interval bot pattern)
    void this.prisma.taskCompletion
      .count({
        where: {
          userId,
          status: CompletionStatus.VERIFIED,
          assignedAt: { gte: new Date(now.getTime() - RAPID_WINDOW_MS) },
        },
      })
      .then((recentCount) => {
        if (recentCount >= RAPID_COUNT_THRESHOLD) {
          this.logger.warn(`Rapid completions detected: user ${userId} completed ${recentCount} tasks in the last hour`);
          void this.antiAbuseService.flagUser(
            userId,
            'bot_pattern',
            'high',
            `${recentCount} tasks completed within 1 hour (threshold: ${RAPID_COUNT_THRESHOLD})`,
            { recentCount, windowMs: RAPID_WINDOW_MS, threshold: RAPID_COUNT_THRESHOLD },
          ).catch(() => null);
        }
      })
      .catch(() => null);

    // ── Anti-abuse: duplicate proof detection ─────────────────
    if (dto.proofHash) {
      const duplicate = await this.prisma.taskCompletion.findFirst({
        where: {
          proofHash: dto.proofHash,
          userId: { not: userId },
          status: { in: [CompletionStatus.VERIFIED, CompletionStatus.SUBMITTED] },
        },
        select: { id: true, userId: true, campaignId: true },
      });
      if (duplicate) {
        this.logger.warn(`Duplicate proof detected: user ${userId} reused hash ${dto.proofHash} from completion ${duplicate.id}`);
        void this.antiAbuseService.flagUser(
          userId,
          'duplicate_proof',
          'high',
          `Proof hash matches another user's submission (completion ${duplicate.id})`,
          { proofHash: dto.proofHash, duplicateCompletionId: duplicate.id, duplicateUserId: duplicate.userId },
        ).catch(() => null);
      }
    }

    // ── API verification for supported platforms ──────────────
    // If the user has a linked social account, verify via platform API.
    // This overrides screenshot-only proof for supported platforms.
    const apiVerified = await this.socialAuthService.verifyPlatformAction(
      userId,
      completion.campaign.taskType as never,
      completion.campaign.targetUrl,
    );
    // apiVerified = true → verified via API (treat as auto-verify)
    // apiVerified = null → platform not supported or account not linked → use campaign setting
    // apiVerified = throws → verification failed (BadRequestException propagates to user)

    const shouldAutoVerify = apiVerified === true ? true : completion.campaign.autoVerify;

    if (shouldAutoVerify) {
      // ── Auto-verify: credits paid immediately ──────────────
      await this.prisma.withTransaction(async (tx) => {
        await tx.taskCompletion.update({
          where: { id: completion.id },
          data: {
            status: CompletionStatus.VERIFIED,
            proofUrl: dto.proofUrl,
            proofHash: dto.proofHash,
            submittedAt: now,
            verifiedAt: now,
            verifiedBy: 'system',
            creditsEarned: completion.campaign.creditPerTask,
            ...(clientIp && { ipAddress: clientIp }),
            ...(userAgent && { deviceFingerprint: userAgent }),
            completionSeconds,
          },
        });

        const newCompleted = completion.campaign.completedSlots + 1;
        const isFull = newCompleted >= completion.campaign.totalSlots;

        await tx.campaign.update({
          where: { id: campaignId },
          data: {
            completedSlots: { increment: 1 },
            pendingSlots: { decrement: 1 },
            ...(isFull && { status: CampaignStatus.COMPLETED, completedAt: now }),
          },
        });

        await tx.userProfile.updateMany({
          where: { userId },
          data: { totalTasksDone: { increment: 1 } },
        });
      });

      await this.walletService.credit(userId, completion.campaign.creditPerTask, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: `Task verified`,
        referenceId: campaignId,
        referenceType: 'campaign',
      });

      await this.gamificationService.awardXp(userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.awardVp(userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.updateMissionProgress(userId, 'COMPLETE_N_TASKS' as never);
      await this.gamificationService.checkAchievements(userId);
      void this.antiAbuseService.queueRecalculate(userId);

      void this.notificationsService.createNotification(
        userId,
        NotificationType.TASK_COMPLETED,
        'Task Verified',
        `Your task was auto-verified. You earned ${completion.campaign.creditPerTask} credits (+${VP_REWARDS.TASK_COMPLETION} VIP Points).`,
        { campaignId, creditsEarned: completion.campaign.creditPerTask, vpEarned: VP_REWARDS.TASK_COMPLETION },
      ).catch(() => null);

      // Clear browse caches for all users since slot counts changed
      void this.redisService.delByPattern('campaigns:browse:*').catch(() => null);

      this.eventsService.emitToUser(userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'VERIFIED' });

      return { creditsEarned: completion.campaign.creditPerTask, status: 'VERIFIED' };
    } else {
      // ── Manual review: hold proof, creator reviews first (48h), then admin ──
      const reviewDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      await this.prisma.taskCompletion.update({
        where: { id: completion.id },
        data: {
          status: CompletionStatus.SUBMITTED,
          proofUrl: dto.proofUrl,
          proofHash: dto.proofHash,
          submittedAt: now,
          reviewDeadline,
          ...(clientIp && { ipAddress: clientIp }),
          ...(userAgent && { deviceFingerprint: userAgent }),
          completionSeconds,
        },
      });

      this.eventsService.emitToUser(completion.campaign.userId, 'submission:new', { campaignId, completionId: completion.id });

      return {
        creditsEarned: 0,
        status: 'SUBMITTED',
        message: 'Proof submitted. The campaign creator will review within 48 hours.',
        reviewDeadline,
      };
    }
  }

  // ─── Recheck task (for YouTube subscribe tasks) ───────────────

  async recheckTask(userId: string, campaignId: string) {
    const completion = await this.prisma.taskCompletion.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        campaign: {
          select: {
            id: true,
            userId: true,
            taskType: true,
            targetUrl: true,
            creditPerTask: true,
            completedSlots: true,
            pendingSlots: true,
            totalSlots: true,
            isPlatformTask: true,
          },
        },
      },
    });

    if (!completion) throw new NotFoundException('Task not assigned to you');

    // ── Ownership enforcement: campaign owners cannot complete their own tasks unless it's a platform task ──
    if (completion.campaign.userId === userId && !completion.campaign.isPlatformTask) {
      throw new BadRequestException('Campaign owners cannot complete their own tasks');
    }

    const recheckable: CompletionStatus[] = [
      CompletionStatus.ASSIGNED,
      CompletionStatus.IN_PROGRESS,
    ];
    if (!recheckable.includes(completion.status)) {
      throw new BadRequestException(`Task is already ${completion.status.toLowerCase()}`);
    }

    if (completion.expiresAt && completion.expiresAt < new Date()) {
      throw new BadRequestException('Task assignment has expired');
    }

    const now = new Date();

    // ── API verification for supported platforms ──────────────
    const apiVerified = await this.socialAuthService.verifyPlatformAction(
      userId,
      completion.campaign.taskType as never,
      completion.campaign.targetUrl,
    );

    if (apiVerified === true) {
      // ── Auto-verify: credits paid immediately ──────────────
      await this.prisma.withTransaction(async (tx) => {
        await tx.taskCompletion.update({
          where: { id: completion.id },
          data: {
            status: CompletionStatus.VERIFIED,
            submittedAt: now,
            verifiedAt: now,
            verifiedBy: 'system',
            creditsEarned: completion.campaign.creditPerTask,
          },
        });

        const newCompleted = completion.campaign.completedSlots + 1;
        const isFull = newCompleted >= completion.campaign.totalSlots;

        await tx.campaign.update({
          where: { id: campaignId },
          data: {
            completedSlots: { increment: 1 },
            pendingSlots: { decrement: 1 },
            ...(isFull && { status: CampaignStatus.COMPLETED, completedAt: now }),
          },
        });

        await tx.userProfile.updateMany({
          where: { userId },
          data: { totalTasksDone: { increment: 1 } },
        });
      });

      await this.walletService.credit(userId, completion.campaign.creditPerTask, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: `Task verified`,
        referenceId: campaignId,
        referenceType: 'campaign',
      });

      await this.gamificationService.awardXp(userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.awardVp(userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.updateMissionProgress(userId, 'COMPLETE_N_TASKS' as never);
      await this.gamificationService.checkAchievements(userId);
      void this.antiAbuseService.queueRecalculate(userId);

      void this.notificationsService.createNotification(
        userId,
        'TASK_COMPLETED',
        'Task Verified',
        `Your task was auto-verified on recheck. You earned ${completion.campaign.creditPerTask} credits.`,
        { campaignId, creditsEarned: completion.campaign.creditPerTask },
      ).catch(() => null);

      this.eventsService.emitToUser(userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'VERIFIED' });

      return { creditsEarned: completion.campaign.creditPerTask, status: 'VERIFIED', message: 'Verification successful' };
    } else if (apiVerified === null) {
      // ── API verification not available (not linked or API error) ──────────────
      const taskLabel = completion.campaign.taskType.replace(/_/g, ' ').toLowerCase();
      throw new BadRequestException(
        `Could not verify ${taskLabel}. Please link your account in Settings > Connected Accounts or upload a screenshot proof instead.`,
      );
    } else {
      // ── Verification failed (false) ──────────────
      const taskLabel = completion.campaign.taskType.replace(/_/g, ' ').toLowerCase();
      return {
        creditsEarned: 0,
        status: completion.status,
        message: `${taskLabel} not yet verified. Please complete the action and try again.`,
      };
    }
  }

  // ─── Get my tasks ──────────────────────────────────────────

  async getMyTasks(userId: string, dto: ListMyTasksDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(dto.status && { status: dto.status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.taskCompletion.findMany({
        where,
        select: COMPLETION_SELECT,
        orderBy: { assignedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.taskCompletion.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDailyLimits(userId: string, userRole: string) {
    const isAdminUser = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'MODERATOR';
    if (isAdminUser) {
      return { dailyLimit: null, tasksCompletedToday: null, bonus: 0, vipTier: null };
    }

    const trustRecord = await this.prisma.trustScore.findUnique({
      where: { userId },
      select: { level: true },
    });
    const trustLevel = trustRecord?.level ?? TrustLevel.NEW;
    const DAILY_LIMITS: Partial<Record<TrustLevel, number>> = {
      [TrustLevel.NEW]: 5,
      [TrustLevel.LOW]: 20,
      [TrustLevel.MEDIUM]: 50,
      [TrustLevel.HIGH]: 100,
      [TrustLevel.VERIFIED]: 200,
    };
    let dailyLimit = DAILY_LIMITS[trustLevel];
    let bonus = 0;
    const vipStatus = await this.gamificationService.getVipStatus(userId);
    if (dailyLimit !== undefined) {
      bonus = vipStatus.perks.taskLimitBonus ?? 0;
      if (bonus > 0) {
        dailyLimit = dailyLimit + bonus;
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tasksCompletedToday = await this.prisma.taskCompletion.count({
      where: {
        userId,
        assignedAt: { gte: todayStart },
        status: { not: CompletionStatus.EXPIRED },
      },
    });

    return {
      dailyLimit,
      tasksCompletedToday,
      remaining: dailyLimit !== undefined ? Math.max(0, dailyLimit - tasksCompletedToday) : null,
      bonus,
      trustLevel,
      vipTier: vipStatus.currentTier
        ? {
            name: vipStatus.currentTier.name,
            displayName: vipStatus.currentTier.displayName,
            level: vipStatus.currentTier.level,
            color: ((vipStatus.currentTier.perks as Record<string, unknown>)?.color as string) ?? '#888888',
          }
        : null,
    };
  }
}
