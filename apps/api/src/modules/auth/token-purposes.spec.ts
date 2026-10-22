import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import type { Socket } from 'socket.io';

import jwtConfig from '../../config/jwt.config';
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
      'app.twoFactorEncryptionKey': 'test-enc-key',
    })[key] ?? fallback,
} as ConfigService;

const prismaStub = {
  user: { findUnique: jest.fn() },
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

  it('2FA challenge → access token: full path works end to end', async () => {
    const service = makeTwoFactorService();
    const challenge = await service.generateTwoFactorToken('user-1');
    const userId = await service.validateTwoFactorToken(challenge);

    // completeTwoFactorLogin then issues an access token for that sub.
    const accessToken = jwt.sign(
      { ...ACCESS_PAYLOAD, sub: userId, purpose: 'access' },
      { secret: ACCESS_SECRET },
    );

    redisStub.getJson.mockResolvedValue(null);
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'u@x.com', username: 'u',
      role: UserRole.USER, status: UserStatus.ACTIVE,
    });
    const decoded = jwt.verify<JwtPayload>(accessToken, { secret: ACCESS_SECRET });
    await expect(makeStrategy().validate(decoded)).resolves.toMatchObject({ sub: 'user-1' });

    const client = fakeSocket(accessToken);
    await makeEventsGateway().handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:user-1');
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
