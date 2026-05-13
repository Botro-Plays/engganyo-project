import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform overview stats — admin only' })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30 })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  getOverview(@Query('days') days?: string) {
    return this.analytics.getOverview(days ? Number(days) : 30);
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Per-campaign funnel — owner or admin' })
  getCampaignFunnel(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analytics.getCampaignFunnel(id, user.sub, user.role);
  }

  @Get('users/me/stats')
  @ApiOperation({ summary: 'Personal stats dashboard' })
  getMyStats(@CurrentUser() user: JwtPayload) {
    return this.analytics.getMyStats(user.sub);
  }
}
