import {
  Controller, Get, Post, Patch, Body, Param, Query,
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
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
    return this.adminService.updateUserStatus(admin.sub, id, dto);
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
}
