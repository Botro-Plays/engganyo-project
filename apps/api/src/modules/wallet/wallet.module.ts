import { Module } from '@nestjs/common';

import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { CurrencyService } from './currency.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [WalletController],
  providers: [WalletService, CurrencyService],
  exports: [WalletService, CurrencyService],
})
export class WalletModule {}
