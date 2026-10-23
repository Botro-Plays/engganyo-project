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

/**
 * Hardened socket handshake (A09):
 *  1. verify signature + expiry + purpose === 'access'
 *  2. revocation tombstone check — catches reconnects with a revoked token
 *  3. load the live account: must exist, not be soft-deleted, status ACTIVE
 *  4. join the per-user room (enables targeted disconnectUser)
 *  5. tombstone re-check — closes the race where revocation lands between
 *     the DB read and the room join
 *  6. arm a disconnect timer for the access token's exp
 *
 * On any failure the socket is disconnected and null is returned.
 */
export async function authenticateSocket(
  client: Socket,
  deps: SocketAuthDeps,
): Promise<SocketAuthResult | null> {
  const { jwtService, configService, prisma, redisService, logRejection } = deps;
  try {
    const token = extractSocketToken(client);
    if (!token) {
      logRejection('no token');
      client.disconnect(true);
      return null;
    }

    const payload = await jwtService.verifyAsync(token, {
      secret: configService.get<string>('jwt.accessSecret'),
    });
    if ((payload as { purpose?: string }).purpose !== 'access') {
      logRejection('wrong token purpose');
      client.disconnect(true);
      return null;
    }

    const userId = payload.sub as string | undefined;
    if (!userId) {
      logRejection('no userId in token');
      client.disconnect(true);
      return null;
    }

    if (await redisService.isSocketAuthRevoked(userId)) {
      logRejection('token revoked');
      client.disconnect(true);
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      logRejection('account missing or not active');
      client.disconnect(true);
      return null;
    }

    client.data.userId = userId;
    client.data.role = user.role;
    await client.join(`user:${userId}`);

    // Post-join tombstone re-check: revokeSocketAuth is set BEFORE
    // disconnectSockets runs, so a handshake that raced the revocation
    // always loses here even if the disconnect missed this socket.
    if (await redisService.isSocketAuthRevoked(userId)) {
      logRejection('token revoked during handshake');
      client.disconnect(true);
      return null;
    }

    // The connection outlives the access token — disconnect at exp so an
    // established socket cannot keep privileges past token lifetime.
    const expMs = (payload.exp as number) * 1000 - Date.now();
    if (expMs > 0) {
      const timer = setTimeout(() => client.disconnect(true), expMs);
      timer.unref?.();
      client.once('disconnect', () => clearTimeout(timer));
    }

    return { userId, role: user.role };
  } catch (err) {
    logRejection((err as Error).message);
    client.disconnect(true);
    return null;
  }
}
