import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { EmailService, EMAIL_QUEUE } from './email.service';
import { EmailProcessor } from './email.processor';
import { WeeklyDigestService } from './weekly-digest.service';
import { SmtpSettingsService } from './smtp-settings.service';
import { CryptoUtil } from '../../common/utils/crypto.util';

@Module({
  imports: [
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
  ],
  providers: [EmailService, EmailProcessor, WeeklyDigestService, SmtpSettingsService, CryptoUtil],
  exports: [EmailService, WeeklyDigestService, SmtpSettingsService],
})
export class EmailModule {}
