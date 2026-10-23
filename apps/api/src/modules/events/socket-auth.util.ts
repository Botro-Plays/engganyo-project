import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import type { Socket } from 'socket.io';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

export interface SocketAuthResult {
  userId: string;
  /** Current database role — never the stale JWT claim. */
  role: string;
}

export interface SocketAuthDeps {
  jwtService: JwtService;
  configService: ConfigService;
  prisma: PrismaService;
  redisService: RedisService;
  logRejection: (msg: string) => void;
}

export function extractSocketToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token as string | undefined;
  if (authToken) return authToken;
  const queryToken = client.handshake.query?.token as string | undefined;
  if (queryToken) return queryToken;
  const header = client.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.substring(7);
  return null;
}

/** Stale iff the token was issued at-or-before the revocation instant.
 *  A token without a finite `iat` cannot prove freshness → stale. */
function isTokenStale(revokedAt: number | null, iat: number | undefined): boolean {
  if (revokedAt === null) return false;
  return !Number.isFinite(iat) || iat! <= revokedAt;
}

/**
 * Hardened socket handshake (A09):
 *  1. verify signature + expiry + purpose === 'access'
 *  2. require a finite `exp` — a token whose expiry cannot be enforced is
 *     never accepted
 *  3. revocation tombstone check (`iat` vs the revocation instant) —
 *     rejects tokens issued before revocation while allowing fresh logins
 *  4. load the live account: must exist, not be soft-deleted, status ACTIVE
 *  5. final `exp` check — a token that elapsed during the handshake never
 *     reaches room admission
 *  6. join the per-user room (enables targeted disconnectUser)
 *  7. tombstone + `exp` re-check — closes the race where revocation lands
 *     between the DB read and the room join; all room admission is gated
 *     on this final check
 *  8. arm the expiry disconnect timer — guaranteed to arm because `exp`
 *     was proven finite and in the future
 *
 * On any failure the socket is disconnected and null is returned.
 */
export async function authenticateSocket(
  client: Socket,
  deps: SocketAuthDeps,
): Promise<SocketAuthResult | null> {
  const { jwtService, configService, prisma, redisService, logRejection } = deps;
  const reject = (msg: string): null => {
    logRejection(msg);
    client.disconnect(true);
    return null;
  };
  try {
    const token = extractSocketToken(client);
    if (!token) return reject('no token');

    const payload = await jwtService.verifyAsync(token, {
      secret: configService.get<string>('jwt.accessSecret'),
    });
    if ((payload as { purpose?: string }).purpose !== 'access') {
      return reject('wrong token purpose');
    }

    const exp = payload.exp as number | undefined;
    const iat = payload.iat as number | undefined;
    if (!Number.isFinite(exp)) return reject('missing or malformed exp');

    const userId = payload.sub as string | undefined;
    if (!userId) return reject('no userId in token');

    if (isTokenStale(await redisService.socketAuthRevokedAt(userId), iat)) {
      return reject('token revoked');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      return reject('account missing or not active');
    }

    // Elapsed during the handshake (DB read, tombstone lookup, etc.) —
    // reject before the socket ever reaches a room.
    if (exp! * 1000 <= Date.now()) return reject('token expired during handshake');

    client.data.userId = userId;
    client.data.role = user.role;
    await client.join(`user:${userId}`);

    // Post-join re-check: revokeSocketAuth is written BEFORE the
    // disconnect sweep runs, so a handshake that raced the revocation
    // always loses here even if the sweep missed this socket. The exp
    // re-check guarantees room admission never outlives the token.
    if (
      isTokenStale(await redisService.socketAuthRevokedAt(userId), iat) ||
      exp! * 1000 <= Date.now()
    ) {
      return reject('revoked or expired during handshake');
    }

    // exp was proven finite and in the future above, so the disconnect
    // timer is always armed — a connection can never be accepted merely
    // because the timer could not be set.
    const expiresInMs = exp! * 1000 - Date.now();
    const timer = setTimeout(() => client.disconnect(true), expiresInMs);
    timer.unref?.();
    client.once('disconnect', () => clearTimeout(timer));

    return { userId, role: user.role };
  } catch (err) {
    return reject((err as Error).message);
  }
}
