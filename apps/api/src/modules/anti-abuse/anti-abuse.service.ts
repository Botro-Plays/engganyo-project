import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ReportReason, TrustLevel, UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

  // ─── Trust score ───────────────────────────────────────────

  async getTrustScore(userId: string) {
    let trust = await this.prisma.trustScore.findUnique({ where: { userId } });
    if (!trust) {
      trust = await this.recalculateTrustScore(userId);
    }
    return trust;
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

    const verifiedSocials = user.socialAccounts.filter((s) => s.isVerified).length;

    const totalTasks = user.completions.length;
    const verifiedTasks = user.completions.filter((c) => c.status === 'VERIFIED').length;
    const completionRate = totalTasks > 0 ? verifiedTasks / totalTasks : 0;

    const criticalFlags = user.abuseFlags.filter((f) => f.severity === 'critical').length;
    const highFlags = user.abuseFlags.filter((f) => f.severity === 'high').length;
    const totalBadFlags = criticalFlags * 3 + highFlags;
    const reportCount = user._count.reportsReceived;

    // Score calculation
    const completionPts = completionRate * 40;
    const agePts = Math.min(accountAgeDays / 365, 1) * 20;
    const socialPts = Math.min(verifiedSocials * 5, 25);
    const flagPts = Math.max(0, (1 - Math.min(totalBadFlags / 5, 1)) * 15);
    const reportPenalty = Math.min(reportCount / 10, 1) * 10;

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
    return trust;
  }

  // ─── Reports ───────────────────────────────────────────────

  async submitReport(submittedById: string, dto: CreateReportDto) {
    if (!dto.targetUserId && !dto.campaignId) {
      throw new BadRequestException('Must provide targetUserId or campaignId');
    }
    if (dto.targetUserId && dto.targetUserId === submittedById) {
      throw new BadRequestException('Cannot report yourself');
    }

    const report = await this.prisma.report.create({
      data: {
        submittedById,
        targetUserId: dto.targetUserId,
        campaignId: dto.campaignId,
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
    await this.prisma.ipRecord.create({
      data: { userId, ipAddress, action },
    }).catch(() => null); // fire-and-forget, don't block request
  }
}
