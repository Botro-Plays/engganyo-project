import { Module } from '@nestjs/common';

import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { SocialAuthModule } from '../social-auth/social-auth.module';

@Module({
  imports: [
    WalletModule,
    NotificationsModule,
    EventsModule,
    AntiAbuseModule,
    SocialAuthModule,
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
