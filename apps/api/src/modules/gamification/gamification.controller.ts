import { Controller, Get, Post, Query, UseGuards, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { GamificationService } from './gamification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('gamification')
@Controller({ path: 'gamification' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my XP, level, streak, and progress stats' })
  getMyStats(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getMyStats(user.sub);
  }

  @Get('achievements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all achievements with unlock status' })
  getAchievements(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getAchievements(user.sub);
  }

  @Get('missions/daily')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get today's missions and my progress" })
  getDailyMissions(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getDailyMissions(user.sub);
  }

  @Get('streak')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my current streak info' })
  getStreak(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getStreak(user.sub);
  }

  @Get('leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get leaderboard (alltime or weekly)' })
  @ApiQuery({ name: 'type', enum: ['alltime', 'weekly'], required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  getLeaderboard(
    @Query('type') type: 'alltime' | 'weekly' = 'alltime',
    @Query('page') page = 1,
  ) {
    return this.gamificationService.getLeaderboard(type, Number(page), 50);
  }

  @Post('daily-reward')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim daily login reward (credits + XP + streak update)' })
  claimDailyReward(
    @CurrentUser() user: JwtPayload,
    @Headers('x-timezone') timezone?: string,
  ) {
    return this.gamificationService.claimDailyReward(user.sub, timezone);
  }
}
