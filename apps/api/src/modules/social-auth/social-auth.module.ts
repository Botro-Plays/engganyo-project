import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [SocialAuthController],
  providers: [SocialAuthService],
  exports: [SocialAuthService],
})
export class SocialAuthModule {}
