import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SocialIdentityService } from './social-identity.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, SocialIdentityService],
  exports: [PrismaService, RedisService, SocialIdentityService],
})
export class DatabaseModule {}
