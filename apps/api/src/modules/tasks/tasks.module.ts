import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [WalletModule, CampaignsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
