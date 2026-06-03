import { Module } from '@nestjs/common';

import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { CurrencyService } from './currency.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, CurrencyService],
  exports: [WalletService, CurrencyService],
})
export class WalletModule {}
