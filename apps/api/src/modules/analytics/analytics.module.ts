import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsProcessor } from './analytics.processor';
import { VisitorAnalyticsController } from './visitor-analytics.controller';
import { VisitorAnalyticsService } from './visitor-analytics.service';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'analytics' }), GamificationModule],
  controllers: [AnalyticsController, VisitorAnalyticsController],
  providers: [AnalyticsService, AnalyticsProcessor, VisitorAnalyticsService],
  exports: [AnalyticsService, VisitorAnalyticsService],
})
export class AnalyticsModule {}
