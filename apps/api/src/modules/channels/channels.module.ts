import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelsGateway } from './channels.gateway';
import { DatabaseModule } from '../../database/database.module';
import { WalletModule } from '../wallet/wallet.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({}),
    ConfigModule,
    WalletModule,
    GamificationModule,
    AntiAbuseModule,
    NotificationsModule,
    EventsModule,
  ],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelsGateway],
  exports: [ChannelsService],
})
export class ChannelsModule {}
