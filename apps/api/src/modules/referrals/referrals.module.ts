import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsModule } from '../events/events.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/**
 * ReferralsModule — Phase 6
 * Handles: referral tracking, qualification, reward distribution
 */
@Module({
  imports: [DatabaseModule, NotificationsModule, EventsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
