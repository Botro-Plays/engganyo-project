import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';

const config = {
  get: (key: string, fallback?: unknown) =>
    ({
      'app.frontendUrl': 'https://engganyo.com',
      'app.nodeEnv': 'test',
      'recaptcha.secret': '',
    })[key] ?? fallback,
} as ConfigService;

const prismaStub = {
  platformConfig: { findMany: jest.fn() },
};

const fetchMock = jest.fn();

function makeService() {
  const service = new AuthService(
    prismaStub as never, new JwtService(), config,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return service as unknown as {
    assertRecaptcha(token: string | undefined, action: 'login' | 'register' | 'forgot_password'): Promise<void>;
    invalidateRecaptchaCache(): void;
  };
}

function configRows(enabled: boolean, extra: Record<string, unknown> = {}) {
  return [
    { key: 'recaptcha_enabled', value: enabled },
    { key: 'recaptcha_v3_site_key', value: 'site-key' },
    { key: 'recaptcha_v3_secret_key', value: 'secret-key' },
    ...Object.entries(extra).map(([key, value]) => ({ key, value })),
  ];
}

function siteverify(body: Record<string, unknown>, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

const VALID = { success: true, score: 0.9, action: 'login', hostname: 'engganyo.com' };

describe('reCAPTCHA enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
    prismaStub.platformConfig.findMany.mockResolvedValue(configRows(true));
  });

  it('does nothing when reCAPTCHA is disabled (Server Config can still disable it)', async () => {
    prismaStub.platformConfig.findMany.mockResolvedValue(configRows(false));
    const service = makeService();
    await expect(service.assertRecaptcha(undefined, 'login')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a token when enabled', async () => {
    await expect(makeService().assertRecaptcha(undefined, 'login')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when enabled but no secret is configured', async () => {
    prismaStub.platformConfig.findMany.mockResolvedValue([
      { key: 'recaptcha_enabled', value: true },
      { key: 'recaptcha_v3_secret_key', value: '' },
    ]);
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed with a retryable error on provider network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed with a retryable error on provider HTTP failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) });
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends a bounded timeout signal to the provider', async () => {
    fetchMock.mockResolvedValue(siteverify(VALID));
    await makeService().assertRecaptcha('tok', 'login');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.google.com/recaptcha/api/siteverify',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects when Google reports success:false', async () => {
    fetchMock.mockResolvedValue(siteverify({ success: false, 'error-codes': ['invalid-input-response'] }));
    await expect(makeService().assertRecaptcha('bad', 'login')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['low score', { score: 0.3 }],
    ['missing score', { score: undefined }],
  ])('rejects a v3 token with %s', async (_label, overrides) => {
    fetchMock.mockResolvedValue(siteverify({ ...VALID, ...overrides }));
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['wrong hostname', 'other-site.example'],
    ['missing hostname', undefined],
  ])('rejects a token with %s', async (_label, hostname) => {
    fetchMock.mockResolvedValue(siteverify({ ...VALID, hostname }));
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a token minted for a different action', async () => {
    fetchMock.mockResolvedValue(siteverify({ ...VALID, action: 'register' }));
    await expect(makeService().assertRecaptcha('tok', 'login')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid v3 token: success, score, matching hostname, matching action', async () => {
    fetchMock.mockResolvedValue(siteverify(VALID));
    await expect(makeService().assertRecaptcha('tok', 'login')).resolves.toBeUndefined();
  });

  it('accepts the www hostname for the same site', async () => {
    fetchMock.mockResolvedValue(siteverify({ ...VALID, hostname: 'www.engganyo.com' }));
    await expect(makeService().assertRecaptcha('tok', 'login')).resolves.toBeUndefined();
  });

  it('accepts a valid v2 token (interactive: success + hostname)', async () => {
    prismaStub.platformConfig.findMany.mockResolvedValue(
      configRows(true, { recaptcha_version: 'v2', recaptcha_v2_secret_key: 'v2-secret' }),
    );
    fetchMock.mockResolvedValue(siteverify({ success: true, hostname: 'engganyo.com' }));
    await expect(makeService().assertRecaptcha('tok', 'login')).resolves.toBeUndefined();
  });
});
