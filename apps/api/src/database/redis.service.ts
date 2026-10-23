import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host', 'localhost'),
      port: this.configService.get<number>('redis.port', 6379),
      password: this.configService.get<string>('redis.password') || undefined,
      db: this.configService.get<number>('redis.db', 0),
      keyPrefix: this.configService.get<string>('redis.keyPrefix', 'engganyo:'),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      lazyConnect: true,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis disconnected');
  }

  getClient(): Redis {
    return this.client;
  }

  // ─── Common Operations ──────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Fixed-window counter: the expiry is set only when the key has no expiry
   * (i.e., on window creation). Blocked and allowed requests inside the
   * window increment the counter but never extend it, so a saturated client
   * regains access exactly when the window ends — ttl(key) is a truthful
   * retryAfter.
   */
  async incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const pipeline = this.client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds, 'NX');
    const results = await pipeline.exec();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (results?.[0]?.[1] as number) ?? 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    await this.client.hdel(key, ...fields);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client.sadd(key, ...members);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  // ─── Pattern-based operations ────────────────────────────

  async delByPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  // ─── JSON helpers ────────────────────────────────────────

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  // ─── Socket auth revocation tombstones ──────────────────
  // The tombstone stores the revocation INSTANT (epoch seconds), not a
  // blanket block: a socket token is stale iff its `iat` is at-or-before
  // that instant. A legitimate fresh login afterwards gets a newer `iat`
  // and is NOT blocked. Handshakes check the tombstone before AND after
  // joining the user room to close the revoke race.
  // TTL mirrors the configured access-token lifetime — once every pre-
  // revocation token has expired, the tombstone is dead weight. The
  // lifetime is read from config, never hardcoded.

  async revokeSocketAuth(userId: string): Promise<void> {
    await this.set(
      `auth:revoked-at:${userId}`,
      String(Math.floor(Date.now() / 1000)),
      this.socketAuthTombstoneTtlSeconds(),
    );
  }

  async socketAuthRevokedAt(userId: string): Promise<number | null> {
    const raw = await this.get(`auth:revoked-at:${userId}`);
    if (raw === null) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  }

  private socketAuthTombstoneTtlSeconds(): number {
    const value = String(this.configService.get<string>('jwt.accessExpiresIn', '15m')).trim();
    const m = /^(\d+)([smhd])?$/.exec(value);
    if (!m) return 900;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? 's'] ?? 1;
    return Number(m[1]) * mult;
  }

  // ─── User cache invalidation ─────────────────────────────

  async invalidateUserCaches(userId: string): Promise<void> {
    await Promise.all([
      this.del(`jwt:user:${userId}`),
      this.del(`auth:me:${userId}`),
      this.del(`user:profile:${userId}`),
    ]);
  }
}
