import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Prisma, UserRole } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';

import { AdminService } from './admin.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ReviewCampaignDto } from './dto/review-campaign.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { GrantCreditsDto } from './dto/grant-credits.dto';
import { AdjustTrustDto } from './dto/adjust-trust.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { CreatePlatformTaskDto } from './dto/create-platform-task.dto';
import { UpdatePlatformTaskDto } from './dto/update-platform-task.dto';
import { UpdateUserDetailsDto } from './dto/update-user-details.dto';
import { SendAnnouncementDto } from './dto/send-announcement.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminTwoFactorGuard } from '../../common/guards/admin-two-factor.guard';
import { AdminPinGuard } from '../../common/guards/admin-pin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('admin')
@Controller({ path: 'admin' })
@UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard, AdminPinGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.SUPER_ADMIN)
@ApiBearerAuth('access-token')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('analytics') private readonly analyticsQueue: Queue,
    @InjectQueue('trust-score') private readonly trustScoreQueue: Queue,
  ) {}

  // ─── Overview ─────────────────────────────────────────────

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Platform overview stats' })
  getStats() {
    return this.adminService.getOverviewStats();
  }

  // ─── Users ────────────────────────────────────────────────

  @Get('users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all users (search, filter, paginate)' })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminService.listUsers(dto);
  }

  @Get('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single user with trust + flags' })
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user status (ban, suspend, activate)' })
  updateUserStatus(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(admin.sub, admin.role, id, dto);
  }

  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a user\'s role — SUPER_ADMIN only' })
  @Roles(UserRole.SUPER_ADMIN)
  changeUserRole(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChangeUserRoleDto,
  ) {
    return this.adminService.changeUserRole(admin.sub, id, dto);
  }

  @Post('users/:id/credits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant or deduct credits manually' })
  grantCredits(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: GrantCreditsDto,
  ) {
    return this.adminService.grantCredits(admin.sub, id, dto);
  }

  @Post('users/:id/trust-score')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually add or subtract trust score' })
  adjustTrustScore(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AdjustTrustDto,
  ) {
    return this.adminService.adjustTrustScore(admin.sub, id, dto);
  }

  @Patch('users/:id/details')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user details (email, username, displayName, password) — SUPER_ADMIN only' })
  @Roles(UserRole.SUPER_ADMIN)
  updateUserDetails(
    @Param('id') id: string,
    @Body() dto: UpdateUserDetailsDto,
  ) {
    return this.adminService.updateUserDetails(id, dto);
  }

  @Delete('users/:id/2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable all 2FA for a user (admin support action)' })
  disableUserTwoFactor(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.disableUserTwoFactor(admin.sub, admin.role, id);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user and all related data — SUPER_ADMIN only' })
  @Roles(UserRole.SUPER_ADMIN)
  deleteUser(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteUser(admin.sub, id);
  }

  // ─── Platform Tasks ──────────────────────────────────────

  @Get('tasks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all active platform tasks created by admins' })
  listPlatformTasks(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.adminService.listPlatformTasks(Number(page), Number(limit));
  }

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a platform task (goes live immediately as ACTIVE)' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createPlatformTask(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreatePlatformTaskDto,
  ) {
    return this.adminService.createPlatformTask(admin.sub, dto);
  }

  @Patch('tasks/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a platform task' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updatePlatformTask(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformTaskDto,
  ) {
    return this.adminService.updatePlatformTask(admin.sub, id, dto);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a platform task' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  cancelPlatformTask(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.cancelPlatformTask(admin.sub, id);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a user campaign with refund (fee retained)' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  cancelUserCampaign(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.adminService.cancelUserCampaign(admin.sub, id, body.reason);
  }

  // ─── Revenue ─────────────────────────────────────────────

  @Get('revenue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Platform revenue summary by date range' })
  @Roles(UserRole.SUPER_ADMIN)
  getRevenue(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getRevenueSummary(from, to);
  }

  // ─── Proof Submissions ───────────────────────────────────

  @Get('submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List proof submissions awaiting manual review' })
  listPendingSubmissions(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listPendingSubmissions(Number(page), Number(limit));
  }

  @Patch('submissions/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a proof submission' })
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reviewSubmission(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.adminService.reviewSubmission(admin.sub, id, dto);
  }

  // ─── Campaigns ────────────────────────────────────────────

  @Get('campaigns/pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Campaigns awaiting review' })
  listPendingCampaigns(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listPendingCampaigns(Number(page), Number(limit));
  }

  @Get('campaigns/user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active user campaigns (not platform tasks)' })
  listUserCampaigns(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listUserCampaigns(Number(page), Number(limit));
  }

  @Patch('campaigns/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a campaign' })
  reviewCampaign(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReviewCampaignDto,
  ) {
    return this.adminService.reviewCampaign(admin.sub, id, dto);
  }

  // ─── Reports ──────────────────────────────────────────────

  @Get('reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reports queue with optional status filter' })
  listOpenReports(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
  ) {
    return this.adminService.listReports(Number(page), Number(limit), status);
  }

  @Patch('reports/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve or dismiss a report' })
  resolveReport(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.adminService.resolveReport(admin.sub, id, dto);
  }

  // ─── Notifications ────────────────────────────────────────

  @Get('notifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all platform notifications (admin view)' })
  listAllNotifications(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('type') type?: string,
    @Query('userId') userId?: string,
  ) {
    return this.adminService.listAllNotifications(Number(page), Number(limit), type, userId);
  }

  @Delete('notifications/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a notification (admin)' })
  adminDeleteNotification(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteNotification(admin.sub, id);
  }

  @Delete('notifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear notifications by user (or all if no userId)' })
  adminClearNotifications(@Query('userId') userId?: string) {
    return this.adminService.clearNotifications(userId);
  }

  // ─── Audit log ────────────────────────────────────────────

  @Get('audit-log')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Full audit trail' })
  getAuditLog(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.adminService.getAuditLog(Number(page), Number(limit), action, entityType);
  }

  // ─── Finances ─────────────────────────────────────────────

  @Get('finances/stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deposit finance stats' })
  getFinanceStats() {
    return this.adminService.getFinanceStats();
  }

  @Get('finances/deposits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all deposits (admin view)' })
  listDeposits(
    @Query('page') page = 1,
    @Query('limit') limit = 25,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('userId') userId?: string,
  ) {
    return this.adminService.listDeposits(Number(page), Number(limit), status, method, userId);
  }

  @Patch('finances/deposits/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Review a deposit — approve, fail, or refund' })
  reviewDeposit(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: 'COMPLETED' | 'FAILED' | 'REFUNDED'; adminNotes?: string; paymentRef?: string },
  ) {
    return this.adminService.reviewDeposit(admin.sub, id, body);
  }

  // ─── Deposit Packages ─────────────────────────────────────

  @Get('finances/packages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all deposit packages' })
  listDepositPackages() {
    return this.adminService.listDepositPackages();
  }

  @Post('finances/packages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a deposit package' })
  createDepositPackage(
    @Body() body: { usdAmount: number; bonusCredits?: number; label?: string; isPopular?: boolean; sortOrder?: number },
  ) {
    return this.adminService.createDepositPackage(body);
  }

  @Patch('finances/packages/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a deposit package' })
  updateDepositPackage(
    @Param('id') id: string,
    @Body() body: { usdAmount?: number; bonusCredits?: number; label?: string; isPopular?: boolean; isActive?: boolean; sortOrder?: number },
  ) {
    return this.adminService.updateDepositPackage(id, body);
  }

  @Delete('finances/packages/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a deposit package' })
  deleteDepositPackage(@Param('id') id: string) {
    return this.adminService.deleteDepositPackage(id);
  }

  @Post('finances/packages/seed')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Seed default deposit packages (no-op if already exist)' })
  seedDefaultPackages() {
    return this.adminService.seedDefaultPackages();
  }

  // ─── OAuth Config (SUPER_ADMIN only) ─────────────────────

  @Get('oauth-config')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List OAuth platform credentials (SUPER_ADMIN only)' })
  getOAuthConfigs() {
    return this.adminService.getOAuthConfigs();
  }

  @Patch('oauth-config/:platform')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update OAuth credentials for a platform (SUPER_ADMIN only)' })
  updateOAuthConfig(
    @CurrentUser() admin: JwtPayload,
    @Param('platform') platform: string,
    @Body() dto: { clientId?: string; clientSecret?: string; enabled?: boolean },
  ) {
    return this.adminService.updateOAuthConfig(admin.sub, platform, dto);
  }

  // ─── Server Config (SUPER_ADMIN only) ────────────────────────

  @Get('server-config')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all platform config key-value pairs (SUPER_ADMIN only)' })
  getServerConfig() {
    return this.adminService.getServerConfig();
  }

  @Patch('server-config/:key')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a platform config value (SUPER_ADMIN only)' })
  updateServerConfig(
    @CurrentUser() admin: JwtPayload,
    @Param('key') key: string,
    @Body() body: { value: Prisma.InputJsonValue },
  ) {
    return this.adminService.updateServerConfig(admin.sub, key, body.value);
  }

  // ─── CSV Export (SUPER_ADMIN only) ───────────────────────────

  @Get('export/:table')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export a table as CSV (SUPER_ADMIN only)' })
  exportCsv(@Param('table') table: string) {
    return this.adminService.exportCsv(table);
  }

  // ─── System Operations (SUPER_ADMIN only) ────────────────────

  @Get('system/stats')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Database, upload storage and server stats (SUPER_ADMIN only)' })
  getSystemStats() {
    return this.adminService.getSystemStats();
  }

  @Delete('system/audit-logs')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all audit logs (SUPER_ADMIN only)' })
  clearAuditLogs(@CurrentUser() admin: JwtPayload) {
    return this.adminService.clearAuditLogs(admin.sub);
  }

  @Post('system/reset')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset database — wipes all data except SUPER_ADMIN accounts (SUPER_ADMIN only)' })
  resetDatabase(
    @CurrentUser() admin: JwtPayload,
    @Body() body: { confirmToken: string },
  ) {
    return this.adminService.resetDatabase(admin.sub, body.confirmToken);
  }

  // ─── Email / Communications ───────────────────────────────

  @Get('email/digest-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview your own weekly digest data (real stats)' })
  getDigestPreview(@CurrentUser() admin: JwtPayload) {
    return this.adminService.getDigestPreview(admin.sub);
  }

  @Get('email/digest-stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get weekly digest recipient statistics' })
  getDigestStats() {
    return this.adminService.getDigestStats();
  }

  @Post('email/test-digest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test weekly digest email to yourself using real stats' })
  sendTestDigest(@CurrentUser() admin: JwtPayload) {
    return this.adminService.sendTestDigest(admin.sub);
  }

  @Post('email/trigger-digest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger weekly digest for all opted-in users' })
  triggerDigest(@CurrentUser() admin: JwtPayload) {
    return this.adminService.triggerWeeklyDigest(admin.sub);
  }

  @Get('email/announcement-templates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get pre-made announcement email templates' })
  getAnnouncementTemplates() {
    return this.adminService.getAnnouncementTemplates();
  }

  @Post('email/announcement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an announcement email to selected recipients' })
  sendAnnouncement(@CurrentUser() admin: JwtPayload, @Body() dto: SendAnnouncementDto) {
    return this.adminService.sendAnnouncement(admin.sub, dto);
  }

  @Post('email/test-announcement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test announcement email to yourself' })
  sendTestAnnouncement(@CurrentUser() admin: JwtPayload, @Body() dto: SendAnnouncementDto) {
    return this.adminService.sendTestAnnouncement(admin.sub, dto);
  }

  // ─── Abuse Flags & Social Graph ───────────────────────────

  @Get('abuse/flags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all abuse flags with filtering' })
  listAbuseFlags(
    @Query('page') page = 1,
    @Query('limit') limit = 25,
    @Query('flagType') flagType?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
    @Query('userId') userId?: string,
  ) {
    return this.adminService.listAbuseFlags(Number(page), Number(limit), flagType, severity, resolved, userId);
  }

  @Post('abuse/flags/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an abuse flag' })
  resolveAbuseFlag(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() body: { resolution: string },
  ) {
    return this.adminService.resolveAbuseFlag(admin.sub, id, body.resolution);
  }

  @Get('abuse/social-graph/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get social graph for a user (shared IPs, bidirectional farming, flags, trust score)' })
  getSocialGraph(@Param('userId') userId: string) {
    return this.adminService.getSocialGraph(userId);
  }

  @Get('queues')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get BullMQ queue stats' })
  async getQueueStats() {
    const queues = [
      { name: 'email', queue: this.emailQueue },
      { name: 'analytics', queue: this.analyticsQueue },
      { name: 'trust-score', queue: this.trustScoreQueue },
    ];

    const results = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const recentFailed = await queue.getFailed(0, 10);
        const recentCompleted = await queue.getCompleted(0, 10);

        return {
          name,
          counts: { waiting, active, completed, failed, delayed },
          recentFailed: recentFailed.map((job) => ({
            id: job.id,
            name: job.name,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
          })),
          recentCompleted: recentCompleted.map((job) => ({
            id: job.id,
            name: job.name,
            attemptsMade: job.attemptsMade,
            finishedOn: job.finishedOn,
            timestamp: job.timestamp,
          })),
        };
      }),
    );

    return results;
  }
}
