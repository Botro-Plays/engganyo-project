import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogPublicController } from './blog-public.controller';
import { BlogAdminController } from './blog-admin.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [BlogPublicController, BlogAdminController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
