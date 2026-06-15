import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { WalletModule } from '../wallet/wallet.module';
import { PayMongoModule } from '../paymongo/paymongo.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GamificationModule } from '../gamification/gamification.module';
import { EmailModule } from '../email/email.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    WalletModule,
    forwardRef(() => PayMongoModule),
    AuthModule,
    EventsModule,
    NotificationsModule,
    GamificationModule,
    EmailModule,
    BullModule.registerQueue(
      { name: 'email' },
      { name: 'analytics' },
      { name: 'trust-score' },
    ),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
