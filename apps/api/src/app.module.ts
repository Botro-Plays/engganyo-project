import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import emailConfig from './config/email.config';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AntiAbuseModule } from './modules/anti-abuse/anti-abuse.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthModule } from './modules/health/health.module';
import { SocialAuthModule } from './modules/social-auth/social-auth.module';

@Module({
  imports: [
    // ─── Configuration ──────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, redisConfig, emailConfig],
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // ─── Rate Limiting ──────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('app.throttle.ttl', 60) * 1000,
            limit: config.get<number>('app.throttle.limit', 100),
          },
        ],
      }),
    }),

    // ─── Event System ───────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // ─── Task Scheduler ─────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Database ───────────────────────────────────────────
    DatabaseModule,

    // ─── Feature Modules ────────────────────────────────────
    AuthModule,
    UsersModule,
    WalletModule,
    CampaignsModule,
    TasksModule,
    GamificationModule,
    NotificationsModule,
    AntiAbuseModule,
    ReferralsModule,
    AdminModule,
    AnalyticsModule,
    HealthModule,
    SocialAuthModule,
  ],
})
export class AppModule {}
