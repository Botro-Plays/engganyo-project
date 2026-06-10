import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ReportReason, TrustLevel, UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { TRUST_SCORE_QUEUE, TRUST_SCORE_JOBS } from './anti-abuse.processor';
import type { CreateReportDto } from './dto/create-report.dto';

// ─── Trust score weights ──────────────────────────────────────
// Max 100 pts:
//  40 pts — completion rate (verified tasks / assigned tasks)
//  20 pts — account age (capped at 365 days → 1 yr)
//  25 pts — verified social accounts (5 pts each, max 5)
//  15 pts — clean flags (penalised per high/critical abuse flag)
// Penalty deductions:
//  -10 pts max — received reports

const getTrustLevel = (score: number): TrustLevel => {
  if (score <= 20) return TrustLevel.NEW;
  if (score <= 40) return TrustLevel.LOW;
  if (score <= 60) return TrustLevel.MEDIUM;
  if (score <= 80) return TrustLevel.HIGH;
  return TrustLevel.VERIFIED;
};

const AUTO_SUSPEND_CRITICAL_FLAGS = 3;
const AUTO_SUSPEND_HIGH_FLAGS = 6;

@Injectable()
export class AntiAbuseService {
  private readonly logger = new Logger(AntiAbuseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @InjectQueue(TRUST_SCORE_QUEUE) private readonly queue: Queue,
  ) {}

  // ─── Trust score ───────────────────────────────────────────

  async queueRecalculate(userId: string): Promise<void> {
    await this.queue.add(TRUST_SCORE_JOBS.RECALCULATE, { userId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 50,
      removeOnFail: 20,
    });
  }

  async getTrustScore(userId: string) {
    const cacheKey = `trustscore:${userId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through to recalc */ }
    }
    return this.recalculateTrustScore(userId);
  }

  async recalculateTrustScore(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        socialAccounts: { select: { isVerified: true } },
        completions: {
          select: { status: true },
        },
        _count: { select: { reportsReceived: true } },
        abuseFlags: {
          where: { isResolved: false },
          select: { severity: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const accountAgeDays = Math.floor(
      (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    const verifiedSocials = user.socialAccounts.length;

    const totalTasks = user.completions.length;
    const verifiedTasks = user.completions.filter((c) => c.status === 'VERIFIED').length;
    const completionRate = totalTasks > 0 ? verifiedTasks / totalTasks : 0;

    const criticalFlags = user.abuseFlags.filter((f) => f.severity === 'critical').length;
    const highFlags = user.abuseFlags.filter((f) => f.severity === 'high').length;
    const totalBadFlags = criticalFlags * 3 + highFlags;
    const reportCount = user._count.reportsReceived;

    // Load configurable weights
    const cfg = await this.prisma.platformConfig.findMany({
      where: { key: { startsWith: 'trust_score_' } },
    });
    const c = (k: string, def: number) => {
      const row = cfg.find((r) => r.key === k);
      return typeof row?.value === 'number' ? row.value : def;
    };

    const completionWeight = c('trust_score_completion_weight', 40);
    const ageMax = c('trust_score_age_max', 20);
    const socialPer = c('trust_score_social_per', 5);
    const socialMax = c('trust_score_social_max', 25);
    const flagMax = c('trust_score_flag_max', 15);
    const flagThreshold = c('trust_score_flag_threshold', 5);
    const reportMax = c('trust_score_report_max', 10);
    const reportThreshold = c('trust_score_report_threshold', 10);
    const taskBonus = c('trust_score_task_bonus', 2);

    // Score calculation
    const completionPts = completionRate * completionWeight + verifiedTasks * taskBonus;
    const agePts = Math.min(accountAgeDays / 365, 1) * ageMax;
    const socialPts = Math.min(verifiedSocials * socialPer, socialMax);
    const flagPts = Math.max(0, (1 - Math.min(totalBadFlags / flagThreshold, 1)) * flagMax);
    const reportPenalty = Math.min(reportCount / reportThreshold, 1) * reportMax;

    const score = Math.max(0, Math.min(100, completionPts + agePts + socialPts + flagPts - reportPenalty));
    const level = getTrustLevel(score);

    const trust = await this.prisma.trustScore.upsert({
      where: { userId },
      create: {
        userId,
        score,
        level,
        completionRate,
        accountAgeDays,
        verifiedSocials,
        reportCount,
        abuseFlagCount: user.abuseFlags.length,
        lastCalculatedAt: new Date(),
      },
      update: {
        score,
        level,
        completionRate,
        accountAgeDays,
        verifiedSocials,
        reportCount,
        abuseFlagCount: user.abuseFlags.length,
        lastCalculatedAt: new Date(),
      },
    });

    this.logger.debug(`TrustScore recalculated for ${userId}: ${score.toFixed(1)} (${level})`);

    // Cache recalculated score for 1 hour to reduce DB load
    await this.redisService.set(`trustscore:${userId}`, JSON.stringify(trust), 3600);

    return trust;
  }

  // ─── Reports ───────────────────────────────────────────────

  async submitReport(submittedById: string, dto: CreateReportDto) {
    if (!dto.targetUserId && !dto.campaignId && !dto.topicId && !dto.replyId) {
      throw new BadRequestException('Must provide targetUserId, campaignId, topicId, or replyId');
    }
    if (dto.targetUserId && dto.targetUserId === submittedById) {
      throw new BadRequestException('Cannot report yourself');
    }

    let targetUserId = dto.targetUserId;

    // Derive target user from forum post if not explicitly provided
    if (!targetUserId && dto.topicId) {
      const topic = await this.prisma.forumTopic.findUnique({
        where: { id: dto.topicId },
        select: { authorId: true },
      });
      if (!topic) throw new NotFoundException('Topic not found');
      targetUserId = topic.authorId;
    }
    if (!targetUserId && dto.replyId) {
      const reply = await this.prisma.forumReply.findUnique({
        where: { id: dto.replyId },
        select: { authorId: true },
      });
      if (!reply) throw new NotFoundException('Reply not found');
      targetUserId = reply.authorId;
    }

    if (targetUserId && targetUserId === submittedById) {
      throw new BadRequestException('Cannot report yourself');
    }

    const report = await this.prisma.report.create({
      data: {
        submittedById,
        targetUserId,
        campaignId: dto.campaignId,
        topicId: dto.topicId,
        replyId: dto.replyId,
        reason: dto.reason,
        description: dto.description,
      },
      select: {
        id: true,
        reason: true,
        description: true,
        status: true,
        createdAt: true,
        targetUser: { select: { username: true } },
        campaign: { select: { title: true } },
        topic: { select: { title: true } },
        reply: { select: { id: true } },
      },
    });

    // Auto-flag target user for high-signal reasons
    if (dto.targetUserId) {
      const autoFlagReasons: Partial<Record<ReportReason, { severity: string; flagType: string }>> = {
        FAKE_COMPLETION:   { severity: 'high',     flagType: 'fake_proof' },
        MULTI_ACCOUNTING:  { severity: 'critical',  flagType: 'multi_account' },
        BOT_ACTIVITY:      { severity: 'critical',  flagType: 'bot_pattern' },
      };

      const autoFlag = autoFlagReasons[dto.reason];
      if (autoFlag) {
        await this.flagUser(dto.targetUserId, autoFlag.flagType, autoFlag.severity, `Auto-flagged from report: ${dto.reason}`);
        await this.checkAndEscalate(dto.targetUserId);
      }

      // Bump report count on trust score
      await this.prisma.trustScore.updateMany({
        where: { userId: dto.targetUserId },
        data: { reportCount: { increment: 1 } },
      });
    }

    return report;
  }

  async getMyReports(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { submittedById: userId };

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        select: {
          id: true,
          reason: true,
          description: true,
          status: true,
          createdAt: true,
          targetUser: { select: { username: true, displayName: true } },
          campaign: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Abuse flags ───────────────────────────────────────────

  async flagUser(
    userId: string,
    flagType: string,
    severity: string,
    description: string,
    metadata?: Record<string, unknown>,
  ) {
    const flag = await this.prisma.abuseFlag.create({
      data: { userId, flagType, severity, description, metadata: metadata as object | undefined },
    });
    this.logger.warn(`AbuseFlag created: userId=${userId} type=${flagType} severity=${severity}`);
    return flag;
  }

  // ─── Auto-escalation ───────────────────────────────────────

  async checkAndEscalate(userId: string) {
    const flags = await this.prisma.abuseFlag.findMany({
      where: { userId, isResolved: false },
      select: { severity: true },
    });

    const criticalCount = flags.filter((f) => f.severity === 'critical').length;
    const highCount = flags.filter((f) => f.severity === 'high').length;

    const shouldSuspend =
      criticalCount >= AUTO_SUSPEND_CRITICAL_FLAGS || highCount >= AUTO_SUSPEND_HIGH_FLAGS;

    if (shouldSuspend) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });

      if (user && user.status === UserStatus.ACTIVE) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { status: UserStatus.SUSPENDED },
        });

        await this.prisma.auditLog.create({
          data: {
            action: 'user.auto_suspend',
            entityType: 'User',
            entityId: userId,
            newValue: { reason: 'Auto-suspended: abuse flag threshold exceeded', criticalCount, highCount },
          },
        });

        this.logger.warn(`User ${userId} auto-suspended (critical=${criticalCount}, high=${highCount})`);
      }
    }

    // Trigger async trust score recalculation
    void this.recalculateTrustScore(userId).catch(() => null);

    return { criticalCount, highCount, suspended: shouldSuspend };
  }

  // ─── Multi-account heuristic ───────────────────────────────

  async checkForMultiAccount(userId: string, ipAddress: string) {
    const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const usersOnSameIp = await this.prisma.ipRecord.findMany({
      where: {
        ipAddress,
        action: 'register',
        createdAt: { gte: recentWindow },
        userId: { not: userId },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (usersOnSameIp.length >= 2) {
      await this.flagUser(
        userId,
        'multi_account',
        'high',
        `Registered from IP with ${usersOnSameIp.length} other accounts in 24h`,
        { ipAddress, relatedUserIds: usersOnSameIp.map((u) => u.userId) },
      );
      await this.checkAndEscalate(userId);
    }
  }

  // ─── Record IP ─────────────────────────────────────────────

  async recordIp(userId: string, ipAddress: string, action: string) {
    const isPrivate = !ipAddress || ipAddress === '127.0.0.1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.') || ipAddress.startsWith('172.');
    let geo: { country?: string; region?: string; city?: string; isp?: string } = {};

    if (!isPrivate) {
      try {
        const res = await fetch(`http://ip-api.com/json/${ipAddress}?fields=status,country,regionName,city,isp`);
        const data = await res.json() as { status: string; country?: string; regionName?: string; city?: string; isp?: string };
        if (data.status === 'success') {
          geo = {
            country: data.country,
            region: data.regionName,
            city: data.city,
            isp: data.isp,
          };
        }
      } catch {
        // ignore geo lookup failures
      }
    }

    await this.prisma.ipRecord.create({
      data: { userId, ipAddress, action, ...geo },
    }).catch(() => null); // fire-and-forget, don't block request
  }
}
