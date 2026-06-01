import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

const ADMIN_ROLES = ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'];

/**
 * Guard that enforces 2FA for admin/moderator users.
 * Applied to all /admin routes in addition to JwtAuthGuard and RolesGuard.
 *
 * Behavior:
 * - If user role is ADMIN/MODERATOR/SUPER_ADMIN:
 *   - Must have TOTP or Email 2FA enabled
 *   - If not, throws 403 ADMIN_2FA_REQUIRED
 * - Regular users are unaffected
 */
@Injectable()
export class AdminTwoFactorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Access denied');

    // Only enforce for admin roles
    if (!ADMIN_ROLES.includes(user.role)) return true;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { twoFactorTotpSecret: true, twoFactorEmailEnabled: true },
    });

    const hasTwoFactor = !!(dbUser?.twoFactorTotpSecret || dbUser?.twoFactorEmailEnabled);
    if (!hasTwoFactor) {
      throw new ForbiddenException({
        message: 'Admin access requires two-factor authentication. Please enable 2FA in your security settings.',
        code: 'ADMIN_2FA_REQUIRED',
      });
    }

    return true;
  }
}
