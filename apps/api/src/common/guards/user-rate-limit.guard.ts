import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RedisService } from '../../database/redis.service';

export const USER_RATE_LIMIT_KEY = 'user_rate_limit';

export interface UserRateLimitOptions {
  /** Number of requests allowed */
  limit: number;
  /** Window in seconds */
  ttl: number;
  /** Key suffix to namespace different limits on the same route */
  scope?: string;
}

export const UserRateLimit = (opts: UserRateLimitOptions) =>
  SetMetadata(USER_RATE_LIMIT_KEY, opts);

@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<UserRateLimitOptions>(
      USER_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!opts) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: { sub?: string; role?: string } }>();
    const role = req.user?.role;

    // ADMIN and SUPER_ADMIN are exempt from all rate limits
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;

    const userId = req.user?.sub ?? req.ip ?? 'anonymous';
    const scope = opts.scope ?? context.getHandler().name;
    const key = `ratelimit:user:${userId}:${scope}`;

    // MODERATOR gets half the cooldown window
    const effectiveTtl = role === 'MODERATOR' ? Math.ceil(opts.ttl / 2) : opts.ttl;

    const count = await this.redis.incrWithExpiry(key, effectiveTtl);

    if (count > opts.limit) {
      const retryAfter = await this.redis.ttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests — try again in ${retryAfter}s`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
