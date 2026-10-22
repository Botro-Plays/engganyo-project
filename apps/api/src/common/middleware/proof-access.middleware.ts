import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../database/prisma.service';

// Roles allowed to review any proof
const ADMIN_ROLES = new Set(['ADMIN', 'MODERATOR', 'SUPER_ADMIN']);

interface AccessTokenPayload {
  sub?: unknown;
  role?: unknown;
  purpose?: unknown;
}

type MiddlewareRequest = {
  path: string;
  headers: { authorization?: string };
};

type MiddlewareResponse = {
  status: (code: number) => { json: (body: unknown) => unknown };
};

/**
 * Express middleware mounted at /uploads/proofs.
 *
 * A03 hardening: static file serving previously only checked that an
 * Authorization header started with "Bearer ", so any arbitrary string
 * satisfied the check. This middleware requires a genuinely valid access
 * token (signature + purpose === 'access') and authorizes the requested
 * proof resource — <owner>/<completion>/<filename> — for the owner, the
 * owning campaign's reviewer, or an admin role.
 */
export function createProofAccessMiddleware(
  jwtService: JwtService,
  prisma: PrismaService,
  accessSecret: string,
) {
  const unauthorized = (res: MiddlewareResponse) =>
    res.status(401).json({ message: 'Unauthorized' });
  const forbidden = (res: MiddlewareResponse) =>
    res.status(403).json({ message: 'Forbidden' });

  return async (
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: () => void,
  ) => {
    const auth = req.headers?.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ')
      ? auth.slice(7).trim()
      : undefined;
    if (!token) {
      unauthorized(res);
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = jwtService.verify<AccessTokenPayload>(token, {
        secret: accessSecret,
      });
    } catch {
      unauthorized(res);
      return;
    }

    if (payload.purpose !== 'access' || typeof payload.sub !== 'string') {
      unauthorized(res);
      return;
    }

    // Path is relative to the /uploads/proofs mount:
    //   /<ownerId>/<completionId>/<filename>
    const segments = req.path.split('/').filter(Boolean);
    const isSafeSegment = (s: string) => /^[A-Za-z0-9._-]{1,128}$/.test(s) && !s.includes('..');
    if (segments.length !== 3 || !segments.every(isSafeSegment)) {
      forbidden(res);
      return;
    }
    const [ownerId, completionId] = segments;

    if (payload.sub === ownerId || ADMIN_ROLES.has(payload.role as string)) {
      next();
      return;
    }

    try {
      const completion = await prisma.taskCompletion.findUnique({
        where: { id: completionId },
        select: { userId: true, campaign: { select: { userId: true } } },
      });
      if (completion?.userId === ownerId && completion.campaign.userId === payload.sub) {
        next();
        return;
      }
    } catch {
      // Fall through to forbidden on lookup errors
    }

    forbidden(res);
  };
}
