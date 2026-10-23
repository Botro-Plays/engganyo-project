import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { AntiAbuseController } from './anti-abuse.controller';
import { AntiAbuseService } from './anti-abuse.service';
import { TrustScoreProcessor } from './anti-abuse.processor';

import { EventsModule } from '../events/events.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'trust-score' }), EventsModule],
  controllers: [AntiAbuseController],
  providers: [AntiAbuseService, TrustScoreProcessor],
  exports: [AntiAbuseService],
})
export class AntiAbuseModule {}
