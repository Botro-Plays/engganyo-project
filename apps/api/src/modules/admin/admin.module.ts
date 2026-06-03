import { Module, forwardRef } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { PayMongoModule } from '../paymongo/paymongo.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [WalletModule, forwardRef(() => PayMongoModule), AuthModule, EventsModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
