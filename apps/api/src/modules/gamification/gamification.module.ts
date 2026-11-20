import { Module, forwardRef } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { StoreModule } from '../store/store.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { ActivityRewardService } from './activity-reward.service';
import { ToursController } from './tours.controller';
import { ToursService } from './tours.service';

@Module({
  imports: [forwardRef(() => WalletModule), NotificationsModule, EventsModule, forwardRef(() => StoreModule), forwardRef(() => ReferralsModule)],
  controllers: [GamificationController, ToursController],
  providers: [GamificationService, ActivityRewardService, ToursService],
  exports: [GamificationService, ActivityRewardService, ToursService],
})
export class GamificationModule {}
