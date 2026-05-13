import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [WalletModule, CampaignsModule, GamificationModule, AntiAbuseModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
