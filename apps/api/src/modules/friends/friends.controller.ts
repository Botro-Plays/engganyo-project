import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

class FriendRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

@ApiTags('friends')
@Controller({ path: 'friends' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a friend request (mutual consent; auto-accepts a pending reverse request)' })
  request(@CurrentUser() user: JwtPayload, @Body() dto: FriendRequestDto) {
    return this.friendsService.request(user.sub, dto.userId);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a friend request' })
  accept(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.friendsService.respond(user.sub, id, true);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a friend request' })
  decline(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.friendsService.respond(user.sub, id, false);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a request or remove a friendship' })
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.friendsService.cancel(user.sub, id);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List accepted friends' })
  list(@CurrentUser() user: JwtPayload) {
    return this.friendsService.list(user.sub);
  }

  @Get('requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Incoming and outgoing pending friend requests' })
  requests(@CurrentUser() user: JwtPayload) {
    return this.friendsService.listRequests(user.sub);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Friendship status with another user' })
  status(@CurrentUser() user: JwtPayload, @Query('userId') targetUserId: string) {
    return this.friendsService.status(user.sub, targetUserId);
  }
}
