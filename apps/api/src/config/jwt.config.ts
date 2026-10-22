import { registerAs } from '@nestjs/config';

const PLACEHOLDER = /change_this|GENERATE_WITH|dev-access-secret|dev-refresh-secret|dev-2fa-secret/i;
const MIN_SECRET_LENGTH = 32;

function validateTwoFactorSecret(twoFactor: string | undefined, access: string, refresh: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return twoFactor ?? 'dev-2fa-secret-min-64-chars-long-please';
  }
  if (!twoFactor || twoFactor.length < MIN_SECRET_LENGTH || PLACEHOLDER.test(twoFactor)) {
    throw new Error(
      'JWT_2FA_SECRET must be set to a strong random secret in production ' +
        '(min 32 chars, not a placeholder). Generate with: openssl rand -hex 64',
    );
  }
  if (twoFactor === access || twoFactor === refresh) {
    throw new Error('JWT_2FA_SECRET must differ from JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (A01)');
  }
  return twoFactor;
}

export default registerAs('jwt', () => {
  const accessSecret = process.env['JWT_ACCESS_SECRET'] ?? 'dev-access-secret-min-64-chars-long-please';
  const refreshSecret = process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret-min-64-chars-long-please';
  return {
    accessSecret,
    refreshSecret,
    twoFactorSecret: validateTwoFactorSecret(process.env['JWT_2FA_SECRET'], accessSecret, refreshSecret),
    accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  };
});
