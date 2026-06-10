import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { EmailService, EMAIL_QUEUE } from './email.service';
import { EmailProcessor } from './email.processor';
import { WeeklyDigestService } from './weekly-digest.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
  ],
  providers: [EmailService, EmailProcessor, WeeklyDigestService],
  exports: [EmailService],
})
export class EmailModule {}
