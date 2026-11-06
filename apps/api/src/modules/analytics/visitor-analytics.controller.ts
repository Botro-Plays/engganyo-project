import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRateLimit, UserRateLimitGuard } from '../../common/guards/user-rate-limit.guard';
import { VisitorBeaconDto } from './dto/visitor-beacon.dto';
import { VisitorAnalyticsService, TrafficDimension } from './visitor-analytics.service';
import { UserRole } from '@prisma/client';

const ADMIN_TRAFFIC_ROLES = [UserRole.ADMIN, UserRole.MODERATOR, UserRole.SUPER_ADMIN];

@ApiTags('analytics')
@Controller('analytics')
export class VisitorAnalyticsController {
  constructor(private readonly visitorAnalytics: VisitorAnalyticsService) {}

  // First-party beacon — public, IP-rate-limited. Tracking failures must
  // never interrupt navigation, so the client treats this as fire-and-forget.
  @Public()
  @Post('visit')
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 60, ttl: 60, scope: 'visitor_beacon' })
  @ApiOperation({ summary: 'Record a page-view beacon (anonymous, first-party)' })
  ingestBeacon(@Body() dto: VisitorBeaconDto, @Req() req: Request) {
    // IP comes from the trusted proxy chain (trust proxy=1 + nginx realip).
    // Country comes ONLY from the nginx-set X-Visitor-Country header, which
    // is populated solely when the direct peer is a Cloudflare IP — a
    // browser-supplied value can never reach this header.
    const country = req.headers['x-visitor-country'];
    return this.visitorAnalytics.ingestBeacon(dto, {
      ip: req.ip ?? req.socket?.remoteAddress ?? '',
      country: typeof country === 'string' ? country : null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('traffic/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_TRAFFIC_ROLES)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Visitor traffic overview — visits, uniques, page views, daily trend' })
  getOverview(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeBots') includeBots?: string,
  ) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 864e5);
    return this.visitorAnalytics.getOverview({
      from: fromDate,
      to: toDate,
      includeBots: includeBots === 'true',
    });
  }

  @Get('traffic/breakdown')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_TRAFFIC_ROLES)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Sortable paginated breakdown by route, country, referrer, or device' })
  getBreakdown(
    @Query('dimension') dimension: TrafficDimension,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeBots') includeBots?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    if (!['route', 'country', 'referrer', 'device'].includes(dimension)) {
      throw new BadRequestException('dimension must be one of: route, country, referrer, device');
    }
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 864e5);
    return this.visitorAnalytics.getBreakdown(dimension, {
      from: fromDate,
      to: toDate,
      includeBots: includeBots === 'true',
      sort,
      order: order === 'asc' ? 'asc' : 'desc',
      page: page ? Number(page) : 1,
      size: size ? Number(size) : 20,
    });
  }

  // IP-level drill-down — SUPER_ADMIN only. Lower admin roles must not be
  // able to retrieve raw IPs through any endpoint.
  @Get('traffic/recent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Recent raw beacon events with IP — SUPER_ADMIN only' })
  getRecent(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('includeBots') includeBots?: string,
  ) {
    return this.visitorAnalytics.getRecentEvents({
      page: page ? Number(page) : 1,
      size: size ? Number(size) : 25,
      includeBots: includeBots === 'true',
    });
  }
}
