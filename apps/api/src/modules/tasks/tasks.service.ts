import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CompletionStatus, CampaignStatus, ChallengeStatus, TaskType, TransactionType, TrustLevel, NotificationType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { GamificationService, XP_REWARDS, VP_REWARDS } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { ReferralsService } from '../referrals/referrals.service';
import { StoreService } from '../store/store.service';
import { assertEngagementTaskAllowed } from '../../common/constants/disabled-engagement-tasks';
import { claimCompletionForVerification } from './task-completion-verify';
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
  challengeId: true,
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
  challenge: {
    select: {
      id: true,
      title: true,
      taskType: true,
      targetUrl: true,
      rewardCredits: true,
      requiresProof: true,
      proofInstructions: true,
      status: true,
      creator: { select: { username: true, displayName: true } },
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
    private readonly referralsService: ReferralsService,
    private readonly storeService: StoreService,
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
    assertEngagementTaskAllowed(campaign.taskType);
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

        // Apply active store task-limit boost if present (DB-backed with Redis cache)
        const taskBoost = await this.storeService.getActiveTaskLimitBoost(userId);
        const storeBonus = taskBoost?.bonusSlots ?? 0;
        if (storeBonus > 0) {
          dailyLimit = dailyLimit + storeBonus;
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
            `Daily task limit reached (${dailyLimit} tasks/day for trust level ${trustLevel}${bonus > 0 ? ` + VIP bonus ${bonus}` : ''}${storeBonus > 0 ? ` + Store boost ${storeBonus}` : ''}). Complete more tasks and link social accounts to increase your trust score.`,
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

    const completion = await this.prisma.$transaction(async (tx) => {
      // Atomic slot claim: the UPDATE both locks the campaign row (serializing
      // against cancellation's FOR UPDATE) and conditions on ACTIVE + slots
      // remaining, so an assignment can never land on a cancelled campaign or
      // consume a slot that was already refunded.
      const claimed = await tx.$executeRaw`
        UPDATE campaigns
        SET pending_slots = pending_slots + 1, updated_at = NOW()
        WHERE id = ${campaignId}
          AND status::text = 'ACTIVE'
          AND pending_slots + completed_slots < total_slots`;
      if (claimed !== 1) {
        throw new BadRequestException('No slots available or campaign is not active');
      }
      return tx.taskCompletion.create({
        select: COMPLETION_SELECT,
        data: {
          campaignId,
          userId,
          status: CompletionStatus.ASSIGNED,
          expiresAt,
        },
      });
    });

    // Invalidate browse cache so the task disappears from the user's browse list immediately
    await this.redisService.delByPattern(`campaigns:browse:${userId}:*`).catch(() => null);

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

    // The :id param is an offer id — campaign completions resolve above;
    // challenge completions (1v1) resolve here and take the challenge path.
    if (!completion) {
      const challengeCompletion = await this.prisma.taskCompletion.findFirst({
        where: { challengeId: campaignId, userId },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          expiresAt: true,
          challenge: {
            select: {
              id: true,
              creatorId: true,
              title: true,
              taskType: true,
              targetUrl: true,
              rewardCredits: true,
              requiresProof: true,
              proofInstructions: true,
              status: true,
            },
          },
        },
      });
      if (challengeCompletion?.challenge) {
        return this.submitChallengeProof(userId, campaignId, challengeCompletion, dto, clientIp, userAgent);
      }
      throw new NotFoundException('Task not assigned to you');
    }
    if (!completion.campaign) throw new NotFoundException('Task not assigned to you');
    const campaign = completion.campaign;
    assertEngagementTaskAllowed(campaign.taskType);

    // ── Ownership enforcement: campaign owners cannot complete their own tasks ──
    if (campaign.userId === userId) {
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

    if (campaign.requiresProof && !dto.proofUrl) {
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
      campaign.taskType as never,
      campaign.targetUrl,
    );
    // apiVerified = true → verified via API (treat as auto-verify)
    // apiVerified = null → platform not supported or account not linked → use campaign setting
    // apiVerified = throws → verification failed (BadRequestException propagates to user)

    const shouldAutoVerify = apiVerified === true ? true : campaign.autoVerify;

    if (shouldAutoVerify) {
      // ── Auto-verify: claim + counters + credit in ONE transaction ──
      await this.prisma.withTransaction(async (tx) => {
        await claimCompletionForVerification(tx, {
          completionId: completion.id,
          campaignId,
          completerUserId: userId,
          fromStatuses: submittable,
          setData: {
            status: CompletionStatus.VERIFIED,
            proofUrl: dto.proofUrl,
            proofHash: dto.proofHash,
            submittedAt: now,
            verifiedAt: now,
            verifiedBy: 'system',
            creditsEarned: campaign.creditPerTask,
            ...(clientIp && { ipAddress: clientIp }),
            ...(userAgent && { deviceFingerprint: userAgent }),
            completionSeconds,
          },
        });

        await this.walletService.credit(userId, campaign.creditPerTask, {
          type: TransactionType.EARN_TASK_COMPLETION,
          description: `Task verified`,
          referenceId: campaignId,
          referenceType: 'campaign',
        }, tx);
      });

      void this.referralsService.qualifyReferral(userId).catch(() => null);
      void this.referralsService.checkMilestones(userId).catch(() => null);

      await this.gamificationService.awardXp(userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.awardVp(userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.updateMissionProgress(userId, 'COMPLETE_N_TASKS' as never);
      await this.gamificationService.checkAchievements(userId);
      void this.antiAbuseService.queueRecalculate(userId);

      void this.notificationsService.createNotification(
        userId,
        NotificationType.TASK_COMPLETED,
        'Task Verified',
        `Your task was auto-verified. You earned ${campaign.creditPerTask} credits (+${VP_REWARDS.TASK_COMPLETION} VIP Points).`,
        { campaignId, creditsEarned: campaign.creditPerTask, vpEarned: VP_REWARDS.TASK_COMPLETION },
      ).catch(() => null);

      // Clear browse caches for all users since slot counts changed
      void this.redisService.delByPattern('campaigns:browse:*').catch(() => null);

      this.eventsService.emitToUser(userId, 'task:completed', { campaignId, completionId: completion.id, status: 'VERIFIED' });
      this.eventsService.emitToUser(userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'VERIFIED' });

      return { creditsEarned: campaign.creditPerTask, status: 'VERIFIED' };
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

      this.eventsService.emitToUser(userId, 'task:completed', { campaignId, completionId: completion.id, status: 'SUBMITTED' });
      this.eventsService.emitToUser(campaign.userId, 'submission:new', { campaignId, completionId: completion.id });
      this.eventsService.emitToAdmins('submission:new', { campaignId, completionId: completion.id });

      return {
        creditsEarned: 0,
        status: 'SUBMITTED',
        message: 'Proof submitted. The campaign creator will review within 48 hours.',
        reviewDeadline,
      };
    }
  }

  // ─── Submit proof for a 1v1 challenge claim ────────────────
  // Challenges always go through creator review (no auto-verify): the duel
  // is settled by the challenger, with admin escalation after reviewDeadline.

  private async submitChallengeProof(
    userId: string,
    challengeId: string,
    completion: {
      id: string;
      status: CompletionStatus;
      assignedAt: Date;
      expiresAt: Date | null;
      challenge: {
        id: string;
        creatorId: string;
        title: string;
        taskType: TaskType;
        targetUrl: string;
        rewardCredits: number;
        requiresProof: boolean;
        proofInstructions: string | null;
        status: ChallengeStatus;
      } | null;
    },
    dto: SubmitProofDto,
    clientIp?: string,
    userAgent?: string,
  ) {
    const challenge = completion.challenge;
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertEngagementTaskAllowed(challenge.taskType);
    if (challenge.creatorId === userId) {
      throw new BadRequestException('Challenge creators cannot complete their own challenge');
    }
    if (challenge.status !== ChallengeStatus.CLAIMED) {
      throw new BadRequestException('This challenge is no longer active');
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
    if (challenge.requiresProof && !dto.proofUrl) {
      throw new BadRequestException('Proof URL is required for this challenge');
    }

    const now = new Date();
    const completionSeconds = Math.round((now.getTime() - completion.assignedAt.getTime()) / 1000);

    // Suspicious-timing flag (same rule as campaign submissions)
    if (now.getTime() - completion.assignedAt.getTime() < 5_000) {
      this.logger.warn(`Suspicious timing: user ${userId} submitted challenge proof in ${now.getTime() - completion.assignedAt.getTime()}ms`);
      void this.antiAbuseService.flagUser(
        userId,
        'suspicious_timing',
        'medium',
        `Challenge proof submitted in under 5s (completion ${completion.id})`,
        { challengeId, completionId: completion.id },
      ).catch(() => null);
    }

    // Duplicate proof detection across all completions
    if (dto.proofHash) {
      const duplicate = await this.prisma.taskCompletion.findFirst({
        where: {
          proofHash: dto.proofHash,
          userId: { not: userId },
          status: { in: [CompletionStatus.VERIFIED, CompletionStatus.SUBMITTED] },
        },
        select: { id: true },
      });
      if (duplicate) {
        void this.antiAbuseService.flagUser(
          userId,
          'duplicate_proof',
          'high',
          `Proof hash matches another submission (completion ${duplicate.id})`,
          { proofHash: dto.proofHash, challengeId },
        ).catch(() => null);
      }
    }

    const reviewDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    // Guarded transition: if the expiry sweep closed the challenge and
    // expired this completion between our read and this write, the update
    // matches zero rows — proof can never attach to a refunded challenge.
    const submitted = await this.prisma.taskCompletion.updateMany({
      where: { id: completion.id, status: { in: submittable } },
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
    if (submitted.count !== 1) {
      throw new ConflictException('This task is no longer active — it may have expired.');
    }

    this.eventsService.emitToUser(userId, 'task:completed', { challengeId, completionId: completion.id, status: 'SUBMITTED' });
    this.eventsService.emitToUser(challenge.creatorId, 'submission:new', { challengeId, completionId: completion.id });
    this.eventsService.emitToAdmins('submission:new', { challengeId, completionId: completion.id });

    return {
      creditsEarned: 0,
      status: 'SUBMITTED',
      message: 'Proof submitted. The challenge creator will review within 48 hours.',
      reviewDeadline,
    };
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
    if (!completion.campaign) throw new NotFoundException('Task not assigned to you');
    const campaign = completion.campaign;
    assertEngagementTaskAllowed(campaign.taskType);

    // ── Ownership enforcement: campaign owners cannot complete their own tasks unless it's a platform task ──
    if (campaign.userId === userId && !campaign.isPlatformTask) {
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
      campaign.taskType as never,
      campaign.targetUrl,
    );

    if (apiVerified === true) {
      // ── Auto-verify: claim + counters + credit in ONE transaction ──
      await this.prisma.withTransaction(async (tx) => {
        await claimCompletionForVerification(tx, {
          completionId: completion.id,
          campaignId,
          completerUserId: userId,
          fromStatuses: recheckable,
          setData: {
            status: CompletionStatus.VERIFIED,
            submittedAt: now,
            verifiedAt: now,
            verifiedBy: 'system',
            creditsEarned: campaign.creditPerTask,
          },
        });

        await this.walletService.credit(userId, campaign.creditPerTask, {
          type: TransactionType.EARN_TASK_COMPLETION,
          description: `Task verified`,
          referenceId: campaignId,
          referenceType: 'campaign',
        }, tx);
      });

      void this.referralsService.qualifyReferral(userId).catch(() => null);
      void this.referralsService.checkMilestones(userId).catch(() => null);

      await this.gamificationService.awardXp(userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.awardVp(userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);
      await this.gamificationService.updateMissionProgress(userId, 'COMPLETE_N_TASKS' as never);
      await this.gamificationService.checkAchievements(userId);
      void this.antiAbuseService.queueRecalculate(userId);

      void this.notificationsService.createNotification(
        userId,
        'TASK_COMPLETED',
        'Task Verified',
        `Your task was auto-verified on recheck. You earned ${campaign.creditPerTask} credits.`,
        { campaignId, creditsEarned: campaign.creditPerTask },
      ).catch(() => null);

      this.eventsService.emitToUser(userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'VERIFIED' });

      return { creditsEarned: campaign.creditPerTask, status: 'VERIFIED', message: 'Verification successful' };
    } else if (apiVerified === null) {
      // ── API verification not available (not linked or API error) ──────────────
      const taskLabel = campaign.taskType.replace(/_/g, ' ').toLowerCase();
      throw new BadRequestException(
        `Could not verify ${taskLabel}. Please link your account in Settings > Connected Accounts or upload a screenshot proof instead.`,
      );
    } else {
      // ── Verification failed (false) ──────────────
      const taskLabel = campaign.taskType.replace(/_/g, ' ').toLowerCase();
      return {
        creditsEarned: 0,
        status: completion.status,
        message: `${taskLabel} not yet verified. Please complete the action and try again.`,
      };
    }
  }

  // ─── Get my tasks ──────────────────────────────────────────

  // Compact counts for the dashboard next-action card. Actionable mirrors what
  // My tasks can actually submit: ASSIGNED/IN_PROGRESS and not past expiresAt
  // (EXPIRED/CANCELLED/DISPUTED/etc. are excluded server-side).
  async getMyTasksSummary(userId: string) {
    const now = new Date();
    const actionableWhere = {
      userId,
      status: { in: [CompletionStatus.ASSIGNED, CompletionStatus.IN_PROGRESS] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const [actionable, awaitingReview, creditRows] = await Promise.all([
      this.prisma.taskCompletion.count({ where: actionableWhere }),
      this.prisma.taskCompletion.count({
        where: { userId, status: CompletionStatus.SUBMITTED },
      }),
      this.prisma.taskCompletion.findMany({
        where: actionableWhere,
        select: {
          campaign: { select: { creditPerTask: true } },
          challenge: { select: { rewardCredits: true } },
        },
      }),
    ]);
    const actionableCredits = creditRows.reduce(
      (sum, row) => sum + (row.campaign?.creditPerTask ?? row.challenge?.rewardCredits ?? 0),
      0,
    );
    return { actionable, actionableCredits, awaitingReview };
  }

  async getMyTasks(userId: string, dto: ListMyTasksDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;
    const now = new Date();

    const where = {
      userId,
      ...(dto.status && { status: dto.status }),
    };

    // Actionable-first ordering happens in the database before pagination so
    // each page is a bounded read: actionable = ASSIGNED/IN_PROGRESS and not
    // past expiresAt (same rule as getMyTasksSummary); then SUBMITTED; then
    // everything else. Newest first within each group, id as the final
    // deterministic tie-breaker so tied timestamps can't reorder across pages.
    // expires_at is `timestamp without time zone` holding UTC, so it is
    // converted with AT TIME ZONE 'UTC' before comparing to the timestamptz
    // parameter — a bare comparison would shift by the session time zone.
    const statusClause = dto.status
      ? Prisma.sql`AND status::text = ${dto.status}`
      : Prisma.empty;
    const [idRows, total] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM task_completions
        WHERE user_id = ${userId} ${statusClause}
        ORDER BY
          CASE
            WHEN status::text IN ('ASSIGNED', 'IN_PROGRESS')
                 AND (expires_at IS NULL
                      OR expires_at AT TIME ZONE 'UTC' > ${now})
            THEN 0
            WHEN status::text = 'SUBMITTED' THEN 1
            ELSE 2
          END,
          assigned_at DESC,
          id DESC
        LIMIT ${limit} OFFSET ${skip}
      `,
      this.prisma.taskCompletion.count({ where }),
    ]);

    if (!idRows.length) {
      return {
        items: [],
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    const rows = await this.prisma.taskCompletion.findMany({
      where: { id: { in: idRows.map((r) => r.id) } },
      select: COMPLETION_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = idRows
      .map((r) => byId.get(r.id))
      .filter((r): r is NonNullable<typeof r> => r != null);

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

    // Apply active store task-limit boost (DB-backed with Redis cache)
    const taskBoost = await this.storeService.getActiveTaskLimitBoost(userId);
    const storeBonus = taskBoost?.bonusSlots ?? 0;
    if (storeBonus > 0 && dailyLimit !== undefined) {
      dailyLimit = dailyLimit + storeBonus;
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
      storeBonus,
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
