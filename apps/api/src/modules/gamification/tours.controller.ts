import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ToursService } from './tours.service';

class TourVersionDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;
}

@ApiTags('tours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gamification/tours')
export class ToursController {
  constructor(private readonly toursService: ToursService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Milestone tours due for this user (level-gated, uncompleted)' })
  pending(@CurrentUser() user: JwtPayload) {
    return this.toursService.getPendingTours(user.sub);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Full milestone tour catalog with per-user state (replay UI)' })
  catalog(@CurrentUser() user: JwtPayload) {
    return this.toursService.getCatalog(user.sub);
  }

  @Post(':key/complete')
  @ApiOperation({ summary: 'Mark a milestone tour completed for this version' })
  complete(@CurrentUser() user: JwtPayload, @Param('key') key: string, @Body() dto: TourVersionDto) {
    return this.toursService.complete(user.sub, key, dto.version ?? 0);
  }

  @Post(':key/dismiss')
  @ApiOperation({ summary: 'Dismiss a milestone tour for this version' })
  dismiss(@CurrentUser() user: JwtPayload, @Param('key') key: string, @Body() dto: TourVersionDto) {
    return this.toursService.dismiss(user.sub, key, dto.version ?? 0);
  }

  @Delete(':key/state')
  @ApiOperation({ summary: 'Clear completion state so the tour can be replayed' })
  reset(@CurrentUser() user: JwtPayload, @Param('key') key: string) {
    return this.toursService.resetForReplay(user.sub, key);
  }
}
