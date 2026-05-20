import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
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
        destination: (req, file, cb) => {
          const userId = (req as any).user?.id;
          const taskId = (req as any).body?.taskId;

          if (!userId || !taskId) {
            return cb(new BadRequestException('userId and taskId required'), '');
          }

          const uploadsDir = path.join(process.cwd(), 'uploads', 'proofs', userId, taskId);
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          cb(null, uploadsDir);
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
  async uploadProof(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: any, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const taskId = (req.body as any)?.taskId || uuidv4();
    const userId = user.id;
    const relativePath = `/uploads/proofs/${userId}/${taskId}/${file.filename}`;

    return {
      proofUrl: relativePath,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }
}
