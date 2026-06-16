import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'referrals' })
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my referral stats and invited users' })
  getMyReferrals(@CurrentUser() user: JwtPayload) {
    return this.referralsService.getMyReferrals(user.sub);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Referral leaderboard by period' })
  @ApiQuery({ name: 'period', enum: ['alltime', 'monthly', 'weekly', 'daily'], required: false })
  getLeaderboard(
    @Query('period') period: 'alltime' | 'monthly' | 'weekly' | 'daily' = 'alltime',
  ) {
    return this.referralsService.getLeaderboard(period, 50);
  }
}
