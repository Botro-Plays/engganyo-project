import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadsService {
  private readonly uploadsDir = path.join(process.cwd(), 'uploads', 'proofs');

  constructor() {
    // Directory creation moved to lazy initialization
  }

  private ensureUploadsDir(): void {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true, mode: 0o755 });
    }
  }

  getUserUploadDir(userId: string, taskId: string): string {
    this.ensureUploadsDir();
    const userDir = path.join(this.uploadsDir, userId, taskId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true, mode: 0o755 });
    }
    return userDir;
  }

  generateUniqueFilename(originalName: string): string {
    const ext = path.extname(originalName);
    const uuid = uuidv4();
    return `${uuid}${ext}`;
  }

  getRelativeUploadPath(userId: string, taskId: string, filename: string): string {
    return `/uploads/proofs/${userId}/${taskId}/${filename}`;
  }

  getAbsolutePath(relativePath: string): string {
    return path.join(process.cwd(), relativePath);
  }
}
