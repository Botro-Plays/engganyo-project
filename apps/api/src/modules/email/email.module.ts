import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { EmailService, EMAIL_QUEUE } from './email.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
  ],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
