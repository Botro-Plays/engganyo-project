import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ChallengeStatus,
  ChallengeVisibility,
  CompletionStatus,
  Prisma,
  TaskType,
  TransactionType,
  TrustLevel,
  NotificationType,
} from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GamificationService, VP_REWARDS } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { assertEngagementTaskAllowed } from '../../common/constants/disabled-engagement-tasks';
import type {
  CreateChallengeDto,
  ClaimChallengeDto,
  ChallengePasswordDto,
  ReviewChallengeDto,
} from './dto/challenge.dto';

const CHALLENGE_SELECT = {
  id: true,
  title: true,
  actionText: true,
  taskType: true,
  targetUrl: true,
  rewardCredits: true,
  requiresProof: true,
  proofInstructions: true,
  visibility: true,
  status: true,
  feeRateSnapshot: true,
  feeAmount: true,
  reservedCredits: true,
  claimedById: true,
  claimedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  creatorId: true,
  creator: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  claim: {
    select: {
      id: true,
      status: true,
      creditsEarned: true,
      proofUrl: true,
      assignedAt: true,
      submittedAt: true,
      verifiedAt: true,
      expiresAt: true,
      reviewDeadline: true,
      rejectionReason: true,
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
  },
} as const;

// Public listing shape — never leaks passwordHash or private-only fields.
const PUBLIC_CHALLENGE_SELECT = {
  id: true,
  title: true,
  actionText: true,
  taskType: true,
  targetUrl: true,
  rewardCredits: true,
  requiresProof: true,
  proofInstructions: true,
  visibility: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  creatorId: true,
  creator: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} as const;

const PW_FAIL_LIMIT = 5;
const PW_LOCK_SECONDS = 15 * 60;

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

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

  // ─── Config ────────────────────────────────────────────────

  private async getConfig() {
    const keys = [
      'challenge_fee_rate',
      'challenge_min_reward',
      'challenge_max_reward',
      'challenge_default_ttl_hours',
      'challenge_max_ttl_hours',
      'challenge_review_hours',
    ];
    const rows = await this.prisma.platformConfig.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const cfg = (k: string, def: number) => {
      const row = rows.find((r) => r.key === k);
      return typeof row?.value === 'number' ? row.value : def;
    };
    return {
      feeRate: cfg('challenge_fee_rate', 0),
      minReward: cfg('challenge_min_reward', 10),
      maxReward: cfg('challenge_max_reward', 500),
      defaultTtlHours: cfg('challenge_default_ttl_hours', 48),
      maxTtlHours: cfg('challenge_max_ttl_hours', 168),
      reviewHours: cfg('challenge_review_hours', 48),
    };
  }

  // Fee/reserve quote for the create form's review step — same math as publish.
  async quote(rewardCredits: number) {
    const cfg = await this.getConfig();
    const feeAmount = Math.ceil(rewardCredits * cfg.feeRate);
    return {
      rewardCredits,
      feeRate: cfg.feeRate,
      feeAmount,
      reservedCredits: rewardCredits + feeAmount,
      minReward: cfg.minReward,
      maxReward: cfg.maxReward,
      defaultTtlHours: cfg.defaultTtlHours,
      maxTtlHours: cfg.maxTtlHours,
    };
  }

  // ─── Create + publish (atomic reserve) ─────────────────────

  async create(userId: string, userRole: string, dto: CreateChallengeDto) {
    assertEngagementTaskAllowed(dto.taskType);

    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'MODERATOR';
    const cfg = await this.getConfig();

    if (dto.rewardCredits < cfg.minReward || dto.rewardCredits > cfg.maxReward) {
      throw new BadRequestException(
        `Reward must be between ${cfg.minReward} and ${cfg.maxReward} credits.`,
      );
    }

    const ttlHours = dto.expiresInHours ?? cfg.defaultTtlHours;
    if (ttlHours > cfg.maxTtlHours) {
      throw new BadRequestException(`Deadline cannot exceed ${cfg.maxTtlHours} hours.`);
    }

    const visibility = dto.visibility ?? ChallengeVisibility.PUBLIC;
    if (visibility === ChallengeVisibility.PRIVATE && !dto.password) {
      throw new BadRequestException('Private challenges require a password.');
    }

    // Same platform restrictions as campaigns
    const platform = SocialAuthService.getPlatformForTaskType(dto.taskType);
    if (platform) {
      const enabled = await this.socialAuthService.isPlatformEnabled(platform);
      if (!enabled) {
        throw new BadRequestException(
          `${platform.charAt(0) + platform.slice(1).toLowerCase()} tasks are currently disabled.`,
        );
      }
    }

    // Trust gate mirrors campaign creation (admins bypass)
    if (!isAdmin) {
      const trust = await this.prisma.trustScore.findUnique({
        where: { userId },
        select: { level: true },
      });
      const level = trust?.level ?? TrustLevel.NEW;
      if (level === TrustLevel.NEW) {
        throw new BadRequestException(
          'Your trust score is too low to create challenges. Complete tasks to reach trust level LOW or higher.',
        );
      }
    }

    // Fee: ceil so the platform never rounds a fee down to zero on small rewards
    const feeAmount = Math.ceil(dto.rewardCredits * cfg.feeRate);
    const reservedCredits = dto.rewardCredits + feeAmount;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const passwordHash =
      visibility === ChallengeVisibility.PRIVATE ? await argon2.hash(dto.password!) : null;

    const challenge = await this.prisma.$transaction(async (tx) => {
      const created = await tx.challenge.create({
        select: CHALLENGE_SELECT,
        data: {
          creatorId: userId,
          title: dto.title,
          actionText: dto.actionText,
          taskType: dto.taskType,
          targetUrl: dto.targetUrl,
          rewardCredits: dto.rewardCredits,
          requiresProof: dto.requiresProof ?? true,
          proofInstructions: dto.proofInstructions,
          visibility,
          passwordHash,
          feeRateSnapshot: cfg.feeRate,
          feeAmount,
          reservedCredits,
          expiresAt,
          status: ChallengeStatus.OPEN,
        },
      });

      // Atomic publish + reserve: insufficient balance rolls the whole tx back
      await this.walletService.debit(userId, reservedCredits, {
        type: TransactionType.SPEND_CHALLENGE_CREATE,
        description: `1v1 challenge: ${dto.title} (reward ${dto.rewardCredits} + fee ${feeAmount} reserved)`,
        referenceId: created.id,
        referenceType: 'challenge',
        metadata: { rewardCredits: dto.rewardCredits, feeAmount, feeRate: cfg.feeRate },
      }, tx);

      return created;
    });

    this.eventsService.emitToUser(userId, 'challenge:created', { challengeId: challenge.id });
    return challenge;
  }

  // ─── List public challenges (Find tasks tab) ───────────────

  async listPublic(excludeUserId: string, page = 1, limit = 12) {
    const now = new Date();
    const where = {
      status: ChallengeStatus.OPEN,
      visibility: ChallengeVisibility.PUBLIC,
      expiresAt: { gt: now },
      creatorId: { not: excludeUserId },
    };
    const [items, total] = await Promise.all([
      this.prisma.challenge.findMany({
        where,
        select: PUBLIC_CHALLENGE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.challenge.count({ where }),
    ]);
    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Creator's own challenges (My campaigns) ───────────────

  async listMine(userId: string, page = 1, limit = 20) {
    const where = { creatorId: userId };
    const [items, total] = await Promise.all([
      this.prisma.challenge.findMany({
        where,
        select: CHALLENGE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.challenge.count({ where }),
    ]);
    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Detail access ─────────────────────────────────────────

  // Public detail for OPEN public challenges, or for participants
  // (creator / claimant) regardless of status.
  async getOne(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: CHALLENGE_SELECT,
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    const isParticipant =
      challenge.creatorId === userId || challenge.claimedById === userId;
    const isOpenPublic =
      challenge.status === ChallengeStatus.OPEN &&
      challenge.visibility === ChallengeVisibility.PUBLIC &&
      challenge.expiresAt > new Date();
    if (!isParticipant && !isOpenPublic) throw new NotFoundException('Challenge not found');
    if (challenge.visibility === ChallengeVisibility.PRIVATE && !isParticipant) {
      throw new ForbiddenException('password_required');
    }
    // Never leak the hash
    const { passwordHash: _omit, ...rest } = challenge as Record<string, unknown> & {
      passwordHash?: string;
    };
    return rest;
  }

  // Minimal public probe — reveals nothing beyond "this exists and is private".
  async getPrivatePreview(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { id: true, visibility: true, status: true },
    });
    if (!challenge || challenge.visibility !== ChallengeVisibility.PRIVATE) {
      throw new NotFoundException('Challenge not found');
    }
    return { id: challenge.id, visibility: 'PRIVATE', requiresPassword: true };
  }

  private async checkPasswordThrottle(challengeId: string, ip: string) {
    const key = `challenge:pwfail:${challengeId}:${ip}`;
    const fails = Number((await this.redisService.get(key)) ?? 0);
    if (fails >= PW_FAIL_LIMIT) {
      throw new BadRequestException('Too many failed attempts. Try again later.');
    }
  }

  private async recordPasswordFailure(challengeId: string, ip: string) {
    const key = `challenge:pwfail:${challengeId}:${ip}`;
    const count = await this.redisService.incrWithExpiry(key, PW_LOCK_SECONDS);
    if (count === PW_FAIL_LIMIT) {
      this.logger.warn(`Challenge ${challengeId} password lockout triggered for ip=${ip}`);
    }
  }

  private async clearPasswordFailures(challengeId: string, ip: string) {
    await this.redisService.del(`challenge:pwfail:${challengeId}:${ip}`).catch(() => null);
  }

  // Password gate for private challenges — returns the full challenge on success.
  async verifyAccess(userId: string, challengeId: string, dto: ChallengePasswordDto, ip: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { ...CHALLENGE_SELECT, passwordHash: true },
    });
    if (!challenge || challenge.visibility !== ChallengeVisibility.PRIVATE) {
      throw new NotFoundException('Challenge not found');
    }
    await this.checkPasswordThrottle(challengeId, ip);
    const ok = challenge.passwordHash
      ? await argon2.verify(challenge.passwordHash, dto.password)
      : false;
    if (!ok) {
      await this.recordPasswordFailure(challengeId, ip);
      throw new ForbiddenException('Incorrect password');
    }
    await this.clearPasswordFailures(challengeId, ip);
    const { passwordHash: _omit, ...rest } = challenge;
    return rest;
  }

  // ─── Claim (atomic, single slot) ───────────────────────────

  async claim(userId: string, challengeId: string, dto: ClaimChallengeDto, ip: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        visibility: true,
        passwordHash: true,
        expiresAt: true,
        taskType: true,
        title: true,
      },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');

    // Private challenges require the password on every claim attempt
    if (challenge.visibility === ChallengeVisibility.PRIVATE) {
      await this.checkPasswordThrottle(challengeId, ip);
      const ok = challenge.passwordHash && dto.password
        ? await argon2.verify(challenge.passwordHash, dto.password)
        : false;
      if (!ok) {
        await this.recordPasswordFailure(challengeId, ip);
        throw new ForbiddenException('Incorrect password');
      }
      await this.clearPasswordFailures(challengeId, ip);
    }

    if (challenge.creatorId === userId) {
      throw new ForbiddenException('You cannot claim your own challenge');
    }
    if (challenge.status !== ChallengeStatus.OPEN) {
      throw new ConflictException('This challenge is no longer available');
    }
    if (challenge.expiresAt <= new Date()) {
      throw new BadRequestException('This challenge has expired');
    }

    // Same eligibility gates as campaign assignment
    assertEngagementTaskAllowed(challenge.taskType);
    const requiredPlatform = SocialAuthService.getPlatformForTaskType(challenge.taskType);
    if (requiredPlatform) {
      const enabled = await this.socialAuthService.isPlatformEnabled(requiredPlatform);
      if (!enabled) {
        throw new BadRequestException(
          `${requiredPlatform.charAt(0) + requiredPlatform.slice(1).toLowerCase()} tasks are currently disabled.`,
        );
      }
      // No linked-account requirement: challenge proofs are always
      // creator-reviewed (submitChallengeProof never calls the platform
      // API), so the screenshot itself is the verification evidence.
    }

    // Anti-abuse: shared-IP self-farming guard (same rule as campaigns)
    const sharedIp = await this.prisma.userSession.findFirst({
      where: {
        userId: challenge.creatorId,
        ipAddress: ip,
        lastUsedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        isRevoked: false,
      },
      select: { id: true },
    });
    if (sharedIp && ip) {
      this.logger.warn(`Challenge self-farm blocked: ${userId} shares IP with creator ${challenge.creatorId}`);
      void this.antiAbuseService.flagUser(
        userId,
        'alt_account_self_farm',
        'critical',
        `Shared IP ${ip} with challenge creator ${challenge.creatorId}`,
        { clientIp: ip, creatorId: challenge.creatorId, challengeId },
      ).catch(() => null);
      throw new BadRequestException('This claim is restricted due to potential account abuse.');
    }

    // Atomic claim: conditional UPDATE serializes concurrent claimants on the
    // row lock; exactly one gets count=1. TaskCompletion.challengeId @unique
    // is the database backstop — a second insert would violate it.
    // NOTE: expires_at is `timestamp` (no tz). Binding a JS Date lets Prisma
    // type the param as timestamptz, which coerces the column through the
    // session TimeZone — shifting the deadline by the server offset (a
    // challenge expiring within the offset window becomes unclaimable).
    // Send a naive-UTC string cast to ::timestamp instead — the same frame
    // Prisma uses when it writes DateTime fields.
    const nowParam = new Date().toISOString().slice(0, -1).replace('T', ' ');
    const completion = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE challenges
        SET status = 'CLAIMED'::"ChallengeStatus",
            claimed_by_id = ${userId},
            claimed_at = ${nowParam}::timestamp,
            updated_at = ${nowParam}::timestamp
        WHERE id = ${challengeId}
          AND status = 'OPEN'::"ChallengeStatus"
          AND expires_at > ${nowParam}::timestamp`;
      if (claimed !== 1) {
        throw new ConflictException('This challenge was just claimed by someone else');
      }
      return tx.taskCompletion.create({
        select: {
          id: true,
          status: true,
          assignedAt: true,
          expiresAt: true,
          challengeId: true,
        },
        data: {
          challengeId,
          userId,
          status: CompletionStatus.ASSIGNED,
          expiresAt: challenge.expiresAt,
        },
      });
    });

    void this.notificationsService.createNotification(
      challenge.creatorId,
      NotificationType.TASK_ASSIGNED,
      'Challenge Claimed',
      `Your 1v1 challenge "${challenge.title}" was claimed. Review the proof when it's submitted.`,
      { challengeId, completionId: completion.id },
    ).catch(() => null);

    this.eventsService.emitToUser(userId, 'challenge:claimed', { challengeId, completionId: completion.id });
    this.eventsService.emitToUser(challenge.creatorId, 'challenge:claimed', { challengeId, completionId: completion.id });

    return {
      completionId: completion.id,
      challengeId,
      status: completion.status,
      expiresAt: completion.expiresAt,
    };
  }

  // ─── Creator cancel (OPEN only) ────────────────────────────

  async cancel(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        reservedCredits: true,
        title: true,
      },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    if (challenge.creatorId !== userId) throw new ForbiddenException('Not your challenge');
    if (challenge.status !== ChallengeStatus.OPEN) {
      throw new BadRequestException('Only open (unclaimed) challenges can be cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.challenge.updateMany({
        where: { id: challengeId, status: ChallengeStatus.OPEN },
        data: {
          status: ChallengeStatus.CANCELLED,
          closedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException('Challenge is no longer open');
      }
      // Full reserve returned — nothing was earned
      await this.walletService.credit(userId, challenge.reservedCredits, {
        type: TransactionType.REFUND_CHALLENGE_CLOSE,
        description: `Challenge cancelled: ${challenge.title} (reward + fee refunded)`,
        referenceId: challengeId,
        referenceType: 'challenge',
      }, tx);
    });

    this.eventsService.emitToUser(userId, 'challenge:cancelled', { challengeId });
    return { cancelled: true };
  }

  // ─── Creator: submissions + review ─────────────────────────

  async getSubmissions(userId: string, challengeId: string, page = 1, limit = 20) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { creatorId: true },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    if (challenge.creatorId !== userId) throw new ForbiddenException('Not your challenge');

    const skip = (page - 1) * limit;
    const where = { challengeId, status: CompletionStatus.SUBMITTED };
    const [items, total] = await Promise.all([
      this.prisma.taskCompletion.findMany({
        where,
        select: {
          id: true,
          proofUrl: true,
          proofScreenshot: true,
          submittedAt: true,
          reviewDeadline: true,
          assignedAt: true,
          completionSeconds: true,
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true, reputationScore: true, level: true } },
        },
        orderBy: { submittedAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.taskCompletion.count({ where }),
    ]);
    const now = new Date();
    return {
      items: items.map((item) => ({
        ...item,
        escalated: item.reviewDeadline ? item.reviewDeadline < now : false,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Approve → reward to claimant + fee recorded; Reject → final close + full refund.
  // Both paths close the challenge permanently (single slot is consumed).
  async reviewSubmission(
    userId: string,
    challengeId: string,
    completionId: string,
    dto: ReviewChallengeDto,
  ) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        rewardCredits: true,
        feeAmount: true,
        reservedCredits: true,
        title: true,
        taskType: true,
      },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    if (challenge.creatorId !== userId) throw new ForbiddenException('Not your challenge');
    if (dto.action === 'approve') assertEngagementTaskAllowed(challenge.taskType);

    const completion = await this.prisma.taskCompletion.findUnique({
      where: { id: completionId },
      select: { id: true, status: true, userId: true, challengeId: true },
    });
    if (!completion || completion.challengeId !== challengeId) {
      throw new NotFoundException('Submission not found');
    }
    if (completion.userId === challenge.creatorId) {
      throw new BadRequestException('Challenge creators cannot earn from their own challenge');
    }
    if (completion.status !== CompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submission is not pending review');
    }

    const now = new Date();

    if (dto.action === 'approve') {
      await this.prisma.$transaction(async (tx) => {
        // Claim the completion exactly once — concurrent reviews lose with count 0
        const claim = await tx.taskCompletion.updateMany({
          where: { id: completionId, status: CompletionStatus.SUBMITTED },
          data: {
            status: CompletionStatus.VERIFIED,
            verifiedAt: now,
            verifiedBy: userId,
            creditsEarned: challenge.rewardCredits,
          },
        });
        if (claim.count !== 1) {
          throw new ConflictException('Submission is not pending review — already processed.');
        }

        // Close the challenge + settle: reward to claimant, fee to platform revenue.
        // The creator's reserve was debited at publish; the reward portion moves
        // to the claimant and the fee portion is recorded as platform revenue.
        const closed = await tx.challenge.updateMany({
          where: { id: challengeId, status: ChallengeStatus.CLAIMED },
          data: {
            status: ChallengeStatus.COMPLETED,
            closedAt: now,
            updatedAt: now,
          },
        });
        if (closed.count !== 1) {
          throw new ConflictException('Challenge is no longer in a reviewable state.');
        }

        await this.walletService.credit(completion.userId, challenge.rewardCredits, {
          type: TransactionType.EARN_TASK_COMPLETION,
          description: `1v1 challenge approved: ${challenge.title}`,
          referenceId: challengeId,
          referenceType: 'challenge',
        }, tx);

        if (challenge.feeAmount > 0) {
          await tx.platformRevenue.create({
            data: {
              date: now,
              source: 'CHALLENGE_FEE',
              amount: challenge.feeAmount,
              challengeId,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: 'challenge.approved',
            entityType: 'TaskCompletion',
            entityId: completionId,
            newValue: { rewardCredits: challenge.rewardCredits, feeAmount: challenge.feeAmount, reviewedBy: 'challenge_creator' },
          },
        });
      });

      void this.gamificationService.awardVp(completion.userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', challengeId).catch(() => null);
      void this.gamificationService.updateMissionProgress(completion.userId, 'COMPLETE_N_TASKS' as never).catch(() => null);
      void this.gamificationService.checkAchievements(completion.userId).catch(() => null);
      void this.antiAbuseService.queueRecalculate(completion.userId).catch(() => null);

      void this.notificationsService.createNotification(
        completion.userId,
        NotificationType.TASK_COMPLETED,
        'Challenge Approved',
        `Your proof for "${challenge.title}" was approved. You earned ${challenge.rewardCredits} credits.`,
        { challengeId, completionId, creditsEarned: challenge.rewardCredits },
      ).catch(() => null);

      this.eventsService.emitToUser(completion.userId, 'task:reviewed', { challengeId, completionId, status: 'VERIFIED' });
      this.eventsService.emitToUser(userId, 'challenge:updated', { challengeId, status: 'COMPLETED' });
      this.eventsService.emitToAdmins('task:reviewed', { challengeId, completionId, status: 'VERIFIED' });

      return { reviewed: true, action: 'approve', creditsAwarded: challenge.rewardCredits };
    }

    // Reject → final close: challenge COMPLETED (slot consumed), reserve refunded
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.taskCompletion.updateMany({
        where: { id: completionId, status: CompletionStatus.SUBMITTED },
        data: {
          status: CompletionStatus.REJECTED,
          rejectionReason: dto.reason ?? 'Rejected by challenge creator',
          verifiedAt: now,
          verifiedBy: userId,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Submission is not pending review — already processed.');
      }

      const closed = await tx.challenge.updateMany({
        where: { id: challengeId, status: ChallengeStatus.CLAIMED },
        data: {
          status: ChallengeStatus.COMPLETED,
          closedAt: now,
          updatedAt: now,
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException('Challenge is no longer in a reviewable state.');
      }

      // Non-award close: reward + fee both return to the creator
      await this.walletService.credit(challenge.creatorId, challenge.reservedCredits, {
        type: TransactionType.REFUND_CHALLENGE_CLOSE,
        description: `Challenge rejected: ${challenge.title} (reward + fee refunded)`,
        referenceId: challengeId,
        referenceType: 'challenge',
      }, tx);

      await tx.auditLog.create({
        data: {
          userId,
          action: 'challenge.rejected',
          entityType: 'TaskCompletion',
          entityId: completionId,
          newValue: { reason: dto.reason ?? 'Rejected by challenge creator', reviewedBy: 'challenge_creator' },
        },
      });
    });

    void this.notificationsService.createNotification(
      completion.userId,
      NotificationType.TASK_REJECTED,
      'Challenge Rejected',
      `Your proof for "${challenge.title}" was rejected. Reason: ${dto.reason ?? 'Proof did not meet requirements'}`,
      { challengeId, completionId, reason: dto.reason },
    ).catch(() => null);

    this.eventsService.emitToUser(completion.userId, 'task:reviewed', { challengeId, completionId, status: 'REJECTED' });
    this.eventsService.emitToUser(userId, 'challenge:updated', { challengeId, status: 'COMPLETED' });
    this.eventsService.emitToAdmins('task:reviewed', { challengeId, completionId, status: 'REJECTED' });

    return { reviewed: true, action: 'reject' };
  }

  // ─── Expiry sweep (cron) ───────────────────────────────────
  // OPEN past expiresAt → EXPIRED + full refund.
  // CLAIMED whose completion is ASSIGNED/IN_PROGRESS past expiresAt →
  // completion EXPIRED + challenge EXPIRED + full refund.
  // SUBMITTED completions are left for creator/admin review (reserve held).

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpired() {
    const now = new Date();

    // 1) Unclaimed challenges past their offer window
    const expiredOpen = await this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.OPEN,
        expiresAt: { lte: now },
      },
      select: { id: true, creatorId: true, reservedCredits: true, title: true },
      take: 100,
    });
    for (const ch of expiredOpen) {
      // OPEN-only source state: if the offer was claimed between selection
      // and this write, the guarded update matches zero rows — no close,
      // no refund. Claimed expiry is handled by the assignment-aware path.
      await this.closeWithoutAward(ch.id, ChallengeStatus.EXPIRED, 'Challenge offer expired', ChallengeStatus.OPEN)
        .catch((err) => this.logger.warn(`Failed to expire challenge ${ch.id}: ${err}`));
    }

    // 2) Claimed challenges whose claimant abandoned the task
    const abandoned = await this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.CLAIMED,
        claim: {
          status: { in: [CompletionStatus.ASSIGNED, CompletionStatus.IN_PROGRESS] },
          expiresAt: { lte: now },
        },
      },
      select: {
        id: true,
        creatorId: true,
        reservedCredits: true,
        title: true,
        claim: { select: { id: true } },
      },
      take: 100,
    });
    for (const ch of abandoned) {
      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.taskCompletion.updateMany({
          where: {
            id: ch.claim!.id,
            status: { in: [CompletionStatus.ASSIGNED, CompletionStatus.IN_PROGRESS] },
          },
          data: { status: CompletionStatus.EXPIRED },
        });
        if (expired.count !== 1) return; // already moved on — leave it
        const closed = await tx.challenge.updateMany({
          where: { id: ch.id, status: ChallengeStatus.CLAIMED },
          data: { status: ChallengeStatus.EXPIRED, closedAt: now, updatedAt: now },
        });
        if (closed.count !== 1) return;
        await this.walletService.credit(ch.creatorId, ch.reservedCredits, {
          type: TransactionType.REFUND_CHALLENGE_CLOSE,
          description: `Challenge expired: ${ch.title} (reward + fee refunded)`,
          referenceId: ch.id,
          referenceType: 'challenge',
        }, tx);
      }).catch((err) => this.logger.warn(`Failed to expire claimed challenge ${ch.id}: ${err}`));
    }
  }

  // Closes a challenge without an award and refunds the full reserve.
  // `fromStatus` is the ONLY source state the atomic update may match — a
  // stale sweep candidate (e.g. an OPEN row that was claimed between
  // selection and close) writes zero rows and refunds zero credits. For
  // OPEN offers we also re-check expiresAt so the guard holds even if the
  // row was touched between selection and write.
  private async closeWithoutAward(
    challengeId: string,
    status: ChallengeStatus,
    reason: string,
    fromStatus: ChallengeStatus,
  ) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { creatorId: true, reservedCredits: true, title: true, status: true },
    });
    if (!ch) return;
    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.challenge.updateMany({
        where: {
          id: challengeId,
          status: fromStatus,
          ...(fromStatus === ChallengeStatus.OPEN
            ? { expiresAt: { lte: new Date() } }
            : {}),
        },
        data: { status, closedAt: new Date(), updatedAt: new Date() },
      });
      if (closed.count !== 1) return;
      await this.walletService.credit(ch.creatorId, ch.reservedCredits, {
        type: TransactionType.REFUND_CHALLENGE_CLOSE,
        description: `${reason}: ${ch.title} (reward + fee refunded)`,
        referenceId: challengeId,
        referenceType: 'challenge',
      }, tx);
    });
  }

  // ─── Helpers for tasks/admin integration ──────────────────

  // Fetch the challenge + completion context for a completion id (used by
  // tasks.service submitProof and admin review).
  async getCompletionContext(completionId: string) {
    return this.prisma.taskCompletion.findUnique({
      where: { id: completionId },
      select: {
        id: true,
        status: true,
        userId: true,
        challengeId: true,
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
            expiresAt: true,
            creator: { select: { username: true, displayName: true } },
          },
        },
      },
    });
  }
}
