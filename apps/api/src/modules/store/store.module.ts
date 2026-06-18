import { Module, forwardRef } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [forwardRef(() => WalletModule), NotificationsModule, EventsModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
