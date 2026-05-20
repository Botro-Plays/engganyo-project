import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CompletionStatus, CampaignStatus, TransactionType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { GamificationService, XP_REWARDS } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly campaignsService: CampaignsService,
    private readonly gamificationService: GamificationService,
    private readonly antiAbuseService: AntiAbuseService,
    private readonly socialAuthService: SocialAuthService,
  ) {}

  // ─── Browse available tasks ────────────────────────────────

  async browseTasks(userId: string, dto: ListTasksDto) {
    return this.campaignsService.browseActive(userId, {
      taskType: dto.taskType as string | undefined,
      platformPrefix: dto.platform,
      page: dto.page,
      limit: dto.limit,
    });
  }

  // ─── Assign task ───────────────────────────────────────────

  async assignTask(userId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        userId: true,
        status: true,
        taskType: true,
        totalSlots: true,
        completedSlots: true,
        pendingSlots: true,
        cooldownHours: true,
        expiresAt: true,
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId === userId) throw new BadRequestException('Cannot assign your own campaign');

    // ── Require linked social account for the campaign's platform ──────────
    const requiredPlatform = SocialAuthService.getPlatformForTaskType(campaign.taskType as never);
    if (requiredPlatform) {
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

    return completion;
  }

  // ─── Submit proof (+ auto-verify for Phase 5) ──────────────

  async submitProof(userId: string, campaignId: string, dto: SubmitProofDto) {
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
      await this.gamificationService.updateMissionProgress(userId, 'COMPLETE_N_TASKS' as never);
      await this.gamificationService.checkAchievements(userId);
      void this.antiAbuseService.recalculateTrustScore(userId).catch(() => null);

      return { creditsEarned: completion.campaign.creditPerTask, status: 'VERIFIED' };
    } else {
      // ── Manual review: hold proof, creator reviews first (48h), then admin ──
      const reviewDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      await this.prisma.taskCompletion.update({
        where: { id: completion.id },
        data: {
          status: CompletionStatus.SUBMITTED,
          proofUrl: dto.proofUrl,
          submittedAt: now,
          reviewDeadline,
        },
      });

      return {
        creditsEarned: 0,
        status: 'SUBMITTED',
        message: 'Proof submitted. The campaign creator will review within 48 hours.',
        reviewDeadline,
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
}
