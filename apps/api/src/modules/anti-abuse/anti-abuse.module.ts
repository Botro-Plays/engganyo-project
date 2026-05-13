import { Module } from '@nestjs/common';

import { AntiAbuseController } from './anti-abuse.controller';
import { AntiAbuseService } from './anti-abuse.service';

@Module({
  imports: [],
  controllers: [AntiAbuseController],
  providers: [AntiAbuseService],
  exports: [AntiAbuseService],
})
export class AntiAbuseModule {}
