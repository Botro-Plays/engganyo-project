import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { SocialAuthModule } from '../social-auth/social-auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { GamificationModule } from '../gamification/gamification.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [WalletModule, GamificationModule, AntiAbuseModule, SocialAuthModule, NotificationsModule, EventsModule, ReferralsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
