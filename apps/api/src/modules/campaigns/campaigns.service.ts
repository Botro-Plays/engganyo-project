import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CampaignStatus, CompletionStatus, TaskType, TransactionType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { UpdateCampaignDto } from './dto/update-campaign.dto';
import type { ListCampaignsDto } from './dto/list-campaigns.dto';

// Platforms with full OAuth API verification — auto-verify defaults to true for these
const OAUTH_PLATFORMS = new Set(['YOUTUBE', 'TWITCH', 'SPOTIFY']);

const CAMPAIGN_SELECT = {
  id: true,
  title: true,
  description: true,
  taskType: true,
  targetUrl: true,
  totalSlots: true,
  completedSlots: true,
  pendingSlots: true,
  creditPerTask: true,
  totalCost: true,
  status: true,
  rejectionReason: true,
  targetCountries: true,
  targetLanguages: true,
  minTrustScore: true,
  cooldownHours: true,
  requiresProof: true,
  proofInstructions: true,
  autoVerify: true,
  startsAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  userId: true,
  isPlatformTask: true,
  user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} as const;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // ─── Create ────────────────────────────────────────────────

  async create(userId: string, userRole: string, dto: CreateCampaignDto) {
    const totalCost = dto.totalSlots * dto.creditPerTask;
    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

    // Debit the full campaign cost upfront
    await this.walletService.debit(userId, totalCost, {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      description: `Campaign: ${dto.title}`,
    });

    const campaign = await this.prisma.campaign.create({
      select: CAMPAIGN_SELECT,
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        taskType: dto.taskType,
        targetUrl: dto.targetUrl,
        totalSlots: dto.totalSlots,
        creditPerTask: dto.creditPerTask,
        totalCost,
        targetCountries: dto.targetCountries ?? [],
        targetLanguages: dto.targetLanguages ?? [],
        cooldownHours: dto.cooldownHours ?? 24,
        requiresProof: dto.requiresProof ?? true,
        proofInstructions: dto.proofInstructions,
        autoVerify: dto.autoVerify ?? OAUTH_PLATFORMS.has((dto.taskType as string).split('_')[0]),
        // Auto-mark admin-created campaigns as platform tasks for discover
        isPlatformTask: isAdmin,
        // Auto-activate for Phase 5 (admin review added in Phase 8)
        status: CampaignStatus.ACTIVE,
      },
    });

    return campaign;
  }

  // ─── List own campaigns ────────────────────────────────────

  async listMyCampaigns(userId: string, dto: ListCampaignsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      isPlatformTask: false,
      ...(dto.status && { status: dto.status }),
      ...(dto.taskType && { taskType: dto.taskType }),
    };

    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        select: CAMPAIGN_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Get one (own) ─────────────────────────────────────────

  async getOne(userId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: CAMPAIGN_SELECT,
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId !== userId) throw new ForbiddenException('Not your campaign');
    return campaign;
  }

  // ─── Creator: list submissions for a campaign ─────────────

  async getMySubmissions(userId: string, campaignId: string, page = 1, limit = 20) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true, creditPerTask: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId !== userId) throw new ForbiddenException('Not your campaign');

    const now = new Date();
    const skip = (page - 1) * limit;
    const where = { campaignId, status: CompletionStatus.SUBMITTED };

    const [items, total] = await Promise.all([
      this.prisma.taskCompletion.findMany({
        where,
        select: {
          id: true,
          proofUrl: true,
          submittedAt: true,
          reviewDeadline: true,
          user: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { submittedAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.taskCompletion.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        escalated: item.reviewDeadline ? item.reviewDeadline < now : false,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Creator: approve or reject a submission ───────────────

  async reviewSubmission(
    userId: string,
    campaignId: string,
    completionId: string,
    dto: { action: 'approve' | 'reject'; reason?: string },
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true, creditPerTask: true, completedSlots: true, totalSlots: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId !== userId) throw new ForbiddenException('Not your campaign');

    const completion = await this.prisma.taskCompletion.findUnique({
      where: { id: completionId },
      select: { id: true, status: true, userId: true, campaignId: true },
    });
    if (!completion) throw new NotFoundException('Submission not found');
    if (completion.campaignId !== campaignId) throw new ForbiddenException('Submission does not belong to this campaign');
    if (completion.status !== CompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submission is not pending review');
    }

    // ── Ownership enforcement: campaign owners cannot receive rewards for their own tasks ──
    if (completion.userId === campaign.userId) {
      throw new BadRequestException('Campaign owners cannot receive rewards for their own tasks');
    }

    const now = new Date();

    if (dto.action === 'approve') {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskCompletion.update({
          where: { id: completionId },
          data: {
            status: CompletionStatus.VERIFIED,
            verifiedAt: now,
            verifiedBy: userId,
            creditsEarned: campaign.creditPerTask,
          },
        });

        const isFull = campaign.completedSlots + 1 >= campaign.totalSlots;
        await tx.campaign.update({
          where: { id: campaignId },
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

      await this.walletService.credit(completion.userId, campaign.creditPerTask, {
        type: TransactionType.EARN_TASK_COMPLETION,
        description: 'Task approved by campaign creator',
        referenceId: campaignId,
        referenceType: 'campaign',
      });

      return { reviewed: true, action: 'approve', creditsAwarded: campaign.creditPerTask };
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskCompletion.update({
          where: { id: completionId },
          data: {
            status: CompletionStatus.REJECTED,
            rejectionReason: dto.reason ?? 'Rejected by campaign creator',
            verifiedAt: now,
            verifiedBy: userId,
          },
        });
        await tx.campaign.update({
          where: { id: campaignId },
          data: { pendingSlots: { decrement: 1 } },
        });
      });

      return { reviewed: true, action: 'reject' };
    }
  }

  // ─── Update (pause / resume / edit) ───────────────────────

  async update(userId: string, campaignId: string, dto: UpdateCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, userId: true, status: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId !== userId) throw new ForbiddenException('Not your campaign');

    const modifiableStatuses: CampaignStatus[] = [
      CampaignStatus.ACTIVE,
      CampaignStatus.PAUSED,
      CampaignStatus.DRAFT,
    ];
    if (!modifiableStatuses.includes(campaign.status)) {
      throw new BadRequestException(`Cannot modify a campaign with status ${campaign.status}`);
    }

    return this.prisma.campaign.update({
      where: { id: campaignId },
      select: CAMPAIGN_SELECT,
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.proofInstructions !== undefined && { proofInstructions: dto.proofInstructions }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  // ─── Cancel + refund ───────────────────────────────────────

  async cancel(userId: string, campaignId: string) {
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
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.userId !== userId) throw new ForbiddenException('Not your campaign');

    const cancellableStatuses: CampaignStatus[] = [
      CampaignStatus.ACTIVE,
      CampaignStatus.PAUSED,
      CampaignStatus.DRAFT,
      CampaignStatus.PENDING_REVIEW,
    ];
    if (!cancellableStatuses.includes(campaign.status)) {
      throw new BadRequestException(`Cannot cancel a campaign with status ${campaign.status}`);
    }

    // Refund uncompleted and non-pending slots
    const refundableSlots = campaign.totalSlots - campaign.completedSlots - campaign.pendingSlots;
    const refundAmount = refundableSlots * campaign.creditPerTask;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.CANCELLED, cancelledAt: new Date() },
    });

    if (refundAmount > 0) {
      await this.walletService.credit(userId, refundAmount, {
        type: TransactionType.REFUND_CAMPAIGN_CANCEL,
        description: `Refund for cancelled campaign: ${campaign.title}`,
        referenceId: campaignId,
        referenceType: 'campaign',
      });
    }

    return { refundAmount };
  }

  // ─── Public browse (for task marketplace) ─────────────────

  async browseActive(
    excludeUserId: string,
    filters: { taskType?: string; platformPrefix?: string; country?: string; page?: number; limit?: number },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    // Exclude campaigns the user already has a completion for
    const alreadyAssigned = await this.prisma.taskCompletion.findMany({
      where: { userId: excludeUserId },
      select: { campaignId: true },
    });
    const excludeIds = alreadyAssigned.map((c) => c.campaignId);

    // Build taskType filter: exact match OR all enum values starting with platform prefix
    let taskTypeWhere: object | undefined;
    if (filters.taskType) {
      taskTypeWhere = { taskType: filters.taskType as never };
    } else if (filters.platformPrefix) {
      const matching = Object.values(TaskType).filter((t) =>
        t.startsWith(filters.platformPrefix!),
      );
      if (matching.length > 0) {
        taskTypeWhere = { taskType: { in: matching } };
      }
    }

    // Geo filter: if country provided, show campaigns targeting that country OR unrestricted ones
    const countryWhere = filters.country
      ? {
          OR: [
            { targetCountries: { isEmpty: true } },
            { targetCountries: { has: filters.country.toUpperCase() } },
          ],
        }
      : {};

    const where = {
      status: CampaignStatus.ACTIVE,
      id: { notIn: excludeIds.length > 0 ? excludeIds : ['__none__'] },
      ...taskTypeWhere,
      ...countryWhere,
    };

    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        select: CAMPAIGN_SELECT,
        orderBy: [{ isPlatformTask: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
