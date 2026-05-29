import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SearchService } from './search.service';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Global search across users, campaigns, and forum topics' })
  async search(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.search(q, Math.min(parseInt(limit ?? '20', 10), 50));
  }
}
