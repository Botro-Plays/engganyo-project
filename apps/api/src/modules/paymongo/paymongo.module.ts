import { Module, forwardRef } from '@nestjs/common';
import { PayMongoController } from './paymongo.controller';
import { PayMongoService } from './paymongo.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [forwardRef(() => WalletModule)],
  controllers: [PayMongoController],
  providers: [PayMongoService],
  exports: [PayMongoService],
})
export class PayMongoModule {}
