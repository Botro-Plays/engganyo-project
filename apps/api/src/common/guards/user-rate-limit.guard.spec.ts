import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { UserRateLimitGuard } from './user-rate-limit.guard';

const OPTS = { limit: 3, ttl: 3600, scope: 'register' };

function ctx(user?: { sub: string; role: string }, ip = '1.2.3.4') {
  const req = { user, ip };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('A08 — UserRateLimitGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let redis: { incrWithExpiry: jest.Mock; ttl: jest.Mock };
  let guard: UserRateLimitGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(OPTS) };
    redis = {
      incrWithExpiry: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(3000),
    };
    guard = new UserRateLimitGuard(reflector as any, redis as any);
  });

  it('passes when no @UserRateLimit metadata exists', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(redis.incrWithExpiry).not.toHaveBeenCalled();
  });

  it('passes under the limit', async () => {
    redis.incrWithExpiry.mockResolvedValue(3);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(redis.incrWithExpiry).toHaveBeenCalledWith(
      'ratelimit:user:1.2.3.4:register',
      3600,
    );
  });

  it('429s over the limit with retryAfter', async () => {
    redis.incrWithExpiry.mockResolvedValue(4);
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryAfter: 3000,
      }),
    } as Partial<HttpException>);
  });

  it('keys on the authenticated user id when present', async () => {
    await guard.canActivate(ctx({ sub: 'u-9', role: 'USER' }));
    expect(redis.incrWithExpiry).toHaveBeenCalledWith(
      'ratelimit:user:u-9:register',
      3600,
    );
  });

  it.each(['ADMIN', 'SUPER_ADMIN'])('exempts %s entirely', async (role) => {
    await expect(
      guard.canActivate(ctx({ sub: 'staff', role })),
    ).resolves.toBe(true);
    expect(redis.incrWithExpiry).not.toHaveBeenCalled();
  });

  it('halves the window for MODERATOR', async () => {
    await guard.canActivate(ctx({ sub: 'mod', role: 'MODERATOR' }));
    expect(redis.incrWithExpiry).toHaveBeenCalledWith(
      'ratelimit:user:mod:register',
      1800,
    );
  });

  it('uses the handler name when scope is absent', async () => {
    reflector.getAllAndOverride.mockReturnValue({ limit: 3, ttl: 60 });
    await guard.canActivate(ctx());
    expect(redis.incrWithExpiry).toHaveBeenCalledWith(
      expect.stringMatching(/^ratelimit:user:1\.2\.3\.4:/),
      60,
    );
  });
});
