import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole, UserStatus } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../database/redis.service';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret', 'dev-access-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (payload.purpose !== 'access') {
      throw new UnauthorizedException('Invalid token purpose');
    }
    const cacheKey = `jwt:user:${payload.sub}`;
    const cached = await this.redisService.getJson<{
      id: string;
      email: string;
      username: string;
      role: string;
      status: string;
    }>(cacheKey);

    if (cached) {
      const status = cached.status as UserStatus;
      if (status !== UserStatus.ACTIVE) {
        // Evict the stale entry so a deactivated/pending/restricted identity
        // cannot keep riding the cache for the rest of its TTL.
        await this.redisService.del(cacheKey);
        throw new UnauthorizedException('Account is not active');
      }
      return {
        sub: cached.id,
        email: cached.email,
        username: cached.username,
        role: cached.role as UserRole,
        status,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, email: true, username: true, role: true, status: true },
    });

    if (!user) throw new UnauthorizedException('Account not found');

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    await this.redisService.setJson(cacheKey, user, 300);

    return {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
    };
  }
}
