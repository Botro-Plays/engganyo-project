import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { BlogService } from './blog.service';
import { CreatePostDto, DeletePostDto, ListPostsDto, MutationDto, RenderPreviewDto, UpdatePostDto } from './dto/blog.dto';
import { UploadsService } from '../uploads/uploads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminTwoFactorGuard } from '../../common/guards/admin-two-factor.guard';
import { AdminPinGuard } from '../../common/guards/admin-pin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const imageInterceptor = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      if (!file || !file.mimetype || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new BadRequestException('Invalid file type. Only PNG, JPG, JPEG, WebP, and GIF are allowed.'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: MAX_FILE_SIZE },
  });

const BLOG_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'blog');

@ApiTags('admin')
@Controller('admin/blog')
@UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard, AdminPinGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiBearerAuth('access-token')
export class BlogAdminController {
  constructor(
    private readonly blogService: BlogService,
    private readonly uploadsService: UploadsService,
  ) {}

  @Get('posts')
  async list(@Query() dto: ListPostsDto) {
    return this.blogService.listAdmin(dto);
  }

  @Post('posts')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePostDto) {
    return this.blogService.create(user.sub, dto);
  }

  @Get('posts/:id')
  async get(@Param('id') id: string) {
    return this.blogService.getAdmin(id);
  }

  @Get('posts/:id/preview')
  async preview(@Param('id') id: string) {
    return this.blogService.getAdminPreview(id);
  }

  @Post('render-preview')
  async renderPreview(@Body() dto: RenderPreviewDto) {
    return this.blogService.renderBodyPreview(dto.body);
  }

  @Patch('posts/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.blogService.update(user.sub, id, dto);
  }

  @Post('posts/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MutationDto) {
    return this.blogService.publish(user.sub, id, dto.expectedVersion);
  }

  @Post('posts/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MutationDto) {
    return this.blogService.unpublish(user.sub, id, dto.expectedVersion);
  }

  @Post('posts/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MutationDto) {
    return this.blogService.archive(user.sub, id, dto.expectedVersion);
  }

  @Post('posts/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MutationDto) {
    return this.blogService.restore(user.sub, id, dto.expectedVersion);
  }

  @Delete('posts/:id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: DeletePostDto) {
    return this.blogService.remove(user.sub, id, dto.confirm, dto.expectedVersion);
  }

  // Deployment wiring check, booleans only - never returns secret
  // values. Lets the UI warn when invalidation cannot run.
  @Get('revalidation/status')
  async revalidationStatus() {
    return this.blogService.revalidationStatus();
  }

  // Authenticated retry for a mutation whose cache invalidation failed.
  @Post('posts/:id/revalidate')
  @HttpCode(HttpStatus.OK)
  async revalidate(@Param('id') id: string) {
    return this.blogService.revalidatePost(id);
  }

  @Post('cover')
  @UseInterceptors(imageInterceptor())
  async uploadCover(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('No image file provided');
    await fs.mkdir(BLOG_UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.webp`;
    const destPath = path.join(BLOG_UPLOAD_DIR, filename);
    await this.uploadsService.reencodeToWebp(file.buffer, destPath);
    return { url: `/uploads/blog/${filename}` };
  }
}
