import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRateLimitGuard, UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChannelsService } from './channels.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JoinChannelDto } from './dto/join-channel.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { SendTipDto } from './dto/tip.dto';

@ApiTags('Channels')
@Controller('channels')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List available channels for current user' })
  getChannels(@CurrentUser() user: JwtPayload) {
    return this.channelsService.getChannels(user.sub, user.role);
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get channel by slug' })
  getChannelBySlug(@CurrentUser() user: JwtPayload, @Param('slug') slug: string) {
    return this.channelsService.getChannelBySlug(user.sub, slug, user.role);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 3, ttl: 3600, scope: 'chat_join' })
  @ApiOperation({ summary: 'Join a channel' })
  joinChannel(@CurrentUser() user: JwtPayload, @Body() dto: JoinChannelDto) {
    return this.channelsService.joinChannel(user.sub, dto.channelId, user.role);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a channel' })
  leaveChannel(@CurrentUser() user: JwtPayload, @Body() dto: JoinChannelDto) {
    return this.channelsService.leaveChannel(user.sub, dto.channelId);
  }

  @Get(':channelId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get messages for a channel' })
  getMessages(
    @CurrentUser() user: JwtPayload,
    @Param('channelId') channelId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.channelsService.getMessages(channelId, user.sub, {
      before: before ? new Date(before) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'chat_message' })
  @ApiOperation({ summary: 'Send a message to a channel' })
  sendMessage(@CurrentUser() user: JwtPayload, @Body() dto: SendMessageDto) {
    return this.channelsService.sendMessage(user.sub, dto.channelId, dto.content, user.role);
  }

  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a message (author or admin)' })
  deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('messageId') messageId: string,
  ) {
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'MODERATOR';
    return this.channelsService.deleteMessage(user.sub, messageId, isAdmin);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new channel (VIP Gold+)' })
  createChannel(@CurrentUser() user: JwtPayload, @Body() dto: CreateChannelDto) {
    return this.channelsService.createChannel(user.sub, dto);
  }

  @Post('tips')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 5, ttl: 60, scope: 'chat_tip' })
  @ApiOperation({ summary: 'Send credits tip to another user' })
  sendTip(@CurrentUser() user: JwtPayload, @Body() dto: SendTipDto) {
    return this.channelsService.sendTip(user.sub, dto.toUserId, dto.amount, dto.messageId);
  }

  @Get('users/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search users by username for @mentions' })
  searchUsersForMentions(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    return this.channelsService.searchUsersForMentions(query, limit ? parseInt(limit, 10) : 5);
  }
}
