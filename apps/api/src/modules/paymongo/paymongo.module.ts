import { Module } from '@nestjs/common';
import { PayMongoController } from './paymongo.controller';
import { PayMongoService } from './paymongo.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PayMongoController],
  providers: [PayMongoService],
  exports: [PayMongoService],
})
export class PayMongoModule {}
