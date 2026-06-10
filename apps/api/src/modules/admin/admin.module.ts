import { Module, forwardRef } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { PayMongoModule } from '../paymongo/paymongo.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { AdminController } from './admin.controller';
import { BullBoardController } from './bull-board.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [WalletModule, forwardRef(() => PayMongoModule), AuthModule, EventsModule, NotificationsModule, EmailModule],
  controllers: [AdminController, BullBoardController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
