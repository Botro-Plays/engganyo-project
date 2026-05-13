import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserRateLimitGuard } from '../../common/guards/user-rate-limit.guard';

import { WalletModule } from '../wallet/wallet.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { SocialAuthModule } from '../social-auth/social-auth.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DatabaseModule, WalletModule, CampaignsModule, GamificationModule, AntiAbuseModule, SocialAuthModule],
  controllers: [TasksController],
  providers: [TasksService, UserRateLimitGuard],
  exports: [TasksService],
})
export class TasksModule {}
