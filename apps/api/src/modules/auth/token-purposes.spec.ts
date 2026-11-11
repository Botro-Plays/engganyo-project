import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { authenticator } from '@otplib/preset-default';
import type { Response } from 'express';
import type { Socket } from 'socket.io';

import jwtConfig from '../../config/jwt.config';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EventsGateway } from '../events/events.gateway';
import { ChannelsGateway } from '../channels/channels.gateway';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';
const TWO_FACTOR_SECRET = 'test-2fa-secret';

const config = {
  get: (key: string, fallback?: unknown) =>
    ({
      'jwt.accessSecret': ACCESS_SECRET,
      'jwt.refreshSecret': REFRESH_SECRET,
      'jwt.twoFactorSecret': TWO_FACTOR_SECRET,
      'jwt.refreshExpiresIn': '7d',
      'app.twoFactorEncryptionKey': 'test-enc-key',
    })[key] ?? fallback,
} as ConfigService;

const prismaStub = {
  user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  userSession: { create: jest.fn().mockResolvedValue({}) },
  twoFactorCode: { findFirst: jest.fn() },
  twoFactorBackupCode: { count: jest.fn(), findMany: jest.fn() },
};
const redisStub = { getJson: jest.fn(), setJson: jest.fn(), del: jest.fn() };

const jwt = new JwtService();

const ACCESS_PAYLOAD: JwtPayload = {
  sub: 'user-1',
  email: 'u@x.com',
  username: 'u',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
};

function accessSigned(payload: Record<string, unknown>): string {
  return jwt.sign({ ...ACCESS_PAYLOAD, ...payload }, { secret: ACCESS_SECRET });
}

function makeTwoFactorService() {
  return new TwoFactorService(
    prismaStub as never,
    config,
    jwt,
    { queueTwoFactorEmail: jest.fn() } as never,
    redisStub as never,
  );
}

function makeStrategy() {
  return new JwtStrategy(config, prismaStub as never, redisStub as never);
}

function makeEventsGateway() {
  return new EventsGateway(config, jwt, { setServer: jest.fn() } as never);
}

function makeChannelsGateway() {
  return new ChannelsGateway(jwt, config, {} as never);
}

function fakeSocket(token: string | undefined) {
  return {
    handshake: { auth: token ? { token } : {}, query: {}, headers: {} },
    data: {} as { userId?: string },
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as Socket & { disconnect: jest.Mock; join: jest.Mock; data: { userId?: string } };
}

describe('A01: token purpose separation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('2FA challenge token is signed with a different key than access tokens', async () => {
    const service = makeTwoFactorService();
    const challenge = await service.generateTwoFactorToken('user-1');

    // The HTTP strategy and both socket gateways verify with the access
    // secret; a challenge token must fail that verification outright.
    expect(() => jwt.verify(challenge, { secret: ACCESS_SECRET })).toThrow();

    // It still works for its own purpose.
    await expect(service.validateTwoFactorToken(challenge)).resolves.toBe('user-1');
  });

  it('HTTP strategy rejects a two_factor_auth payload (401)', async () => {
    const strategy = makeStrategy();
    await expect(
      strategy.validate({ ...ACCESS_PAYLOAD, role: UserRole.SUPER_ADMIN, purpose: 'two_factor_auth' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('HTTP strategy rejects refresh-purpose and legacy purpose-less tokens', async () => {
    const strategy = makeStrategy();
    await expect(strategy.validate({ ...ACCESS_PAYLOAD, purpose: 'refresh' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(ACCESS_PAYLOAD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('HTTP strategy accepts a purpose=access payload for an active user', async () => {
    const strategy = makeStrategy();
    redisStub.getJson.mockResolvedValue(null);
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'u@x.com', username: 'u',
      role: UserRole.USER, status: UserStatus.ACTIVE,
    });
    await expect(
      strategy.validate({ ...ACCESS_PAYLOAD, purpose: 'access' }),
    ).resolves.toMatchObject({ sub: 'user-1', role: UserRole.USER });
  });

  it('both sockets disconnect on a two_factor_auth challenge token (wrong key)', async () => {
    const service = makeTwoFactorService();
    const challenge = await service.generateTwoFactorToken('user-1');

    const client = fakeSocket(challenge);
    await makeEventsGateway().handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();

    const chanClient = fakeSocket(challenge);
    await makeChannelsGateway().handleConnection(chanClient);
    expect(chanClient.disconnect).toHaveBeenCalledWith(true);
    expect(chanClient.data.userId).toBeUndefined();
  });

  it.each(['two_factor_auth', 'refresh', 'oauth_state', undefined])(
    'both sockets disconnect on an access-SIGNED token with purpose %s (purpose check, not signature)',
    async (purpose) => {
      // Signed with the access secret, so signature verification passes —
      // only the purpose check can reject it. Removing that check fails this test.
      const token = accessSigned({ purpose });

      const eventsClient = fakeSocket(token);
      await makeEventsGateway().handleConnection(eventsClient);
      expect(eventsClient.disconnect).toHaveBeenCalledWith(true);
      expect(eventsClient.join).not.toHaveBeenCalled();

      const channelsClient = fakeSocket(token);
      await makeChannelsGateway().handleConnection(channelsClient);
      expect(channelsClient.disconnect).toHaveBeenCalledWith(true);
      expect(channelsClient.data.userId).toBeUndefined();
    },
  );

  it('both sockets accept a valid purpose=access token', async () => {
    const token = accessSigned({ purpose: 'access' });

    const eventsClient = fakeSocket(token);
    await makeEventsGateway().handleConnection(eventsClient);
    expect(eventsClient.disconnect).not.toHaveBeenCalled();
    expect(eventsClient.data.userId).toBe('user-1');
    expect(eventsClient.join).toHaveBeenCalledWith('user:user-1');

    const channelsClient = fakeSocket(token);
    await makeChannelsGateway().handleConnection(channelsClient);
    expect(channelsClient.disconnect).not.toHaveBeenCalled();
    expect(channelsClient.data.userId).toBe('user-1');
  });

  it('exercises the real completeTwoFactorLogin flow', async () => {
    const twoFactor = makeTwoFactorService();
    const authService = new AuthService(
      prismaStub as never, jwt, config,
      {} as never, { recordIp: jest.fn() } as never,
      twoFactor, {} as never, redisStub as never, {} as never,
    );

    // Real TOTP secret encrypted through the service's own helper.
    const totpSecret = authenticator.generateSecret(20);
    const encryptedSecret = (twoFactor as unknown as { encrypt(t: string): string }).encrypt(totpSecret);
    const dbUser = {
      id: 'user-1', email: 'u@x.com', username: 'u', displayName: null,
      avatarUrl: null, bio: null, role: UserRole.USER, status: UserStatus.ACTIVE,
      xp: 0, level: 1, vp: 0, vipTierId: null, creditBalance: 0,
      reputationScore: 0, twoFactorTotpSecret: encryptedSecret,
      twoFactorEmailEnabled: false,
    };
    prismaStub.user.findUnique.mockResolvedValue(dbUser);
    prismaStub.user.update.mockResolvedValue(dbUser);
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & { cookie: jest.Mock };

    const challenge = await twoFactor.generateTwoFactorToken('user-1');

    // Invalid OTP: rejection, no tokens issued, no session, no cookie.
    await expect(
      authService.completeTwoFactorLogin(challenge, '000000', 'totp', res),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(prismaStub.userSession.create).not.toHaveBeenCalled();

    // Valid OTP: real issuance path produces purpose-stamped tokens.
    const code = authenticator.generate(totpSecret);
    const result = await authService.completeTwoFactorLogin(challenge, code, 'totp', res);
    expect(prismaStub.userSession.create).toHaveBeenCalledTimes(1);

    const accessToken = result.accessToken;
    const refreshToken = res.cookie.mock.calls[0][1] as string;

    // Access token: signed with access secret, purpose 'access', accepted by
    // its consumers (HTTP strategy and sockets).
    const accessPayload = jwt.verify<JwtPayload>(accessToken, { secret: ACCESS_SECRET });
    expect(accessPayload.purpose).toBe('access');
    expect(() => jwt.verify(accessToken, { secret: REFRESH_SECRET })).toThrow();
    expect(() => jwt.verify(accessToken, { secret: TWO_FACTOR_SECRET })).toThrow();
    redisStub.getJson.mockResolvedValue(null);
    await expect(makeStrategy().validate(accessPayload)).resolves.toMatchObject({ sub: 'user-1' });
    const client = fakeSocket(accessToken);
    await makeEventsGateway().handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:user-1');

    // Refresh token: signed with refresh secret, purpose 'refresh', verified
    // by the refresh path's own check — and unusable as an access token.
    const refreshPayload = jwt.verify<JwtPayload>(refreshToken, { secret: REFRESH_SECRET });
    expect(refreshPayload.purpose).toBe('refresh');
    expect(() => jwt.verify(refreshToken, { secret: ACCESS_SECRET })).toThrow();
    await expect(makeStrategy().validate(refreshPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('A11: JWT strategy requires ACTIVE status', () => {
  beforeEach(() => jest.clearAllMocks());

  const accessPayload = { ...ACCESS_PAYLOAD, purpose: 'access' as const };

  it.each([UserStatus.SUSPENDED, UserStatus.BANNED, UserStatus.DEACTIVATED, UserStatus.PENDING_VERIFICATION])(
    'cached %s identity is rejected and the cache entry evicted',
    async (status) => {
      const strategy = makeStrategy();
      redisStub.getJson.mockResolvedValue({
        id: 'user-1', email: 'u@x.com', username: 'u',
        role: UserRole.USER, status,
      });

      await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(redisStub.del).toHaveBeenCalledWith('jwt:user:user-1');
      // Must not fall through to the DB lookup — the cache rejection is final.
      expect(prismaStub.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('cached ACTIVE identity is accepted', async () => {
    const strategy = makeStrategy();
    redisStub.getJson.mockResolvedValue({
      id: 'user-1', email: 'u@x.com', username: 'u',
      role: UserRole.USER, status: UserStatus.ACTIVE,
    });
    await expect(strategy.validate(accessPayload)).resolves.toMatchObject({
      sub: 'user-1', status: UserStatus.ACTIVE,
    });
  });

  it.each([UserStatus.SUSPENDED, UserStatus.BANNED, UserStatus.DEACTIVATED, UserStatus.PENDING_VERIFICATION])(
    'database %s status is rejected on the uncached path',
    async (status) => {
      const strategy = makeStrategy();
      redisStub.getJson.mockResolvedValue(null);
      prismaStub.user.findUnique.mockResolvedValue({
        id: 'user-1', email: 'u@x.com', username: 'u',
        role: UserRole.USER, status,
      });
      await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(redisStub.setJson).not.toHaveBeenCalled();
    },
  );

  it('missing user (soft-deleted or absent) is rejected', async () => {
    const strategy = makeStrategy();
    redisStub.getJson.mockResolvedValue(null);
    prismaStub.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('I02: JWT access/refresh secret production validation', () => {
  const env = { ...process.env };
  const strong = 'a'.repeat(64);
  const strong2 = 'b'.repeat(64);
  const strong3 = 'c'.repeat(64);

  beforeEach(() => {
    process.env = { ...env, NODE_ENV: 'production' };
    process.env['JWT_2FA_SECRET'] = strong3;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it.each([
    ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
    ['JWT_REFRESH_SECRET', 'JWT_ACCESS_SECRET'],
  ])('%s missing in production fails startup', (missing, other) => {
    delete process.env[missing];
    process.env[other] = strong;
    expect(() => jwtConfig()).toThrow(missing);
  });

  it.each([
    ['JWT_ACCESS_SECRET'],
    ['JWT_REFRESH_SECRET'],
  ])('%s weak or placeholder in production fails startup', (key) => {
    process.env[key] = 'dev-access-secret-min-64-chars-long-please';
    process.env[key === 'JWT_ACCESS_SECRET' ? 'JWT_REFRESH_SECRET' : 'JWT_ACCESS_SECRET'] = strong;
    expect(() => jwtConfig()).toThrow(key);

    process.env[key] = 'short';
    expect(() => jwtConfig()).toThrow(key);
  });

  it('reused access/refresh secrets fail startup', () => {
    process.env['JWT_ACCESS_SECRET'] = strong;
    process.env['JWT_REFRESH_SECRET'] = strong;
    expect(() => jwtConfig()).toThrow('must differ');
  });

  it('access secret equal to 2FA secret fails startup', () => {
    process.env['JWT_ACCESS_SECRET'] = strong3;
    process.env['JWT_REFRESH_SECRET'] = strong2;
    expect(() => jwtConfig()).toThrow();
  });

  it('three strong distinct secrets pass in production', () => {
    process.env['JWT_ACCESS_SECRET'] = strong;
    process.env['JWT_REFRESH_SECRET'] = strong2;
    expect(jwtConfig()).toMatchObject({ accessSecret: strong, refreshSecret: strong2 });
  });

  it('dev defaults still apply outside production', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_ACCESS_SECRET'];
    delete process.env['JWT_REFRESH_SECRET'];
    const cfg = jwtConfig();
    expect(cfg.accessSecret).toBe('dev-access-secret-min-64-chars-long-please');
    expect(cfg.refreshSecret).toBe('dev-refresh-secret-min-64-chars-long-please');
  });
});

describe('A01: JWT_2FA_SECRET production validation', () => {
  const env = { ...process.env };
  const strong = 'a'.repeat(64);
  const strongAccess = 'b'.repeat(64);
  const strongRefresh = 'c'.repeat(64);

  beforeEach(() => {
    process.env = { ...env, NODE_ENV: 'production' };
    process.env['JWT_ACCESS_SECRET'] = strongAccess;
    process.env['JWT_REFRESH_SECRET'] = strongRefresh;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['short', 'tooshort'],
    ['placeholder', 'GENERATE_WITH__openssl_rand_-hex_64_DIFFERENT'],
    ['change-this placeholder', 'change_this_to_a_third_strong_random_secret_min_64_chars'],
    ['dev fallback', 'dev-2fa-secret-min-64-chars-long-please'],
  ])('rejects %s secret in production', (_label, value) => {
    delete process.env['JWT_2FA_SECRET'];
    if (value !== undefined) process.env['JWT_2FA_SECRET'] = value;
    expect(() => jwtConfig()).toThrow('JWT_2FA_SECRET');
  });

  it.each([
    ['access', strongAccess],
    ['refresh', strongRefresh],
  ])('rejects a secret equal to the %s secret', (_label, value) => {
    process.env['JWT_2FA_SECRET'] = value;
    expect(() => jwtConfig()).toThrow('must differ');
  });

  it('accepts a strong unique secret in production', () => {
    process.env['JWT_2FA_SECRET'] = strong;
    expect(jwtConfig()).toMatchObject({ twoFactorSecret: strong });
  });

  it('falls back to the dev secret outside production', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_2FA_SECRET'];
    expect(jwtConfig()['twoFactorSecret']).toBe('dev-2fa-secret-min-64-chars-long-please');
  });
});
