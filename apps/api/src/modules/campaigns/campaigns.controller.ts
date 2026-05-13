import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('campaigns')
@Controller({ path: 'campaigns', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new campaign (deducts credits upfront)' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(user.sub, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List own campaigns' })
  listMy(@CurrentUser() user: JwtPayload, @Query() dto: ListCampaignsDto) {
    return this.campaignsService.listMyCampaigns(user.sub, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single campaign (must be owner)' })
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.campaignsService.getOne(user.sub, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause, resume, or edit a campaign' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a campaign and refund unspent credits' })
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.campaignsService.cancel(user.sub, id);
  }

  @Get(':id/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator: list pending proof submissions for their campaign' })
  getSubmissions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.campaignsService.getMySubmissions(
      user.sub,
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Patch(':id/submissions/:completionId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Creator: approve or reject a proof submission' })
  reviewSubmission(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('completionId') completionId: string,
    @Body() dto: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.campaignsService.reviewSubmission(user.sub, id, completionId, dto);
  }
}
