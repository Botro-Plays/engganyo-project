import { Module, forwardRef } from '@nestjs/common';
import { PayMongoController } from './paymongo.controller';
import { PayMongoService } from './paymongo.service';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => WalletModule), NotificationsModule],
  controllers: [PayMongoController],
  providers: [PayMongoService],
  exports: [PayMongoService],
})
export class PayMongoModule {}
