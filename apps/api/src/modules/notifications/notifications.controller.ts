import { Controller, Get, Patch, Delete, Param, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('notifications')
@Controller({ path: 'notifications' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get notifications for current user' })
  getNotifications(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;
    const limit = limitStr ? Math.min(50, parseInt(limitStr, 10) || 20) : 20;
    return this.notificationsService.getUserNotifications(user.sub, page, limit);
  }

  @Patch('mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllRead(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.markRead(id, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a single notification' })
  deleteNotification(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.deleteNotification(id, user.sub);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all notifications' })
  clearAllNotifications(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.clearAllNotifications(user.sub);
  }
}
