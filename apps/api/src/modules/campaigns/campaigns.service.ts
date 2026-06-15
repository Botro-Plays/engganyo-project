import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CampaignStatus, CompletionStatus, TaskType, TransactionType, TrustLevel, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GamificationService, VP_REWARDS } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
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
  feeAmount: true,
  feeRateAtCreate: true,
  feeTier: true,
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
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly gamificationService: GamificationService,
    private readonly antiAbuseService: AntiAbuseService,
    private readonly socialAuthService: SocialAuthService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Create ────────────────────────────────────────────────

  // ─── Fee calculation (config-driven) ─────────────────────

  private async getFeeConfig(userId?: string) {
    const configRows = await this.prisma.platformConfig.findMany({
      where: {
        key: {
          in: [
            'fee_base_rate', 'fee_promo_enabled', 'fee_promo_rate', 'fee_promo_until',
            'campaign_min_budget',
            'fee_volume_t1_threshold', 'fee_volume_t1_rate',
            'fee_volume_t2_threshold', 'fee_volume_t2_rate',
            'fee_volume_t3_threshold', 'fee_volume_t3_rate',
          ],
        },
      },
      select: { key: true, value: true },
    });
    const cfg = (k: string, def: number | boolean | string) => {
      const row = configRows.find((r) => r.key === k);
      if (typeof def === 'boolean') return row?.value === true;
      if (typeof def === 'string') return typeof row?.value === 'string' ? row.value : def;
      return typeof row?.value === 'number' ? row.value : def;
    };

    const baseRate = cfg('fee_base_rate', 0.10) as number;
    const promoEnabled = cfg('fee_promo_enabled', false) as boolean;
    const promoRate = cfg('fee_promo_rate', 0.05) as number;
    const promoUntil = cfg('fee_promo_until', '') as string;
    const minBudget = cfg('campaign_min_budget', 100) as number;

    const now = new Date();
    const isPromoActive = promoEnabled && promoUntil && new Date(promoUntil) > now;
    let rate = isPromoActive ? promoRate : baseRate;
    let feeTier = isPromoActive ? 'PROMO' : 'STANDARD';

    // Volume discounts based on lifetime campaign spend
    if (userId) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { lifetimeSpent: true },
      });
      const lifetimeSpent = wallet?.lifetimeSpent ?? 0;

      const tiers = [
        { threshold: cfg('fee_volume_t3_threshold', 5000) as number, rate: cfg('fee_volume_t3_rate', 0.05) as number, label: 'VOLUME_T3' as const },
        { threshold: cfg('fee_volume_t2_threshold', 2000) as number, rate: cfg('fee_volume_t2_rate', 0.06) as number, label: 'VOLUME_T2' as const },
        { threshold: cfg('fee_volume_t1_threshold', 500) as number, rate: cfg('fee_volume_t1_rate', 0.08) as number, label: 'VOLUME_T1' as const },
      ];

      for (const tier of tiers) {
        if (lifetimeSpent >= tier.threshold && tier.rate < rate) {
          rate = tier.rate;
          feeTier = tier.label;
          break; // tiers ordered highest-first, first match is the best
        }
      }
    }

    // Apply VIP tier fee discount (lowest rate wins)
    if (userId) {
      const vipStatus = await this.gamificationService.getVipStatus(userId);
      const vipDiscount = vipStatus.perks.feeDiscountPercent ?? 0;
      if (vipDiscount > 0) {
        const vipRate = Math.max(rate * (1 - vipDiscount / 100), 0.01); // minimum 1% floor
        if (vipRate < rate) {
          rate = vipRate;
          feeTier = vipStatus.currentTier?.name ?? feeTier;
        }
      }
    }

    return { rate, minBudget, isPromoActive, feeTier };
  }

  private calculateFee(totalCost: number, rate: number) {
    return Math.round(totalCost * rate);
  }

  async create(userId: string, userRole: string, dto: CreateCampaignDto) {
    const totalCost = dto.totalSlots * dto.creditPerTask;
    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

    // Load fee config (with volume discount based on lifetime spend)
    const feeConfig = await this.getFeeConfig(userId);
    if (totalCost < feeConfig.minBudget) {
      throw new BadRequestException(
        `Campaign budget must be at least ${feeConfig.minBudget} credits (current: ${totalCost}).`,
      );
    }
    const feeAmount = this.calculateFee(totalCost, feeConfig.rate);
    const totalDebit = totalCost + feeAmount;

    // Check if the platform is enabled
    const platform = SocialAuthService.getPlatformForTaskType(dto.taskType as TaskType);
    if (platform) {
      const enabled = await this.socialAuthService.isPlatformEnabled(platform);
      if (!enabled) {
        throw new BadRequestException(
          `${platform.charAt(0) + platform.slice(1).toLowerCase()} tasks are currently disabled.`,
        );
      }
    }

    // ── Trust gate: enforce per-tier campaign restrictions ─────────────────
    if (!isAdmin) {
      const trustRecord = await this.prisma.trustScore.findUnique({
        where: { userId },
        select: { level: true },
      });
      const trustLevel = trustRecord?.level ?? TrustLevel.NEW;
      if (trustLevel === TrustLevel.NEW) {
        throw new BadRequestException(
          'Your trust score is too low to create campaigns. Complete tasks and verify social accounts to reach trust level LOW or higher.',
        );
      }
      if (trustLevel === TrustLevel.LOW && totalCost > 100) {
        throw new BadRequestException(
          `At trust level LOW, campaign budgets are limited to 100 credits. Increase your trust score to unlock larger campaigns. (Current budget: ${totalCost} credits)`,
        );
      }
    }

    // Debit pool + fee upfront
    await this.walletService.debit(userId, totalDebit, {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      description: `Campaign: ${dto.title} (includes ${feeAmount} platform fee)`,
    });

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
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
          feeAmount,
          feeRateAtCreate: feeConfig.rate,
          feeTier: feeConfig.feeTier,
          targetCountries: dto.targetCountries ?? [],
          targetLanguages: dto.targetLanguages ?? [],
          cooldownHours: dto.cooldownHours ?? 24,
          requiresProof: dto.requiresProof ?? true,
          proofInstructions: dto.proofInstructions,
          autoVerify: dto.autoVerify ?? OAUTH_PLATFORMS.has((dto.taskType as string).split('_')[0]),
          isPlatformTask: isAdmin,
          status: CampaignStatus.ACTIVE,
        },
      });

      await tx.platformRevenue.create({
        data: {
          date: new Date(),
          source: 'CAMPAIGN_FEE',
          amount: feeAmount,
          campaignId: created.id,
        },
      });

      return created;
    });

    // Award VP for campaign creation
    await this.gamificationService.awardVp(userId, VP_REWARDS.CAMPAIGN_CREATE, 'campaign_create', campaign.id);

    void this.notificationsService.createNotification(
      userId,
      NotificationType.VIP_POINTS_EARNED,
      'Campaign Created',
      `You earned ${VP_REWARDS.CAMPAIGN_CREATE} VIP Points for creating a campaign!`,
      { source: 'campaign_create', campaignId: campaign.id, vpEarned: VP_REWARDS.CAMPAIGN_CREATE },
    ).catch(() => null);

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
      const willBeFull = campaign.completedSlots + 1 >= campaign.totalSlots;

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

        await tx.campaign.update({
          where: { id: campaignId },
          data: {
            completedSlots: { increment: 1 },
            pendingSlots: { decrement: 1 },
            ...(willBeFull && { status: CampaignStatus.COMPLETED, completedAt: now }),
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

      await this.gamificationService.awardVp(completion.userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', campaignId);

      void this.notificationsService.createNotification(
        completion.userId,
        NotificationType.TASK_COMPLETED,
        'Task Approved',
        `Your task submission was approved. You earned ${campaign.creditPerTask} credits (+${VP_REWARDS.TASK_COMPLETION} VIP Points).`,
        { campaignId, completionId, creditsEarned: campaign.creditPerTask, vpEarned: VP_REWARDS.TASK_COMPLETION },
      ).catch(() => null);

      if (willBeFull) {
        void this.notificationsService.createNotification(
          campaign.userId,
          'CAMPAIGN_COMPLETED',
          'Campaign Completed',
          'All slots for your campaign have been filled.',
          { campaignId },
        ).catch(() => null);
      }

      this.eventsService.emitToUser(completion.userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'VERIFIED' });
      if (willBeFull) {
        this.eventsService.emitToUser(campaign.userId, 'campaign:updated', { campaignId, status: 'COMPLETED' });
      }

      // Clear browse caches since slot counts changed
      void this.redisService.delByPattern('campaigns:browse:*').catch(() => null);

      void this.antiAbuseService.queueRecalculate(completion.userId);
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

      void this.notificationsService.createNotification(
        completion.userId,
        'TASK_REJECTED',
        'Task Rejected',
        `Your task submission was rejected. Reason: ${dto.reason ?? 'Rejected by campaign creator'}`,
        { campaignId, completionId, reason: dto.reason },
      ).catch(() => null);

      this.eventsService.emitToUser(completion.userId, 'task:reviewed', { campaignId, completionId: completion.id, status: 'REJECTED' });

      // Clear browse caches since pending slots changed
      void this.redisService.delByPattern('campaigns:browse:*').catch(() => null);

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

    const updated = await this.prisma.campaign.update({
      where: { id: campaignId },
      select: CAMPAIGN_SELECT,
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.proofInstructions !== undefined && { proofInstructions: dto.proofInstructions }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    this.eventsService.emitToUser(userId, 'campaign:updated', { campaignId, status: dto.status });

    return updated;
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

    // Block cancellation if any completions exist
    const completionCount = await this.prisma.taskCompletion.count({
      where: { campaignId },
    });
    if (completionCount > 0) {
      throw new ForbiddenException(
        'Cannot cancel a campaign that has active or completed tasks. Contact admin for assistance.',
      );
    }

    // Refund uncompleted and non-pending slots (pool only, fee is kept)
    const refundableSlots = campaign.totalSlots - campaign.completedSlots - campaign.pendingSlots;
    const refundAmount = refundableSlots * campaign.creditPerTask;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.CANCELLED, cancelledAt: new Date() },
    });

    this.eventsService.emitToUser(userId, 'campaign:updated', { campaignId, status: CampaignStatus.CANCELLED });

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

    // ── Cache-aside: build cache key from user + filter params ──────────
    const cacheKey = `campaigns:browse:${excludeUserId}:${filters.taskType ?? '_'}:${filters.platformPrefix ?? '_'}:${filters.country ?? '_'}:${page}:${limit}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* parse fail — fall through to DB */
      }
    }

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

    const result = {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };

    // Write to cache with 5-minute TTL
    await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }
}
