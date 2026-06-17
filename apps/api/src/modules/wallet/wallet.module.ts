import { Module, forwardRef } from '@nestjs/common';

import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { CurrencyService } from './currency.service';
import { CryptoVerificationService } from './crypto-verification.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { PayMongoModule } from '../paymongo/paymongo.module';
import { PayPalModule } from '../paypal/paypal.module';
import { GamificationModule } from '../gamification/gamification.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [NotificationsModule, EventsModule, forwardRef(() => PayMongoModule), forwardRef(() => PayPalModule), forwardRef(() => GamificationModule), ReferralsModule],
  controllers: [WalletController],
  providers: [WalletService, CurrencyService, CryptoVerificationService],
  exports: [WalletService, CurrencyService, CryptoVerificationService],
})
export class WalletModule {}
