import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['APP_PORT'] ?? '3001', 10),
  apiPrefix: process.env['API_PREFIX'] ?? 'api/v1',
  frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  cookieSecret: process.env['COOKIE_SECRET'] ?? 'dev-cookie-secret',
  encryptionKey: process.env['ENCRYPTION_KEY'] ?? '',
  throttle: {
    ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60', 10),
    limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
  },
  features: {
    emailVerification: process.env['ENABLE_EMAIL_VERIFICATION'] === 'true',
    antiAbuse: process.env['ENABLE_ANTI_ABUSE'] !== 'false',
    websockets: process.env['ENABLE_WEBSOCKETS'] !== 'false',
  },
}));
