import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// Cheap pre-filter only — the real gate is decoding the actual bytes.
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Files are held in memory only — nothing untrusted ever lands on disk.
const imageInterceptor = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      if (!file || !file.mimetype || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new BadRequestException('Invalid file type. Only PNG, JPG, JPEG, WebP, and GIF are allowed.'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('proof')
  @UseInterceptors(imageInterceptor())
  async uploadProof(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
    @Body() body: { taskId?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }

    // taskId is a TaskCompletion id — verifies the caller owns that assignment
    // and derives the storage directory server-side with containment enforced.
    const { relativeUrl, destPath } = await this.uploadsService.prepareProofStorage(
      user.sub,
      body.taskId,
    );

    // Decode + re-encode; output filename/extension are server-chosen (.webp).
    await this.uploadsService.reencodeToWebp(file.buffer, destPath);

    const proofHash = this.uploadsService.sha256File(destPath);
    const size = fs.statSync(destPath).size;

    return {
      proofUrl: relativeUrl,
      filename: path.basename(destPath),
      originalName: file.originalname,
      mimetype: 'image/webp',
      size,
      proofHash,
    };
  }

  @Post('avatar')
  @UseInterceptors(imageInterceptor())
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }

    const { relativeUrl, destPath } = this.uploadsService.prepareAvatarStorage(user.sub);
    await this.uploadsService.reencodeToWebp(file.buffer, destPath);

    return {
      avatarUrl: relativeUrl,
      filename: path.basename(destPath),
      originalName: file.originalname,
      mimetype: 'image/webp',
      size: fs.statSync(destPath).size,
    };
  }
}
