import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check() {
    const start = Date.now();

    const [db, redisOk] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.getClient().ping(),
    ]);

    const dbOk = db.status === 'fulfilled';
    const cacheOk = redisOk.status === 'fulfilled';
    const status = dbOk && cacheOk ? 'ok' : 'degraded';

    return {
      status,
      latencyMs: Date.now() - start,
      services: {
        database: dbOk ? 'ok' : 'error',
        redis: cacheOk ? 'ok' : 'error',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
