import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { ChallengesService } from './challenges.service';
import {
  CreateChallengeDto,
  ClaimChallengeDto,
  ChallengePasswordDto,
  ReviewChallengeDto,
} from './dto/challenge.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRateLimitGuard, UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const clientIp = (req: Request) => req.ip ?? req.socket?.remoteAddress ?? '';

@ApiTags('challenges')
@Controller({ path: 'challenges' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and publish a 1v1 challenge (reserves reward + fee)' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateChallengeDto) {
    return this.challengesService.create(user.sub, user.role, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List open public challenges' })
  list(@CurrentUser() user: JwtPayload, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.challengesService.listPublic(user.sub, page ? Number(page) : 1, limit ? Number(limit) : 12);
  }

  @Get('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fee and reserve quote for a reward amount (pre-publish review)' })
  quote(@Query('reward') reward?: string) {
    return this.challengesService.quote(reward ? Number(reward) : 0);
  }

  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the current user's challenges (creator view)" })
  listMine(@CurrentUser() user: JwtPayload, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.challengesService.listMine(user.sub, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get challenge detail (public open, or participant)' })
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.challengesService.getOne(user.sub, id);
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Minimal probe for a private challenge share link' })
  preview(@Param('id') id: string) {
    return this.challengesService.getPrivatePreview(id);
  }

  @Post(':id/access')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'challenge_password' })
  @ApiOperation({ summary: 'Verify private challenge password and return details' })
  access(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChallengePasswordDto,
    @Req() req: Request,
  ) {
    return this.challengesService.verifyAccess(user.sub, id, dto, clientIp(req));
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'challenge_claim' })
  @ApiOperation({ summary: 'Claim the single slot of a challenge (first eligible wins)' })
  claim(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ClaimChallengeDto,
    @Req() req: Request,
  ) {
    return this.challengesService.claim(user.sub, id, dto, clientIp(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open (unclaimed) challenge and refund the reserve' })
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.challengesService.cancel(user.sub, id);
  }

  @Get(':id/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator: list pending proof submissions for a challenge' })
  getSubmissions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.challengesService.getSubmissions(
      user.sub,
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Patch(':id/submissions/:completionId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator: approve or reject a challenge proof submission' })
  reviewSubmission(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('completionId') completionId: string,
    @Body() dto: ReviewChallengeDto,
  ) {
    return this.challengesService.reviewSubmission(user.sub, id, completionId, dto);
  }
}
