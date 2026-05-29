import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('proof')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const tempDir = path.join(process.cwd(), 'uploads', 'temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          cb(null, tempDir);
        },
        filename: (req, file, cb) => {
          if (!file) {
            return cb(new BadRequestException('File is required'), '');
          }
          const ext = path.extname(file.originalname || 'file');
          const uuid = uuidv4();
          const uniqueName = `${uuid}${ext}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file || !file.mimetype || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return cb(new BadRequestException('Invalid file type. Only PNG, JPG, JPEG, and WebP are allowed.'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
    }),
  )
  uploadProof(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
    @Body() body: { taskId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const taskId: string = body.taskId || uuidv4();
    const userId: string = user.sub;

    // Move file from temp to final location
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    const finalDir = path.join(process.cwd(), 'uploads', 'proofs', userId, taskId);
    const tempPath = path.join(tempDir, file.filename);
    const finalPath = path.join(finalDir, file.filename);

    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    if (fs.existsSync(tempPath)) {
      // Use copy+unlink instead of rename to handle cross-filesystem moves (Docker volumes)
      fs.copyFileSync(tempPath, finalPath);
      fs.unlinkSync(tempPath);
      // Clean up temp directory
      const tempFiles = fs.readdirSync(tempDir);
      if (tempFiles.length === 0) {
        fs.rmdirSync(tempDir);
      }
    }

    const relativePath = `/uploads/proofs/${userId}/${taskId}/${file.filename}`;

    return {
      proofUrl: relativePath,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const tempDir = path.join(process.cwd(), 'uploads', 'temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          cb(null, tempDir);
        },
        filename: (req, file, cb) => {
          if (!file) {
            return cb(new BadRequestException('File is required'), '');
          }
          const ext = path.extname(file.originalname || 'file');
          const uuid = uuidv4();
          const uniqueName = `${uuid}${ext}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file || !file.mimetype || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return cb(new BadRequestException('Invalid file type. Only PNG, JPG, JPEG, and WebP are allowed.'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
    }),
  )
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const userId: string = user.sub;

    // Move file from temp to final location
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    const finalDir = path.join(process.cwd(), 'uploads', 'avatars', userId);
    const tempPath = path.join(tempDir, file.filename);
    const finalPath = path.join(finalDir, file.filename);

    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    if (fs.existsSync(tempPath)) {
      // Use copy+unlink instead of rename to handle cross-filesystem moves (Docker volumes)
      fs.copyFileSync(tempPath, finalPath);
      fs.unlinkSync(tempPath);
      // Clean up temp directory
      const tempFiles = fs.readdirSync(tempDir);
      if (tempFiles.length === 0) {
        fs.rmdirSync(tempDir);
      }
    }

    const relativePath = `/uploads/avatars/${userId}/${file.filename}`;

    return {
      avatarUrl: relativePath,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }
}
