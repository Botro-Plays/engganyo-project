import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { GamificationService } from './gamification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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

  @Get('leaderboard/achievements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get public leaderboard by achievements unlocked' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  getAchievementLeaderboard(@Query('page') page = 1) {
    return this.gamificationService.getAchievementLeaderboard(Number(page), 50);
  }

  @Get('leaderboard/missions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get public leaderboard by missions completed' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  getMissionLeaderboard(@Query('page') page = 1) {
    return this.gamificationService.getMissionLeaderboard(Number(page), 50);
  }

  @Get('leaderboard/vip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get public VIP leaderboard ordered by tier then points' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  getVipLeaderboard(@Query('page') page = 1) {
    return this.gamificationService.getVipLeaderboard(Number(page), 50);
  }

  @Get('vip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current VIP tier, next tier, and progress' })
  getVipStatus(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getVipStatus(user.sub);
  }

  // ─── Admin: Achievements ─────────────────────────────────

  @Get('admin/achievements')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] List all achievements' })
  adminListAchievements() {
    return this.gamificationService.adminListAchievements();
  }

  @Post('admin/achievements')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Admin] Create a new achievement' })
  adminCreateAchievement(@Body() body: Record<string, unknown>) {
    return this.gamificationService.adminCreateAchievement(body);
  }

  @Patch('admin/achievements/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Update an achievement' })
  adminUpdateAchievement(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.gamificationService.adminUpdateAchievement(id, body);
  }

  @Delete('admin/achievements/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Delete an achievement' })
  adminDeleteAchievement(@Param('id') id: string) {
    return this.gamificationService.adminDeleteAchievement(id);
  }

  // ─── Admin: Missions ─────────────────────────────────────

  @Get('admin/missions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] List all daily missions' })
  adminListMissions() {
    return this.gamificationService.adminListMissions();
  }

  @Post('admin/missions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Admin] Create a new daily mission' })
  adminCreateMission(@Body() body: Record<string, unknown>) {
    return this.gamificationService.adminCreateMission(body);
  }

  @Patch('admin/missions/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Update a daily mission' })
  adminUpdateMission(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.gamificationService.adminUpdateMission(id, body);
  }

  @Delete('admin/missions/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Delete a daily mission' })
  adminDeleteMission(@Param('id') id: string) {
    return this.gamificationService.adminDeleteMission(id);
  }

  @Post('daily-reward')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim daily login reward (credits + XP + streak update)' })
  claimDailyReward(
    @CurrentUser() user: JwtPayload,
    @Headers('x-timezone') timezone: string | undefined,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
    return this.gamificationService.claimDailyReward(user.sub, timezone, ip);
  }

  // ─── Sprint 3: Spin Wheel ─────────────────────────────────

  @Get('wheel/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get wheel spin status (free spin available, paid spins remaining)' })
  getWheelSpinStatus(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getWheelSpinStatus(user.sub);
  }

  @Post('wheel/spin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Spin the wheel (free once/day, 20 credits after)' })
  spinWheel(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.spinWheel(user.sub);
  }

  @Get('daily-reward-log')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get daily reward history for streak calendar' })
  @ApiQuery({ name: 'days', type: Number, required: false })
  getDailyRewardLog(
    @CurrentUser() user: JwtPayload,
    @Query('days') days?: string,
  ) {
    return this.gamificationService.getDailyRewardLog(user.sub, days ? Number(days) : 30);
  }
}
