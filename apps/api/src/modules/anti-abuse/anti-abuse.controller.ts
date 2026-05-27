import {
  Controller, Get, Post, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { AntiAbuseService } from './anti-abuse.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('anti-abuse')
@Controller('anti-abuse')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class AntiAbuseController {
  constructor(private readonly antiAbuseService: AntiAbuseService) {}

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a report against a user or campaign' })
  submitReport(@CurrentUser() user: JwtPayload, @Body() dto: CreateReportDto) {
    return this.antiAbuseService.submitReport(user.sub, dto);
  }

  @Get('reports/my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List my submitted reports' })
  getMyReports(
    @CurrentUser() user: JwtPayload,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.antiAbuseService.getMyReports(user.sub, Number(page), Number(limit));
  }

  @Get('trust/me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my trust score (recalculates if stale)' })
  getMyTrust(@CurrentUser() user: JwtPayload) {
    return this.antiAbuseService.getTrustScore(user.sub);
  }
}
