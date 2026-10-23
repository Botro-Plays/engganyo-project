import { registerAs } from '@nestjs/config';

const PLACEHOLDER = /change_this|GENERATE_WITH|dev-access-secret|dev-refresh-secret|dev-2fa-secret/i;
const MIN_SECRET_LENGTH = 32;

function assertStrongSecret(name: string, value: string | undefined): string {
  if (!value || value.length < MIN_SECRET_LENGTH || PLACEHOLDER.test(value)) {
    throw new Error(
      `${name} must be set to a strong random secret in production ` +
        `(min ${MIN_SECRET_LENGTH} chars, not a placeholder). Generate with: openssl rand -hex 64`,
    );
  }
  return value;
}

function assertDistinct(name: string, value: string, others: string[]): string {
  if (others.includes(value)) {
    throw new Error(`${name} must differ from the other JWT secrets (reused secrets are not allowed)`);
  }
  return value;
}

function validateTwoFactorSecret(twoFactor: string | undefined, access: string, refresh: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return twoFactor ?? 'dev-2fa-secret-min-64-chars-long-please';
  }
  const validated = assertStrongSecret('JWT_2FA_SECRET', twoFactor);
  assertDistinct('JWT_2FA_SECRET', validated, [access, refresh]);
  return validated;
}

export default registerAs('jwt', () => {
  const isProd = process.env.NODE_ENV === 'production';
  const rawAccess = process.env['JWT_ACCESS_SECRET'];
  const rawRefresh = process.env['JWT_REFRESH_SECRET'];

  // In production all three secrets must be present, strong, and distinct —
  // a missing/placeholder/reused secret fails startup rather than silently
  // minting tokens with a known dev key. Non-prod keeps the dev defaults.
  const accessSecret = isProd
    ? assertStrongSecret('JWT_ACCESS_SECRET', rawAccess)
    : (rawAccess ?? 'dev-access-secret-min-64-chars-long-please');
  const refreshSecret = isProd
    ? assertStrongSecret('JWT_REFRESH_SECRET', rawRefresh)
    : (rawRefresh ?? 'dev-refresh-secret-min-64-chars-long-please');
  if (isProd) {
    assertDistinct('JWT_ACCESS_SECRET', accessSecret, [refreshSecret]);
    assertDistinct('JWT_REFRESH_SECRET', refreshSecret, [accessSecret]);
  }

  return {
    accessSecret,
    refreshSecret,
    twoFactorSecret: validateTwoFactorSecret(process.env['JWT_2FA_SECRET'], accessSecret, refreshSecret),
    accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  };
});
