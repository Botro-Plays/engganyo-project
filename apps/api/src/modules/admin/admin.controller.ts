import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { AdminService } from './admin.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ReviewCampaignDto } from './dto/review-campaign.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { GrantCreditsDto } from './dto/grant-credits.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { CreatePlatformTaskDto } from './dto/create-platform-task.dto';
import { UpdatePlatformTaskDto } from './dto/update-platform-task.dto';
import { UpdateUserDetailsDto } from './dto/update-user-details.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('admin')
@Controller({ path: 'admin' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.SUPER_ADMIN)
@ApiBearerAuth('access-token')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
  @ApiOperation({ summary: 'Open reports queue' })
  listOpenReports(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listOpenReports(Number(page), Number(limit));
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
}
