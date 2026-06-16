import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [WalletModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
