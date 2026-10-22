import * as fs from 'fs';
import * as path from 'path';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../database/prisma.service';

// Roles allowed to review any proof (resolved fresh from the database)
const ADMIN_ROLES = new Set(['ADMIN', 'MODERATOR', 'SUPER_ADMIN']);

interface AccessTokenPayload {
  sub?: unknown;
  purpose?: unknown;
}

type HandlerRequest = {
  path: string;
  headers: { authorization?: string };
};

type HandlerResponse = {
  status: (code: number) => { json: (body: unknown) => unknown };
  setHeader: (name: string, value: string) => void;
  sendFile: (path: string) => void;
  sendStatus: (code: number) => void;
};

/**
 * Express handler mounted at /uploads/proofs — proofs are NOT part of the
 * broad static-served uploads tree, so this handler is the only code path
 * that can return proof bytes.
 *
 * A03 hardening:
 *  - Requires a genuinely valid access token (signature + purpose==='access').
 *  - Resolves the user's CURRENT role and account status from the database —
 *    stale JWT role claims never grant access, and suspended/banned/deactivated
 *    accounts are rejected.
 *  - Authorizes the requested resource <ownerId>/<completionId>/<filename> for
 *    the proof owner, the owning campaign's reviewer, or an admin role.
 *  - Path segments are validated and containment-enforced before any disk read.
 *  - Responses are Cache-Control: private, no-store.
 */
export function createProofAccessHandler(
  jwtService: JwtService,
  prisma: PrismaService,
  accessSecret: string,
  proofsRoot: string,
) {
  const root = path.resolve(proofsRoot);

  const unauthorized = (res: HandlerResponse) =>
    res.status(401).json({ message: 'Unauthorized' });
  const forbidden = (res: HandlerResponse) =>
    res.status(403).json({ message: 'Forbidden' });
  const notFound = (res: HandlerResponse) => res.sendStatus(404);

  return async (req: HandlerRequest, res: HandlerResponse): Promise<void> => {
    const auth = req.headers?.authorization;
    const token =
      typeof auth === 'string' && auth.startsWith('Bearer ')
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

    // Fresh, trusted account state — a stale JWT role never grants access.
    let user: { role: string; status: string } | null;
    try {
      user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true, status: true },
      });
    } catch {
      unauthorized(res);
      return;
    }
    if (!user || user.status !== 'ACTIVE') {
      unauthorized(res);
      return;
    }

    // Path is relative to the /uploads/proofs mount:
    //   /<ownerId>/<completionId>/<filename>
    const segments = req.path.split('/').filter(Boolean);
    const isSafeSegment = (s: string) =>
      /^[A-Za-z0-9._-]{1,128}$/.test(s) && !s.includes('..');
    if (segments.length !== 3 || !segments.every(isSafeSegment)) {
      forbidden(res);
      return;
    }
    const [ownerId, completionId, filename] = segments;

    let allowed =
      payload.sub === ownerId || ADMIN_ROLES.has(user.role);

    if (!allowed) {
      try {
        const completion = await prisma.taskCompletion.findUnique({
          where: { id: completionId },
          select: { userId: true, campaign: { select: { userId: true } } },
        });
        allowed =
          completion?.userId === ownerId &&
          completion.campaign.userId === payload.sub;
      } catch {
        allowed = false;
      }
    }

    if (!allowed) {
      forbidden(res);
      return;
    }

    // All segments passed the safe-segment check; still enforce resolved
    // containment before touching the filesystem.
    const resolved = path.resolve(root, ownerId, completionId, filename);
    if (!resolved.startsWith(root + path.sep)) {
      forbidden(res);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      notFound(res);
      return;
    }
    if (!stat.isFile()) {
      notFound(res);
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved);
  };
}
