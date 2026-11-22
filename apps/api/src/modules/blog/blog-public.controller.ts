import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BlogService } from './blog.service';

/**
 * Public blog reads. Every projection is published-only: drafts,
 * archived, unpublished and deleted posts are never returned here.
 */
@ApiTags('blog')
@Controller('blog')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @Get('posts')
  @ApiOperation({ summary: 'List published blog posts (paginated)' })
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '12',
  ) {
    const pageNum = Math.max(1, Math.min(1000, parseInt(page, 10) || 1));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
    return this.blogService.listPublished(pageNum, limitNum);
  }

  @Get('posts/:slug')
  @ApiOperation({ summary: 'Get a published blog post by slug' })
  async get(@Param('slug') slug: string) {
    return this.blogService.getPublished(slug);
  }
}
