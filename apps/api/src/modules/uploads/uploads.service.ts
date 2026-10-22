import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '../../database/prisma.service';

// Path segments must match this shape — no separators, dots, or traversal.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

// All stored uploads are re-encoded to webp; extensions are server-assigned.
const OUTPUT_EXT = '.webp';
const WEBP_QUALITY = 82;

@Injectable()
export class UploadsService {
  private readonly uploadsRoot = path.join(process.cwd(), 'uploads');

  constructor(private readonly prisma: PrismaService) {}

  assertSafePathSegment(value: string | undefined, field: string): asserts value is string {
    if (!value || !SAFE_SEGMENT.test(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }

  /**
   * Resolve a path under a base directory and refuse anything that escapes it.
   */
  resolveContainedPath(base: string, ...segments: string[]): string {
    const resolved = path.resolve(base, ...segments);
    const contained = path.resolve(base) + path.sep;
    if (!resolved.startsWith(contained)) {
      throw new ForbiddenException('Invalid storage path');
    }
    return resolved;
  }

  /**
   * Decode and re-encode an uploaded image buffer to webp. Rejects non-image,
   * truncated, or malformed content regardless of client-supplied MIME type or
   * filename extension. Output format and extension are always server-chosen.
   */
  async reencodeToWebp(source: Buffer, destPath: string): Promise<void> {
    try {
      await sharp(source, { failOn: 'truncated' })
        .rotate() // normalize EXIF orientation, strip remaining metadata
        .webp({ quality: WEBP_QUALITY })
        .toFile(destPath);
    } catch {
      throw new BadRequestException('Uploaded file is not a valid image');
    }
  }

  /**
   * A04: the upload "taskId" is a TaskCompletion id — the caller must own that
   * assignment. Resolves the on-disk directory server-side with containment
   * enforcement and returns a server-generated filename.
   */
  async prepareProofStorage(
    userId: string,
    completionId: string | undefined,
  ): Promise<{ relativeUrl: string; destPath: string }> {
    this.assertSafePathSegment(completionId, 'taskId');

    const completion = await this.prisma.taskCompletion.findUnique({
      where: { id: completionId as string },
      select: { userId: true },
    });
    if (!completion) {
      throw new NotFoundException('Task assignment not found');
    }
    if (completion.userId !== userId) {
      throw new ForbiddenException('Task is not assigned to this user');
    }

    const dir = this.resolveContainedPath(
      path.join(this.uploadsRoot, 'proofs'),
      userId,
      completionId as string,
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

    const filename = `${uuidv4()}${OUTPUT_EXT}`;
    const destPath = this.resolveContainedPath(dir, filename);
    const relativeUrl = `/uploads/proofs/${userId}/${completionId}/${filename}`;
    return { relativeUrl, destPath };
  }

  prepareAvatarStorage(userId: string): { relativeUrl: string; destPath: string } {
    const dir = this.resolveContainedPath(
      path.join(this.uploadsRoot, 'avatars'),
      userId,
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

    const filename = `${uuidv4()}${OUTPUT_EXT}`;
    const destPath = this.resolveContainedPath(dir, filename);
    const relativeUrl = `/uploads/avatars/${userId}/${filename}`;
    return { relativeUrl, destPath };
  }

  sha256File(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
