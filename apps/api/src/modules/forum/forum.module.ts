import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';
import { UserRateLimitGuard } from '../../common/guards/user-rate-limit.guard';

@Module({
  controllers: [ForumController],
  providers: [ForumService, UserRateLimitGuard],
  exports: [ForumService],
})
export class ForumModule {}
