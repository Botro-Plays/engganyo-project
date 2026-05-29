import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { AntiAbuseModule } from '../anti-abuse/anti-abuse.module';
import { SocialAuthModule } from '../social-auth/social-auth.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [WalletModule, AntiAbuseModule, SocialAuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
