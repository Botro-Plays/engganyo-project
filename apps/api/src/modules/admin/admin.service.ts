import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CampaignStatus, CompletionStatus, ReportStatus, TransactionType, UserRole, UserStatus } from '@prisma/client';
import type { CreatePlatformTaskDto } from './dto/create-platform-task.dto';
import type { UpdatePlatformTaskDto } from './dto/update-platform-task.dto';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { ListUsersDto } from './dto/list-users.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { ReviewCampaignDto } from './dto/review-campaign.dto';
import type { ResolveReportDto } from './dto/resolve-report.dto';
import type { GrantCreditsDto } from './dto/grant-credits.dto';
import type { ChangeUserRoleDto } from './dto/change-user-role.dto';
import type { UpdateUserDetailsDto } from './dto/update-user-details.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
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
          _count: { select: { completions: true, campaigns: true, abuseFlags: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
      select: { id: true, title: true, status: true },
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

    return updated;
  }

  // ─── Reports ──────────────────────────────────────────────

  async listOpenReports(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { status: ReportStatus.OPEN };

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        select: {
          id: true, reason: true, description: true, status: true, createdAt: true,
          submittedBy: { select: { username: true } },
          targetUser: { select: { id: true, username: true } },
          campaign: { select: { id: true, title: true } },
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
      select: { status: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN && report.status !== ReportStatus.UNDER_REVIEW) {
      throw new BadRequestException('Report is already resolved');
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
        newValue: { status: dto.status, notes: dto.notes },
      },
    });

    return updated;
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

    return this.OAUTH_PLATFORMS.map((platform) => {
      const cfg = configMap.get(platform as never);
      return {
        platform,
        clientId: cfg?.clientId ?? null,
        clientSecretSet: !!cfg?.clientSecret,   // never expose the secret itself
        enabled: cfg?.enabled ?? false,
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
    if (!this.OAUTH_PLATFORMS.includes(p)) {
      throw new BadRequestException(`${platform} does not support OAuth configuration`);
    }

    const data: {
      clientId?: string;
      clientSecret?: string;
      enabled?: boolean;
      updatedById: string;
    } = { updatedById: adminId };

    if (dto.clientId !== undefined)     data.clientId     = dto.clientId;
    if (dto.clientSecret !== undefined) data.clientSecret = dto.clientSecret;
    if (dto.enabled !== undefined)      data.enabled      = dto.enabled;

    await this.prisma.oAuthConfig.upsert({
      where: { platform: p },
      create: { platform: p, ...data },
      update: data,
    });

    return { updated: true, platform };
  }

  // ─── Overview stats ───────────────────────────────────────

  async getOverviewStats() {
    const [
      totalUsers, activeUsers, suspendedUsers,
      totalCampaigns, pendingCampaigns,
      openReports,
      totalTasks,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.campaign.count(),
      this.prisma.campaign.count({ where: { status: CampaignStatus.PENDING_REVIEW } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
      this.prisma.taskCompletion.count({ where: { status: 'VERIFIED' } }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers },
      campaigns: { total: totalCampaigns, pending: pendingCampaigns },
      reports: { open: openReports },
      tasks: { verified: totalTasks },
    };
  }
}
