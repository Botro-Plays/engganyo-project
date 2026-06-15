import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsProcessor } from './analytics.processor';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'analytics' }), GamificationModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsProcessor],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
