import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import { ChatService } from './chat.service';
import { ChatMessageDto, ChatResponseDto } from './dto/chat.dto';
import { UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('chat')
@Controller({ path: 'chat' })
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @Public()
  @UserRateLimit({ limit: 20, ttl: 60, scope: 'chat' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message to the AI chat support' })
  async sendMessage(
    @Body() dto: ChatMessageDto,
    @CurrentUser() user: JwtPayload | null,
    @Req() req: Request,
  ): Promise<ChatResponseDto> {
    const userId = user?.sub || null;
    const ipAddress = this.getClientIp(req);
    return this.chatService.sendMessage(userId, ipAddress, dto);
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || req.connection.remoteAddress || 'unknown';
  }

  // Admin endpoints
  @Get('admin/list')
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'List all conversations (admin only)' })
  async listChats(@CurrentUser() user: JwtPayload) {
    const conversations = await this.chatService.listConversations(user.sub);
    return conversations;
  }

  @Get('admin/:id')
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get conversation details (admin only)' })
  async getConversation(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chatService.getConversation(id, user.sub);
  }

  @Post('admin/:id/send')
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message as admin (admin only)' })
  async sendAdminMessage(
    @Param('id') id: string,
    @Body() dto: { message: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.sendAdminMessage(id, user.sub, dto.message);
  }

  @Patch('admin/:id/transfer')
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer conversation to human (admin only)' })
  async transferToHuman(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chatService.transferToHuman(id, user.sub);
  }
}
