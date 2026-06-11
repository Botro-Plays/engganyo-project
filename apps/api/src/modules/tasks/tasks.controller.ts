import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { TasksService } from './tasks.service';
import { ListTasksDto, ListMyTasksDto } from './dto/list-tasks.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRateLimitGuard, UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('tasks')
@Controller({ path: 'tasks' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Browse available tasks (excludes own campaigns + already assigned)' })
  browse(@CurrentUser() user: JwtPayload, @Query() dto: ListTasksDto) {
    return this.tasksService.browseTasks(user.sub, dto);
  }

  @Get('my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my assigned and completed tasks' })
  getMyTasks(@CurrentUser() user: JwtPayload, @Query() dto: ListMyTasksDto) {
    return this.tasksService.getMyTasks(user.sub, dto);
  }

  @Post(':campaignId/assign')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 10, ttl: 60, scope: 'task_assign' })
  @ApiOperation({ summary: 'Claim a task slot from a campaign' })
  assign(
    @CurrentUser() user: JwtPayload,
    @Param('campaignId') campaignId: string,
    @Ip() clientIp?: string,
  ) {
    return this.tasksService.assignTask(user.sub, campaignId, user.role, clientIp);
  }

  @Post(':campaignId/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 20, ttl: 60, scope: 'task_submit' })
  @ApiOperation({ summary: 'Submit proof for an assigned task (auto-verifies in Phase 5)' })
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('campaignId') campaignId: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.tasksService.submitProof(user.sub, campaignId, dto);
  }

  @Post(':campaignId/recheck')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 30, ttl: 60, scope: 'task_recheck' })
  @ApiOperation({ summary: 'Recheck task verification via platform API (for YouTube subscribe tasks)' })
  recheck(@CurrentUser() user: JwtPayload, @Param('campaignId') campaignId: string) {
    return this.tasksService.recheckTask(user.sub, campaignId);
  }
}
