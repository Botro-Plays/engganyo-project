import { Module } from '@nestjs/common';
import { PayPalController } from './paypal.controller';
import { PayPalService } from './paypal.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PayPalController],
  providers: [PayPalService],
  exports: [PayPalService],
})
export class PayPalModule {}
