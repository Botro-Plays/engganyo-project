import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

const ADMIN_ROLES = ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'];

/**
 * Guard that enforces an optional admin access PIN for /admin routes.
 *
 * Behavior:
 * - If user role is ADMIN/MODERATOR/SUPER_ADMIN AND has adminPinHash set:
 *   - Requires x-admin-pin header with matching PIN
 *   - If missing/invalid, throws 403 ADMIN_PIN_REQUIRED
 * - If no adminPinHash set, allows access (PIN is optional)
 * - Regular users are unaffected
 */
@Injectable()
export class AdminPinGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: JwtPayload; headers: Record<string, string> }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Access denied');

    // Only enforce for admin roles
    if (!ADMIN_ROLES.includes(user.role)) return true;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { adminPinHash: true },
    });

    // No PIN set → allow (PIN is optional)
    if (!dbUser?.adminPinHash) return true;

    const pinHeader = request.headers['x-admin-pin'];
    if (!pinHeader) {
      throw new ForbiddenException({
        message: 'Admin PIN required.',
        code: 'ADMIN_PIN_REQUIRED',
      });
    }

    const valid = await argon2.verify(dbUser.adminPinHash, pinHeader);
    if (!valid) {
      throw new ForbiddenException({
        message: 'Invalid admin PIN.',
        code: 'ADMIN_PIN_INVALID',
      });
    }

    return true;
  }
}
