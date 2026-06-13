import { Module } from '@nestjs/common';
import { PayPalController, PayPalWebhookController } from './paypal.controller';
import { PayPalService } from './paypal.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PayPalController, PayPalWebhookController],
  providers: [PayPalService],
  exports: [PayPalService],
})
export class PayPalModule {}
