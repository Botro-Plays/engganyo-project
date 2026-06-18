import { Module, forwardRef } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { StoreModule } from '../store/store.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

@Module({
  imports: [forwardRef(() => WalletModule), NotificationsModule, EventsModule, forwardRef(() => StoreModule)],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
