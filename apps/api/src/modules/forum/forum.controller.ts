import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import { ForumService } from './forum.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';
import { CreateReactionDto } from './dto/create-reaction.dto';
import { ListTopicsDto } from './dto/list-topics.dto';

@ApiTags('forum')
@Controller('forum')
export class ForumController {
  constructor(private readonly forumService: ForumService) {}

  // ─── Public Endpoints ──────────────────────────────────────

  @Get('topics')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List forum topics' })
  listTopics(@Query() dto: ListTopicsDto, @CurrentUser() user: JwtPayload) {
    return this.forumService.listTopics(dto, user.role);
  }

  @Get('admin/topics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all forum topics (admin only)' })
  listAdminTopics(@Query() dto: ListTopicsDto) {
    return this.forumService.listTopics(dto, 'ADMIN');
  }

  @Get('topics/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get forum topic with replies' })
  getTopic(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.forumService.getTopic(id, user.role);
  }

  @Get('topics/:id/replies')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get topic replies' })
  getReplies(
    @Param('id') topicId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.forumService.getReplies(topicId, Number(page), Number(limit), user.role);
  }

  // ─── Authenticated Endpoints ───────────────────────────────

  @Post('topics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create forum topic' })
  createTopic(@CurrentUser() user: JwtPayload, @Body() dto: CreateTopicDto) {
    return this.forumService.createTopic(user.sub, dto);
  }

  @Patch('topics/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update forum topic' })
  updateTopic(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateTopicDto) {
    return this.forumService.updateTopic(id, user.sub, dto);
  }

  @Delete('topics/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete forum topic' })
  deleteTopic(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.forumService.deleteTopic(id, user.sub, user.role);
  }

  @Post('topics/:id/replies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create reply to topic' })
  createReply(@CurrentUser() user: JwtPayload, @Param('id') topicId: string, @Body() dto: CreateReplyDto) {
    return this.forumService.createReply(topicId, user.sub, user.role, dto);
  }

  @Patch('replies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update reply' })
  updateReply(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateReplyDto) {
    return this.forumService.updateReply(id, user.sub, dto);
  }

  @Delete('replies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete reply' })
  deleteReply(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.forumService.deleteReply(id, user.sub, user.role);
  }

  @Post('topics/:id/reactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'React to topic' })
  createTopicReaction(@CurrentUser() user: JwtPayload, @Param('id') topicId: string, @Body() dto: CreateReactionDto) {
    return this.forumService.createReaction(topicId, null, user.sub, dto);
  }

  @Post('replies/:id/reactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'React to reply' })
  createReplyReaction(@CurrentUser() user: JwtPayload, @Param('id') replyId: string, @Body() dto: CreateReactionDto) {
    return this.forumService.createReaction(null, replyId, user.sub, dto);
  }

  @Delete('reactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove reaction' })
  deleteReaction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.forumService.deleteReaction(id, user.sub);
  }

  // ─── Admin Endpoints ───────────────────────────────────────

  @Patch('admin/topics/:id/lock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock forum topic (admin only)' })
  lockTopic(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.lockTopic(id, admin.sub);
  }

  @Patch('admin/topics/:id/pin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pin/unpin forum topic (admin only)' })
  pinTopic(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.pinTopic(id, admin.sub);
  }

  @Patch('admin/topics/:id/hide')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide forum topic (admin only)' })
  hideTopic(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.hideTopic(id, admin.sub);
  }

  @Patch('admin/topics/:id/unhide')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unhide forum topic (admin only)' })
  unhideTopic(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.unhideTopic(id, admin.sub);
  }

  @Delete('admin/topics/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete forum topic (admin only)' })
  adminDeleteTopic(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.adminDeleteTopic(id, admin.sub);
  }

  @Delete('admin/replies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR', 'SUPER_ADMIN')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete forum reply (admin only)' })
  adminDeleteReply(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.forumService.adminDeleteReply(id, admin.sub);
  }
}
