import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { RoomsService } from './rooms.service';
import {
  CreateRoomDto, JoinRoomDto, RoomPasswordDto, UpsertOfferDto,
  ApproveRoomDto, SubmitProofDto, ReviewSubmissionDto, DisputeRoomDto,
  NudgeRoomDto, RateRoomDto, ReportRoomDto,
} from './dto/rooms.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRateLimitGuard, UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const clientIp = (req: Request) => req.ip ?? req.socket?.remoteAddress ?? '';

@ApiTags('rooms')
@Controller({ path: 'rooms' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contribution quote and room defaults (pre-publish review)' })
  quote(@Query('contribution') contribution?: string) {
    return this.roomsService.quote(contribution ? Number(contribution) : undefined);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publish a mutual P2P room (reserves creator contribution)' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(user.sub, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List open public rooms (marketplace)' })
  list(@CurrentUser() user: JwtPayload, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.roomsService.listPublic(user.sub, page ? Number(page) : 1, limit ? Number(limit) : 12);
  }

  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the current user's rooms + active-room pointer" })
  mine(@CurrentUser() user: JwtPayload, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.roomsService.listMine(user.sub, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }

  @Get('leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'P2P completion-points leaderboard (separate from wallet credits)' })
  leaderboard(@Query('type') type?: string, @Query('page') page?: string) {
    return this.roomsService.getP2pLeaderboard(
      type === 'weekly' ? 'weekly' : 'alltime',
      page ? Number(page) : 1,
    );
  }

  @Get('ratings/:username')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public room-rating average and count for a user' })
  ratings(@Param('username') username: string) {
    return this.roomsService.getPublicRoomRatings(username);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Room detail (public open, or participant-only)' })
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.roomsService.getOne(user.sub, id);
  }

  @Get(':id/state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Participant workspace state: offers, submissions, approvals, timer, nudges' })
  getState(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.roomsService.getState(user.sub, id);
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Minimal probe for a private room share link' })
  preview(@Param('id') id: string) {
    return this.roomsService.getPrivatePreview(id);
  }

  @Post(':id/access')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'room_password' })
  @ApiOperation({ summary: 'Verify private room password and return details' })
  access(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RoomPasswordDto,
    @Req() req: Request,
  ) {
    return this.roomsService.verifyAccess(user.sub, id, dto, clientIp(req));
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'room_join' })
  @ApiOperation({ summary: 'Join a room: atomic claim, starts the shared deadline, reserves contribution' })
  join(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: JoinRoomDto,
    @Req() req: Request,
  ) {
    return this.roomsService.join(user.sub, id, dto, clientIp(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open/negotiating room and refund contributions' })
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.roomsService.cancel(user.sub, id);
  }

  @Put(':id/offers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or edit your offer (bumps version, invalidates both approvals)' })
  upsertOffer(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpsertOfferDto) {
    return this.roomsService.upsertOffer(user.sub, id, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve current offer versions — dual approval transitions to AGREED and collects 2X once' })
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ApproveRoomDto) {
    return this.roomsService.approve(user.sub, id, dto);
  }

  @Post(':id/offers/:offerId/submit-proof')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit proof for work the counterparty requested (performer only)' })
  submitProof(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.roomsService.submitProof(user.sub, id, offerId, dto);
  }

  @Post(':id/submissions/:submissionId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Peer review: approve / reject / dispute a proof submission' })
  reviewSubmission(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: ReviewSubmissionDto,
  ) {
    return this.roomsService.reviewSubmission(user.sub, submissionId, dto);
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a room dispute (freezes actions; deadline still applies)' })
  dispute(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: DisputeRoomDto) {
    return this.roomsService.dispute(user.sub, id, dto);
  }

  @Post(':id/nudge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 20, ttl: 60, scope: 'room_nudge' })
  @ApiOperation({ summary: 'Ping the other player (60s cooldown, daily/room caps, pingId dedupe)' })
  nudge(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: NudgeRoomDto) {
    return this.roomsService.nudge(user.sub, id, dto);
  }

  @Post(':id/rate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Rate your partner 1-5 after completion (one rating per room)' })
  rate(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RateRoomDto) {
    return this.roomsService.rate(user.sub, id, dto);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report the other participant with room-scoped evidence' })
  report(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReportRoomDto) {
    return this.roomsService.reportUser(user.sub, id, dto);
  }
}
