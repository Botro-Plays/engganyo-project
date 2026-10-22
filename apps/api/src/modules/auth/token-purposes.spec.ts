import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import type { Socket } from 'socket.io';

import { TwoFactorService } from './two-factor.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EventsGateway } from '../events/events.gateway';
import { ChannelsGateway } from '../channels/channels.gateway';

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

function fakeSocket(token: string | undefined) {
  return {
    handshake: {
      auth: token ? { token } : {},
      query: {},
      headers: {},
    },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as Socket & { disconnect: jest.Mock };
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
      strategy.validate({
        sub: 'user-1',
        email: 'u@x.com',
        username: 'u',
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        purpose: 'two_factor_auth',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('HTTP strategy rejects refresh-purpose and legacy purpose-less tokens', async () => {
    const strategy = makeStrategy();
    const base = {
      sub: 'user-1',
      email: 'u@x.com',
      username: 'u',
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    };
    await expect(strategy.validate({ ...base, purpose: 'refresh' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(base)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('HTTP strategy accepts a purpose=access payload for an active user', async () => {
    const strategy = makeStrategy();
    redisStub.getJson.mockResolvedValue(null);
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'u@x.com', username: 'u',
      role: UserRole.USER, status: UserStatus.ACTIVE,
    });
    await expect(
      strategy.validate({
        sub: 'user-1', email: 'u@x.com', username: 'u',
        role: UserRole.USER, status: UserStatus.ACTIVE, purpose: 'access',
      }),
    ).resolves.toMatchObject({ sub: 'user-1', role: UserRole.USER });
  });

  it('sockets disconnect on a two_factor_auth challenge token', async () => {
    const service = makeTwoFactorService();
    const challenge = await service.generateTwoFactorToken('user-1');

    const eventsGateway = new EventsGateway(config, jwt, { setServer: jest.fn() } as never);
    const client = fakeSocket(challenge);
    await eventsGateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();

    const channelsGateway = new ChannelsGateway(jwt, config, {} as never);
    const chanClient = fakeSocket(challenge);
    await channelsGateway.handleConnection(chanClient);
    expect(chanClient.disconnect).toHaveBeenCalledWith(true);
  });

  it('sockets disconnect on a purpose=access token signed with the wrong key', async () => {
    const forged = jwt.sign(
      { sub: 'user-1', purpose: 'access' },
      { secret: TWO_FACTOR_SECRET },
    );
    const eventsGateway = new EventsGateway(config, jwt, { setServer: jest.fn() } as never);
    const client = fakeSocket(forged);
    await eventsGateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
