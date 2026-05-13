import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CampaignStatus, ReportStatus, TransactionType, UserRole, UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import type { ListUsersDto } from './dto/list-users.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { ReviewCampaignDto } from './dto/review-campaign.dto';
import type { ResolveReportDto } from './dto/resolve-report.dto';
import type { GrantCreditsDto } from './dto/grant-credits.dto';
import type { ChangeUserRoleDto } from './dto/change-user-role.dto';

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
