import { Module, forwardRef } from '@nestjs/common';

import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { CurrencyService } from './currency.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { PayMongoModule } from '../paymongo/paymongo.module';

@Module({
  imports: [NotificationsModule, EventsModule, forwardRef(() => PayMongoModule)],
  controllers: [WalletController],
  providers: [WalletService, CurrencyService],
  exports: [WalletService, CurrencyService],
})
export class WalletModule {}
