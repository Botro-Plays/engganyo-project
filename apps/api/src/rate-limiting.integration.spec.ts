import * as http from 'http';
import { AddressInfo } from 'net';
import express, { Express } from 'express';
import {
  Controller,
  Get,
  Post,
  Injectable,
  CanActivate,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerGuard, Throttle, SkipThrottle } from '@nestjs/throttler';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { UserRateLimitGuard, UserRateLimit } from './common/guards/user-rate-limit.guard';
import { RedisService } from './database/redis.service';

/* ── In-memory Redis implementing the service's fixed-window semantics ── */
class InMemoryRedis {
  private store = new Map<string, { count: number; expiresAt: number }>();

  async incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.store.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    entry.count += 1; // expiry untouched — fixed window
    return entry.count;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return Math.max(remaining, -1);
  }

  buckets(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, v] of this.store) out.set(k, v.count);
    return out;
  }
}

/* ── Simulates an authenticated request — stands in for JwtAuthGuard ── */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const sub = req.headers['x-test-user'];
    if (typeof sub === 'string' && sub) {
      req.user = { sub, role: (req.headers['x-test-role'] as string) ?? 'USER' };
    }
    return true;
  }
}

@Controller('t')
class RLTestController {
  @Get('default')
  defaultRoute() {
    return { ok: true };
  }

  @Get('tight')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  tight() {
    return { ok: true };
  }

  @Get('health')
  @SkipThrottle()
  health() {
    return { ok: true };
  }

  // Public auth-style route — rate-limited by client IP only.
  @Post('authish')
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({ limit: 2, ttl: 3600, scope: 'login' })
  authish() {
    return { ok: true };
  }

  // Authenticated route — rate-limited per user id.
  @Get('authed')
  @UseGuards(FakeAuthGuard, UserRateLimitGuard)
  @UserRateLimit({ limit: 2, ttl: 3600, scope: 'authed' })
  authed() {
    return { ok: true };
  }
}

/**
 * Mirrors the production proxy boundary: like `proxy_set_header
 * X-Forwarded-For $remote_addr`, it OVERWRITES the incoming XFF with the
 * verified client address (simulated per-request by X-Sim-Client, standing
 * in for the socket address nginx sees). Client-supplied XFF never reaches
 * the app — the same guarantee nginx's overwrite provides.
 */
function createNginxSim(nestPort: number): { app: Express } {
  const app = express();
  app.use((req, res) => {
    const verified =
      (req.headers['x-sim-client'] as string) ?? req.socket.remoteAddress ?? 'unknown';
    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
      'x-forwarded-for': verified,
      'x-real-ip': verified,
    } as http.OutgoingHttpHeaders;
    delete headers['x-sim-client'];
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: nestPort,
        path: req.originalUrl,
        method: req.method,
        headers,
      },
      (pres) => {
        res.status(pres.statusCode ?? 502);
        for (const [k, v] of Object.entries(pres.headers)) {
          if (typeof v === 'string') res.setHeader(k, v);
        }
        pres.pipe(res);
      },
    );
    upstream.on('error', () => res.status(502).end());
    req.pipe(upstream);
  });
  return { app };
}

describe('A08 — rate-limit wiring + proxy boundary (integration)', () => {
  let app: NestExpressApplication;
  let proxyServer: http.Server;
  let base: string;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    redis = new InMemoryRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 3 },
        ]),
      ],
      controllers: [RLTestController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        UserRateLimitGuard,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1); // same as production main.ts
    await app.init();
    await app.listen(0);

    const nestPort = (app.getHttpServer().address() as AddressInfo).port;
    const sim = createNginxSim(nestPort);
    proxyServer = await new Promise<http.Server>((resolve) => {
      const s = sim.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(proxyServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    proxyServer?.close();
    await app?.close();
  });

  const req = (
    path: string,
    opts: { ip?: string; xff?: string; user?: string; method?: string } = {},
  ) =>
    fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.xff ? { 'x-forwarded-for': opts.xff } : {}),
        ...(opts.ip ? { 'x-sim-client': opts.ip } : {}),
        ...(opts.user ? { 'x-test-user': opts.user } : {}),
      },
    });

  it('rotating spoofed X-Forwarded-For cannot reset the bucket', async () => {
    // Global default limit is 3 — four requests, each with a DIFFERENT
    // attacker-controlled XFF but the same verified source, must share one
    // bucket and 429 on the fourth.
    const statuses: number[] = [];
    for (const spoof of ['9.9.9.9', '8.8.8.8', '7.7.7.7', '6.6.6.6']) {
      const r = await req('/t/default', { ip: '203.0.113.7', xff: spoof });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('distinct verified clients get separate buckets', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await req('/t/default', { ip: '198.51.100.10' })).status).toBe(200);
    }
    // Same path, different verified client — untouched bucket.
    expect((await req('/t/default', { ip: '198.51.100.11' })).status).toBe(200);
  });

  it('enforces the public auth-route limit by client IP', async () => {
    const ip = '192.0.2.55';
    expect((await req('/t/authish', { ip, method: 'POST' })).status).toBe(201);
    expect((await req('/t/authish', { ip, method: 'POST' })).status).toBe(201);
    const third = await req('/t/authish', { ip, method: 'POST' });
    expect(third.status).toBe(429);
    const body = (await third.json()) as { statusCode: number; retryAfter?: number };
    expect(body.statusCode).toBe(429);
    // retryAfter is the remaining fixed-window time — useful and bounded.
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(3600);
  });

  it('keys authenticated routes on the user id, not the IP', async () => {
    // Same IP, two users — separate buckets.
    expect((await req('/t/authed', { ip: '10.0.0.1', user: 'u-a' })).status).toBe(200);
    expect((await req('/t/authed', { ip: '10.0.0.1', user: 'u-a' })).status).toBe(200);
    expect((await req('/t/authed', { ip: '10.0.0.1', user: 'u-b' })).status).toBe(200);
    // Same user from a different IP — still the user's bucket (third hit 429s).
    expect((await req('/t/authed', { ip: '10.9.9.9', user: 'u-a' })).status).toBe(429);
  });

  it('runs the global limiter, honors route overrides, and exempts health', async () => {
    // Route override limit 2 — beats the global 3.
    expect((await req('/t/tight', { ip: '172.16.0.1' })).status).toBe(200);
    expect((await req('/t/tight', { ip: '172.16.0.1' })).status).toBe(200);
    expect((await req('/t/tight', { ip: '172.16.0.1' })).status).toBe(429);

    // @SkipThrottle — unlimited.
    for (let i = 0; i < 10; i++) {
      expect((await req('/t/health', { ip: '172.16.0.1' })).status).toBe(200);
    }
  });

  it('fixed-window counters do not extend on blocked requests', async () => {
    // Hit the limit, keep hammering — the bucket key must expire on the
    // ORIGINAL schedule, i.e. ttl() decreases and is bounded by the window.
    const ip = '203.0.113.99';
    await req('/t/authed', { ip, user: 'u-block' });
    await req('/t/authed', { ip, user: 'u-block' });
    expect((await req('/t/authed', { ip, user: 'u-block' })).status).toBe(429);
    const afterBlocked = await redis.ttl('ratelimit:user:u-block:authed');
    expect(afterBlocked).toBeGreaterThan(0);
    expect(afterBlocked).toBeLessThanOrEqual(3600);
    // More blocked requests — expiry still bounded (never re-armed to 3600).
    await req('/t/authed', { ip, user: 'u-block' });
    await req('/t/authed', { ip, user: 'u-block' });
    const later = await redis.ttl('ratelimit:user:u-block:authed');
    expect(later).toBeLessThanOrEqual(afterBlocked);
  });
});

/* ── RedisService pipeline shape — pins the fixed-window implementation ── */
describe('A08 — RedisService.incrWithExpiry fixed-window pipeline', () => {
  it('issues EXPIRE with NX so the window is set only once', async () => {
    const pipeline = {
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1]]),
    };
    const service = new RedisService({ get: () => undefined } as unknown as ConfigService);
    (service as unknown as { client: { pipeline: () => unknown } }).client = {
      pipeline: jest.fn().mockReturnValue(pipeline),
    };

    await service.incrWithExpiry('ratelimit:test', 60);
    expect(pipeline.incr).toHaveBeenCalledWith('ratelimit:test');
    expect(pipeline.expire).toHaveBeenCalledWith('ratelimit:test', 60, 'NX');
  });
});
